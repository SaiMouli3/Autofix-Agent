"""OAuth 2.0 authorization-code flow with PKCE for integrations.

Token bundles are stored as one encrypted secret per integration::

    {"client_id", "client_secret", "access_token", "refresh_token", "expires_at",
     "scope", "instance_url", "authorized_by", "authorized_at"}

Nothing in the bundle ever leaves the backend. Refreshes are serialised per integration
(process lock + row lock) and committed in their own transaction, because vendors that rotate
refresh tokens (Salesforce External Client Apps) invalidate the old one on use: losing the new
token to a rolled-back request would disconnect the integration.
"""

from __future__ import annotations

import base64
import contextvars
import hashlib
import json
import re
import secrets
import threading
from datetime import timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from sca.config import get_settings
from sca.db import session_scope
from sca.models import Integration, OAuthState, Secret, utcnow
from sca.security import crypto
from sca.security.netguard import BlockedTarget, check_url
from sca.security.redaction import register_secret
from sca.services.secrets import put_secret, read_secret

STATE_TTL = timedelta(minutes=10)
REFRESH_SKEW_S = 60
_locks: dict[str, threading.Lock] = {}
# Origin of the current HTTP request, set by the app middleware (development fallback only).
request_origin: contextvars.ContextVar[str] = contextvars.ContextVar("sca_request_origin", default="")
_locks_guard = threading.Lock()


class OAuthError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def redirect_uri() -> str:
    """Callback URL registered with vendors. Production uses SCA_PUBLIC_BASE_URL only; elsewhere,
    without it, the browser's own origin, so the callback returns to the host holding the session."""
    s = get_settings()
    base = s.public_base_url or ("" if s.is_production else request_origin.get()) or "http://localhost:8000"
    return base.rstrip("/") + "/api/oauth/callback"


def oauth_settings(integ: Integration) -> dict[str, Any] | None:
    cfg = integ.config or {}
    if integ.type == "http" and (cfg.get("auth") or {}).get("type") == "oauth2":
        return cfg.get("oauth")
    if integ.type == "mcp" and cfg.get("auth_type") == "oauth2":
        return cfg.get("oauth")
    return None


def _lock(integ_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(integ_id, threading.Lock())


def _secret_name(integ: Integration) -> str:
    return f"integration:{integ.id}"


def load_bundle(db: Session, integ: Integration) -> dict[str, Any]:
    raw = read_secret(db, integ.secret_id, integ.org_id)
    if not raw:
        return {}
    try:
        bundle = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return bundle if isinstance(bundle, dict) else {}


def save_bundle(db: Session, integ: Integration, bundle: dict[str, Any], user_id: str | None) -> None:
    for key in ("client_secret", "access_token", "refresh_token"):
        register_secret(bundle.get(key))
    sec = put_secret(db, integ.org_id, _secret_name(integ), "integration", json.dumps(bundle), user_id)
    integ.secret_id = sec.id


def status(db: Session, integ: Integration) -> dict[str, Any]:
    """Display-safe connection state (never tokens or the client secret)."""
    b = load_bundle(db, integ)
    return {
        "redirect_uri": redirect_uri(),
        "client_configured": bool(b.get("client_id")),
        "client_id_hint": (b.get("client_id") or "")[:6] + "…" if b.get("client_id") else "",
        "connected": bool(b.get("access_token")),
        "has_refresh_token": bool(b.get("refresh_token")),
        "expires_at": b.get("expires_at"),
        "scope": b.get("scope", ""),
        "instance_url": b.get("instance_url", ""),
        "authorized_by": b.get("authorized_by"),
        "authorized_at": b.get("authorized_at"),
        "needs_reauthorization": bool(b.get("needs_reauthorization")),
    }


# Client ID shapes for vendors whose IDs are well known, to catch paste mistakes (the secret in the
# ID field, a project ID, stray quotes) before the vendor answers with an opaque invalid_client page.
_CLIENT_ID_FORMATS = {
    "accounts.google.com": (re.compile(r"^\d+(-[a-z0-9]+)?\.apps\.googleusercontent\.com$"),
                            "A Google OAuth client ID looks like 1234567890-abc123.apps.googleusercontent.com "
                            "(Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs)."),
    "login.microsoftonline.com": (re.compile(r"^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$"),
                                  "A Microsoft Entra client ID is the Application (client) ID GUID from the app registration."),
}


def _check_client_id(o: dict[str, Any], client_id: str) -> None:
    fmt = _CLIENT_ID_FORMATS.get(urlparse(o.get("authorize_url", "")).hostname or "")
    if fmt and not fmt[0].match(client_id):
        hint = " It looks like the client secret was pasted into the client ID field." if client_id.startswith("GOCSPX-") else ""
        raise OAuthError("client_id_format", f"That is not a valid client ID for this provider.{hint} {fmt[1]}")


def _clean(value: str) -> str:
    return value.strip().strip("\"'").strip()


def set_client(db: Session, integ: Integration, client_id: str, client_secret: str | None, user_id: str) -> None:
    """Store the vendor app's client credentials. Changing them discards existing tokens."""
    client_id, client_secret = _clean(client_id), _clean(client_secret or "")
    _check_client_id(oauth_settings(integ) or {}, client_id)
    save_bundle(db, integ, {"client_id": client_id, "client_secret": client_secret}, user_id)


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def start(db: Session, integ: Integration, user_id: str) -> str:
    """Create a single-use state and return the vendor authorization URL."""
    o = oauth_settings(integ)
    if o is None:
        raise OAuthError("not_oauth", "this integration does not use OAuth")
    b = load_bundle(db, integ)
    if not b.get("client_id"):
        raise OAuthError("client_missing", "enter the OAuth client ID first")
    _check_client_id(o, b["client_id"])
    try:
        check_url(o["authorize_url"])
    except BlockedTarget as exc:
        raise OAuthError("blocked_target", str(exc)) from exc
    state = secrets.token_urlsafe(32)
    verifier, challenge = _pkce_pair()
    now = utcnow()
    db.add(OAuthState(id=hashlib.sha256(state.encode()).hexdigest(), org_id=integ.org_id, integration_id=integ.id,
                      user_id=user_id, verifier=crypto.encrypt(verifier), redirect_uri=redirect_uri(),
                      created_at=now, expires_at=now + STATE_TTL))
    params = {"response_type": "code", "client_id": b["client_id"], "redirect_uri": redirect_uri(), "state": state,
              **(o.get("extra_authorize_params") or {})}
    if o.get("scopes"):
        params["scope"] = (o.get("scope_separator") or " ").join(o["scopes"])
    if o.get("pkce", True):
        params.update(code_challenge=challenge, code_challenge_method="S256")
    sep = "&" if urlparse(o["authorize_url"]).query else "?"
    url = o["authorize_url"] + sep + urlencode(params)
    preflight(url)
    return url


def _pb_strings(raw: bytes) -> dict[int, str]:
    """Top-level length-delimited string fields of a protobuf message (enough for Google's authError)."""
    out: dict[int, str] = {}
    i = 0

    def varint() -> int:
        nonlocal i
        shift = val = 0
        while i < len(raw):
            b = raw[i]
            i += 1
            val |= (b & 0x7F) << shift
            if not b & 0x80:
                return val
            shift += 7
        raise ValueError("truncated varint")

    while i < len(raw):
        key = varint()
        field, wire = key >> 3, key & 7
        if wire == 0:
            varint()
        elif wire == 2:
            n = varint()
            chunk, i = raw[i:i + n], i + n
            if field not in out:
                out[field] = chunk.decode("utf-8", "replace")
        elif wire == 5:
            i += 4
        elif wire == 1:
            i += 8
        else:
            break
    return out


_MS_ERRORS = {
    "700016": "Microsoft Entra has no application with this client ID in that tenant. Check the Application (client) ID and the tenant.",
    "50011": "The callback URL is not registered on the Entra app registration.",
    "900971": "The callback URL is not registered on the Entra app registration.",
    "50059": "Microsoft could not resolve the app or tenant (AADSTS50059). Check the tenant ID and the Application (client) ID.",
    "90002": "Microsoft could not find the tenant. Use your tenant ID or domain, or 'organizations'.",
    "700054": "The app registration does not allow this response type.",
}


def _explain(code: str, message: str) -> str:
    cb = redirect_uri()
    if code == "redirect_uri_mismatch" or "redirect" in code:
        return (f"The provider rejected the callback URL. Register exactly {cb} as an authorized redirect URI "
                f"on the OAuth client, then click Connect again.")
    if code in ("invalid_client", "invalid_client_id", "deleted_client", "unauthorized_client"):
        return (f"The provider does not accept this OAuth client ({message or code}). Copy the client ID of a "
                f"'Web application' OAuth client from the provider's console and save it again. For Google: "
                f"Google Cloud Console → APIs & Services → Credentials, in the project where the API is enabled.")
    return f"The provider refused the sign-in request: {message or code}."


def preflight(url: str) -> None:
    """Ask the vendor's authorize endpoint about this request before sending the browser there, so a
    misconfigured client is reported in the app instead of on a vendor error page. Unreachable or
    unrecognized responses are not treated as errors."""
    try:
        r = httpx.get(url, follow_redirects=False, timeout=10, headers={"Accept": "text/html"})
    except httpx.HTTPError:
        return
    loc = r.headers.get("location", "")
    if "/signin/oauth/error" in loc:  # Google
        q = dict(parse_qsl(urlparse(loc).query))
        try:
            ae = q.get("authError", "")
            f = _pb_strings(base64.urlsafe_b64decode(ae + "=" * (-len(ae) % 4)))
        except (ValueError, TypeError):
            f = {}
        raise OAuthError("vendor_rejected", _explain(f.get(1, "error"), f.get(2, "").strip()))
    if loc.startswith(redirect_uri()) and "error=" in loc:  # vendor bounced straight back with an error
        q = dict(parse_qsl(urlparse(loc).query))
        raise OAuthError("vendor_rejected", _explain(q.get("error", "error"), q.get("error_description", "")))
    if r.status_code < 400 and "login.microsoftonline.com" not in url:
        return
    text = r.text[:200_000]
    m = re.search(r'"sErrorCode":"(\d+)"', text)  # Microsoft renders errors into its sign-in page
    if m and m.group(1) in _MS_ERRORS:  # only configuration errors; e.g. 50058 just means "not signed in yet"
        raise OAuthError("vendor_rejected", _MS_ERRORS[m.group(1)])
    if r.status_code >= 400:
        if text.startswith("error="):  # form-encoded error body (Salesforce)
            q = dict(parse_qsl(text.strip()))
            raise OAuthError("vendor_rejected", _explain(q.get("error", "error"), q.get("error_description", "")))
        m = re.search(r'"error"\s*:\s*"([a-z_]+)"', text) or re.search(r"\berror=([a-z_]+)", text)
        if m:
            raise OAuthError("vendor_rejected", _explain(m.group(1), ""))


def _token_request(o: dict[str, Any], data: dict[str, str]) -> dict[str, Any]:
    try:
        check_url(o["token_url"])
    except BlockedTarget as exc:
        raise OAuthError("blocked_target", str(exc)) from exc
    try:
        r = httpx.post(o["token_url"], data=data, headers={"Accept": "application/json"}, timeout=30,
                       follow_redirects=False)
    except httpx.HTTPError as exc:
        raise OAuthError("network_error", f"token endpoint unreachable: {type(exc).__name__}") from exc
    try:
        body = r.json()
    except ValueError:
        body = {}
    if r.status_code >= 400 or "access_token" not in body:
        err = body.get("error") or f"http_{r.status_code}"
        desc = body.get("error_description") or "the token endpoint rejected the request"
        raise OAuthError(str(err)[:60], str(desc)[:300])
    return body


def _apply_tokens(integ: Integration, bundle: dict[str, Any], tok: dict[str, Any]) -> None:
    bundle["access_token"] = tok["access_token"]
    if tok.get("refresh_token"):  # rotation: always keep the newest refresh token
        bundle["refresh_token"] = tok["refresh_token"]
    expires_in = tok.get("expires_in")
    bundle["expires_at"] = (utcnow() + timedelta(seconds=int(expires_in))).isoformat() if expires_in else None
    if tok.get("scope"):
        bundle["scope"] = tok["scope"]
    bundle.pop("needs_reauthorization", None)
    o = oauth_settings(integ) or {}
    field = o.get("base_url_from_token")
    if field and tok.get(field):
        host = str(tok[field]).rstrip("/")
        try:
            check_url(host + "/")
        except BlockedTarget as exc:
            raise OAuthError("blocked_target", f"{field} rejected by network policy: {exc}") from exc
        if not host.startswith("https://") and urlparse(host).hostname not in set(get_settings().allowed_private_hosts):
            raise OAuthError("insecure_instance", f"{field} must use https")
        bundle["instance_url"] = host
        if integ.type == "http":
            new_base = host + urlparse(integ.config["base_url"]).path
            if new_base != integ.config["base_url"]:  # avoid touching the row (and its lock) when unchanged
                integ.config = {**integ.config, "base_url": new_base}


def complete(db: Session, state: str, code: str, user_id: str, org_id: str) -> Integration:
    """Validate the callback state and exchange the authorization code for tokens."""
    row = db.get(OAuthState, hashlib.sha256(state.encode()).hexdigest()) if state else None
    if row is None or row.org_id != org_id:
        raise OAuthError("invalid_state", "this authorization link is unknown or belongs to another organization")
    if row.used_at is not None:
        raise OAuthError("invalid_state", "this authorization link was already used")
    if row.user_id != user_id:
        raise OAuthError("invalid_state", "authorization must be completed by the person who started it")
    row.used_at = utcnow()
    if row.expires_at < utcnow():
        db.commit()
        raise OAuthError("expired_state", "the authorization took longer than 10 minutes; start again")
    db.commit()  # the state is consumed even if the exchange below fails
    integ = db.get(Integration, row.integration_id)
    o = oauth_settings(integ) if integ else None
    if integ is None or o is None:
        raise OAuthError("invalid_state", "the integration no longer uses OAuth")
    bundle = load_bundle(db, integ)
    data = {"grant_type": "authorization_code", "code": code, "redirect_uri": row.redirect_uri,
            "client_id": bundle.get("client_id", "")}
    if bundle.get("client_secret"):
        data["client_secret"] = bundle["client_secret"]
    if o.get("pkce", True):
        data["code_verifier"] = crypto.decrypt(row.verifier)
    tok = _token_request(o, data)
    _apply_tokens(integ, bundle, tok)
    bundle["authorized_by"] = user_id
    bundle["authorized_at"] = utcnow().isoformat()
    save_bundle(db, integ, bundle, user_id)
    return integ


def _expired(bundle: dict[str, Any]) -> bool:
    exp = bundle.get("expires_at")
    if not exp:
        return False
    from datetime import datetime

    return datetime.fromisoformat(exp) <= utcnow() + timedelta(seconds=REFRESH_SKEW_S)


def access_token(integ_id: str, *, force_refresh: bool = False, stale_token: str | None = None) -> str:
    """Return a valid access token, refreshing it when expired (or when ``force_refresh`` after a 401).

    ``stale_token`` is the token that was just rejected: if another request already refreshed it
    while we waited for the lock, the newer token is returned without a second refresh.
    """
    with _lock(integ_id), session_scope() as db:
        integ = db.get(Integration, integ_id)
        if integ is None:
            raise OAuthError("not_found", "integration not found")
        if integ.secret_id:  # row lock for multi-process deployments (no-op on SQLite)
            db.execute(select(Secret.id).where(Secret.id == integ.secret_id).with_for_update())
        bundle = load_bundle(db, integ)
        if not bundle.get("access_token"):
            raise OAuthError("not_connected", "this integration has not been authorized yet; use Connect")
        if bundle.get("needs_reauthorization"):
            raise OAuthError("reauthorization_required", "authorization expired or was revoked; reconnect it")
        current = bundle["access_token"]
        if stale_token and current != stale_token:
            return current
        if not force_refresh and not _expired(bundle):
            return current
        if not bundle.get("refresh_token"):
            raise OAuthError("reauthorization_required", "the access token expired and no refresh token was issued; reconnect it")
        o = oauth_settings(integ) or {}
        data = {"grant_type": "refresh_token", "refresh_token": bundle["refresh_token"],
                "client_id": bundle.get("client_id", "")}
        if bundle.get("client_secret"):
            data["client_secret"] = bundle["client_secret"]
        try:
            tok = _token_request(o, data)
        except OAuthError as exc:
            if exc.code in ("invalid_grant", "invalid_client", "unauthorized_client",
                            "invalid_refresh_token", "token_revoked", "invalid_client_id"):  # Slack names
                bundle["needs_reauthorization"] = True
                save_bundle(db, integ, bundle, None)
                integ.health = {**(integ.health or {}), "ok": False, "checked_at": utcnow().isoformat(),
                                "detail": "authorization expired or was revoked; reconnect it"}
                db.commit()
                raise OAuthError("reauthorization_required", "authorization expired or was revoked; reconnect it") from exc
            raise
        _apply_tokens(integ, bundle, tok)
        save_bundle(db, integ, bundle, None)
        db.commit()
        return bundle["access_token"]


def disconnect(db: Session, integ: Integration) -> bool:
    """Revoke (best effort) and forget tokens; keep the client credentials. Returns whether the vendor confirmed revocation."""
    o = oauth_settings(integ) or {}
    bundle = load_bundle(db, integ)
    revoked = False
    token = bundle.get("refresh_token") or bundle.get("access_token")
    if o.get("revoke_url") and token:
        try:
            check_url(o["revoke_url"])
            r = httpx.post(o["revoke_url"], data={"token": token}, timeout=15, follow_redirects=False)
            revoked = r.status_code < 400
        except (BlockedTarget, httpx.HTTPError):
            revoked = False
    keep = {k: bundle[k] for k in ("client_id", "client_secret") if bundle.get(k)}
    if keep:
        save_bundle(db, integ, keep, None)
    return revoked

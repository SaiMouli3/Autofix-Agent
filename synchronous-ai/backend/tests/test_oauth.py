"""OAuth sign-in and SAP CSRF flows, end to end through the real API and gateway.

The vendor side is a TEST DOUBLE (``_Vendor``): a local server that behaves like Salesforce's OAuth
and REST endpoints (PKCE S256 check, no ``expires_in``, ``instance_url``, refresh-token rotation
that invalidates the previous token) and like SAP Gateway's CSRF handshake. Real vendors cannot be
made to expire, rotate or revoke tokens on demand, which is what these tests need to exercise.
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

import pytest

from sca.connectors import instantiate
from sca.db import session_scope
from sca.models import Integration
from sca.services import oauth
from sca.services.integrations import IntegrationError, call_operation
from tests.conftest import PASSWORD, login_as


class _VendorState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.codes: dict[str, dict] = {}
        self.access: set[str] = set()
        self.refresh: set[str] = set()
        self.refresh_calls = 0
        self.revoked: list[str] = []
        self.seen_auth: list[str] = []
        self.csrf = "csrf-" + secrets.token_hex(4)
        self.sap_session = "sess-" + secrets.token_hex(4)
        self.sap_writes: list[dict] = []
        self.port = 0


def _make_handler(st: _VendorState):
    class _Vendor(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _json(self, code: int, obj, headers: dict | None = None):
            out = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.send_header("content-length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        def _form(self) -> dict[str, str]:
            n = int(self.headers.get("content-length", 0))
            return {k: v[0] for k, v in parse_qs(self.rfile.read(n).decode()).items()}

        def do_GET(self):  # noqa: N802
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            if u.path == "/services/oauth2/authorize":
                assert q["response_type"] == "code" and q["code_challenge_method"] == "S256"
                code = "code-" + secrets.token_hex(6)
                with st.lock:
                    st.codes[code] = {"challenge": q["code_challenge"], "redirect_uri": q["redirect_uri"],
                                      "client_id": q["client_id"], "scope": q.get("scope", "")}
                loc = q["redirect_uri"] + "?" + urlencode({"code": code, "state": q["state"]})
                self.send_response(302)
                self.send_header("location", loc)
                self.end_headers()
                return
            if u.path.startswith("/services/data/"):
                auth = self.headers.get("authorization", "")
                st.seen_auth.append(auth)
                if auth.removeprefix("Bearer ") not in st.access:
                    return self._json(401, [{"errorCode": "INVALID_SESSION_ID", "message": "Session expired or invalid"}])
                if u.path.endswith("/query"):
                    return self._json(200, {"totalSize": 1, "done": True, "records": [{"Id": "001000000000001AAA", "Name": "Acme"}],
                                            "echo_q": q.get("q")})
                return self._json(200, {"DailyApiRequests": {"Max": 15000, "Remaining": 14999}})
            if u.path.startswith("/sap/"):
                if self.headers.get("x-csrf-token", "").lower() == "fetch":
                    return self._json(200, {"d": {}}, {"x-csrf-token": st.csrf, "set-cookie": f"SAP_SESSIONID={st.sap_session}; Path=/"})
                return self._json(200, {"d": {"results": []}})
            self._json(404, {"error": "not found"})

        def do_POST(self):  # noqa: N802
            u = urlparse(self.path)
            if u.path == "/services/oauth2/token":
                f = self._form()
                with st.lock:
                    if f.get("client_secret") != "shh-secret" or f.get("client_id") != "3MVG9-test-client":
                        return self._json(400, {"error": "invalid_client", "error_description": "invalid client credentials"})
                    if f["grant_type"] == "authorization_code":
                        c = st.codes.pop(f.get("code", ""), None)
                        if c is None:
                            return self._json(400, {"error": "invalid_grant", "error_description": "authorization code is invalid"})
                        digest = base64.urlsafe_b64encode(hashlib.sha256(f["code_verifier"].encode()).digest()).rstrip(b"=").decode()
                        if digest != c["challenge"] or f["redirect_uri"] != c["redirect_uri"]:
                            return self._json(400, {"error": "invalid_grant", "error_description": "PKCE or redirect mismatch"})
                        scope = c["scope"]
                    elif f["grant_type"] == "refresh_token":
                        st.refresh_calls += 1
                        if f.get("refresh_token") not in st.refresh:
                            return self._json(400, {"error": "invalid_grant", "error_description": "expired access/refresh token"})
                        st.refresh.discard(f["refresh_token"])  # rotation: the old refresh token dies
                        scope = "api refresh_token"
                    else:
                        return self._json(400, {"error": "unsupported_grant_type"})
                    at, rt = "at-" + secrets.token_hex(8), "rt-" + secrets.token_hex(8)
                    st.access.add(at)
                    st.refresh.add(rt)
                # Like Salesforce: no expires_in, and the org's API host in instance_url.
                return self._json(200, {"access_token": at, "refresh_token": rt, "scope": scope, "token_type": "Bearer",
                                        "instance_url": f"http://127.0.0.1:{st.port}"})
            if u.path == "/services/oauth2/revoke":
                st.revoked.append(self._form().get("token", ""))
                return self._json(200, {})
            self._json(404, {"error": "not found"})

        def do_PATCH(self):  # noqa: N802
            u = urlparse(self.path)
            n = int(self.headers.get("content-length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            if not u.path.startswith("/sap/"):
                return self._json(404, {})
            if (self.headers.get("x-csrf-token") != st.csrf
                    or f"SAP_SESSIONID={st.sap_session}" not in self.headers.get("cookie", "")):
                return self._json(403, {"error": "CSRF token validation failed"}, {"x-csrf-token": "Required"})
            if self.headers.get("if-match") != 'W/"etag-1"':
                return self._json(412, {"error": "precondition failed"})
            st.sap_writes.append({"path": u.path, "body": body})
            self.send_response(204)
            self.end_headers()

    return _Vendor


@pytest.fixture(scope="module")
def vendor():
    st = _VendorState()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), _make_handler(st))
    st.port = srv.server_port
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield st
    srv.shutdown()


def _salesforce_config(port: int) -> dict:
    """The real Salesforce connector definition, re-pointed at the local test double."""
    cfg = instantiate("salesforce", {"login_host": "login.salesforce.com"})["config"]
    text = json.dumps(cfg).replace("https://login.salesforce.com", f"http://127.0.0.1:{port}")
    cfg = json.loads(text)
    for op in cfg["operations"]:
        if op["name"] == "create_record":
            op["enabled"] = True
    return cfg


def _connect(admin, integ_id: str):
    start = admin.post(f"/api/integrations/{integ_id}/oauth/start")
    assert start.status_code == 200, start.text
    url = start.json()["authorize_url"]
    q = parse_qs(urlparse(url).query)
    assert q["code_challenge_method"] == ["S256"] and len(q["state"][0]) >= 32 and q["scope"] == ["api refresh_token"]
    # The browser would follow the vendor's 302 back to our callback.
    import httpx

    vendor_resp = httpx.get(url, follow_redirects=False)
    assert vendor_resp.status_code == 302
    cb = urlparse(vendor_resp.headers["location"])
    assert cb.path == "/api/oauth/callback"
    return f"{cb.path}?{cb.query}"


def test_oauth_connect_refresh_rotation_and_revocation(admin, vendor):
    r = admin.post("/api/integrations", {"name": "SF test double", "type": "http", "config": _salesforce_config(vendor.port)})
    assert r.status_code == 201, r.text
    i = r.json()
    assert i["oauth"]["connected"] is False and i["oauth"]["redirect_uri"].endswith("/api/oauth/callback")
    assert admin.post(f"/api/integrations/{i['id']}/activate").status_code == 422  # not authorized yet
    assert admin.post(f"/api/integrations/{i['id']}/oauth/start").status_code == 422  # no client yet
    assert admin.post(f"/api/integrations/{i['id']}/credential", {"credential": "x" * 20}).status_code == 409

    r = admin.put(f"/api/integrations/{i['id']}/oauth/client", {"client_id": "3MVG9-test-client", "client_secret": "shh-secret"})
    assert r.status_code == 200 and r.json()["oauth"]["client_configured"] and "shh-secret" not in r.text

    callback = _connect(admin, i["id"])
    # Another user cannot complete someone else's authorization.
    admin.post("/api/users", {"email": "oauth-other@acme.com", "name": "Olive Other", "role": "org_admin", "password": PASSWORD})
    other = login_as(admin.c.base_url, "oauth-other@acme.com")
    stolen = other.c.get(callback, follow_redirects=False)
    assert stolen.status_code == 303 and "oauth_error=" in stolen.headers["location"]
    # ...and the state is single-use, so even the right user cannot replay it now.
    callback = _connect(admin, i["id"])
    done = admin.c.get(callback, follow_redirects=False)
    assert done.status_code == 303 and done.headers["location"] == f"/integrations?id={i['id']}&oauth=connected"
    replay = admin.c.get(callback, follow_redirects=False)
    assert "oauth_error=" in replay.headers["location"]
    bogus = admin.c.get("/api/oauth/callback?state=nope&code=x", follow_redirects=False)
    assert "oauth_error=" in bogus.headers["location"]

    detail = admin.get(f"/api/integrations/{i['id']}")
    d = detail.json()
    assert d["oauth"]["connected"] and d["oauth"]["instance_url"] == f"http://127.0.0.1:{vendor.port}"
    assert d["config"]["base_url"] == f"http://127.0.0.1:{vendor.port}/services/data/v67.0"
    for t in list(vendor.access) + list(vendor.refresh) + ["shh-secret"]:
        assert t not in detail.text  # tokens and the client secret never reach the browser

    assert admin.post(f"/api/integrations/{i['id']}/activate").status_code == 200
    test = admin.post(f"/api/integrations/{i['id']}/test").json()
    assert test["result"]["ok"], test

    with session_scope() as db:
        integ = db.get(Integration, i["id"])
        out = call_operation(db, integ, "soql_query", {"q": "SELECT Id, Name FROM Account LIMIT 1"})
        assert out["ok"] and out["body"]["records"][0]["Name"] == "Acme"
        assert out["body"]["echo_q"] == "SELECT Id, Name FROM Account LIMIT 1"
        first_rt = oauth.load_bundle(db, integ)["refresh_token"]

    # The vendor expires the access token: the gateway refreshes once (rotating the refresh token) and retries.
    vendor.access.clear()
    with session_scope() as db:
        assert call_operation(db, db.get(Integration, i["id"]), "soql_query", {"q": "SELECT Id FROM Account"})["ok"]
    assert vendor.refresh_calls == 1
    with session_scope() as db:
        new_rt = oauth.load_bundle(db, db.get(Integration, i["id"]))["refresh_token"]
    assert new_rt != first_rt and first_rt not in vendor.refresh and new_rt in vendor.refresh

    # Many concurrent calls hit an expired token: exactly one refresh happens (rotation-safe).
    vendor.access.clear()
    results: list = []

    def worker():
        with session_scope() as db:
            try:
                results.append(call_operation(db, db.get(Integration, i["id"]), "soql_query", {"q": "SELECT Id FROM Account"})["ok"])
            except IntegrationError as exc:
                results.append(exc.code)

    threads = [threading.Thread(target=worker) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == [True] * 6, results
    assert vendor.refresh_calls == 2

    # The admin revokes the app at the vendor: the next refresh fails and the integration asks for reauthorization.
    vendor.refresh.clear()
    vendor.access.clear()
    with session_scope() as db:
        with pytest.raises(IntegrationError) as exc:
            call_operation(db, db.get(Integration, i["id"]), "soql_query", {"q": "SELECT Id FROM Account"})
        assert exc.value.code == "reauthorization_required"
    d = admin.get(f"/api/integrations/{i['id']}").json()
    assert d["oauth"]["needs_reauthorization"] and d["health"]["ok"] is False

    # Reconnecting clears it; disconnecting revokes at the vendor and forgets the tokens.
    assert admin.c.get(_connect(admin, i["id"]), follow_redirects=False).headers["location"].endswith("oauth=connected")
    assert not admin.get(f"/api/integrations/{i['id']}").json()["oauth"]["needs_reauthorization"]
    dis = admin.post(f"/api/integrations/{i['id']}/oauth/disconnect").json()
    assert dis["vendor_revoked"] and dis["integration"]["oauth"]["connected"] is False
    assert dis["integration"]["oauth"]["client_configured"] and dis["integration"]["status"] == "disabled"
    assert vendor.revoked
    audit = [e["action"] for e in admin.get(f"/api/integrations/{i['id']}").json()["audit"]]
    assert {"integration.oauth_connected", "integration.oauth_disconnected", "integration.oauth_client_set"} <= set(audit)


def test_sap_csrf_handshake_and_if_match(admin, vendor):
    cfg = instantiate("sap_s4hana", {"host": "my1-api.s4hana.cloud.sap", "username": "COMM_USER"})["config"]
    cfg = json.loads(json.dumps(cfg).replace("https://my1-api.s4hana.cloud.sap", f"http://127.0.0.1:{vendor.port}"))
    for op in cfg["operations"]:
        if op["name"] == "update_business_partner":
            op["enabled"] = True
    i = admin.post("/api/integrations", {"name": "SAP test double", "type": "http", "config": cfg,
                                         "credential": "comm-user-password"}).json()
    assert admin.post(f"/api/integrations/{i['id']}/activate").status_code == 200
    with session_scope() as db:
        integ = db.get(Integration, i["id"])
        out = call_operation(db, integ, "update_business_partner",
                             {"business_partner": "1000123", "if_match": 'W/"etag-1"', "body": {"SearchTerm1": "ACME"}})
        assert out["status"] == 204, out
        # The token expired server-side: SAP answers 403, the gateway fetches a new one and retries once.
        vendor.csrf = "csrf-rotated"
        out = call_operation(db, integ, "update_business_partner",
                             {"business_partner": "1000123", "if_match": 'W/"etag-1"', "body": {"SearchTerm1": "ACME2"}})
        assert out["status"] == 204
    assert [w["path"] for w in vendor.sap_writes] == ["/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_BusinessPartner('1000123')"] * 2
    assert vendor.sap_writes[1]["body"] == {"SearchTerm1": "ACME2"}

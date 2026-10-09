"""Request authentication, CSRF protection and permission checks."""

from __future__ import annotations

import hmac
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from sca.config import get_settings
from sca.db import get_db
from sca.models import AuthSession, Membership, Organization, User, utcnow
from sca.security.crypto import sha256_hex
from sca.security.rbac import has_permission

SESSION_COOKIE = "sca_session"
CSRF_COOKIE = "sca_csrf"
CSRF_HEADER = "x-csrf-token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


@dataclass
class Principal:
    user: User
    org: Organization
    role: str
    session: AuthSession

    @property
    def user_id(self) -> str:
        return self.user.id

    @property
    def org_id(self) -> str:
        return self.org.id

    def can(self, perm: str) -> bool:
        return has_permission(self.role, perm)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def current_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    sess = db.get(AuthSession, sha256_hex(token))
    if sess is None or sess.revoked or sess.expires_at < utcnow():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session expired")
    if request.method not in SAFE_METHODS:
        header = request.headers.get(CSRF_HEADER, "")
        if not header or not hmac.compare_digest(header, sess.csrf_token):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "CSRF token missing or invalid")
    user = db.get(User, sess.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "account disabled")
    mem = db.query(Membership).filter_by(org_id=sess.org_id, user_id=user.id).one_or_none()
    if mem is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no membership in this organization")
    org = db.get(Organization, sess.org_id)
    now = utcnow()
    if (now - sess.last_seen_at).total_seconds() > 300:
        sess.last_seen_at = now
        db.commit()
    request.state.user_id = user.id
    return Principal(user=user, org=org, role=mem.role, session=sess)


def require(perm: str):
    def dep(p: Principal = Depends(current_principal)) -> Principal:
        if not p.can(perm):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"missing permission: {perm}")
        return p

    return dep


def set_session_cookies(response, token: str, csrf: str) -> None:
    s = get_settings()
    max_age = s.session_ttl_hours * 3600
    response.set_cookie(SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=s.cookie_secure,
                        samesite="lax", path="/")
    response.set_cookie(CSRF_COOKIE, csrf, max_age=max_age, httponly=False, secure=s.cookie_secure,
                        samesite="lax", path="/")


def clear_session_cookies(response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def not_found(what: str = "resource") -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")


def scoped(db: Session, model, obj_id: str, p: Principal, what: str):
    """Fetch an org-owned row or 404 (never reveal other tenants' objects)."""
    obj = db.get(model, obj_id)
    if obj is None or getattr(obj, "org_id", None) != p.org_id:
        raise not_found(what)
    return obj

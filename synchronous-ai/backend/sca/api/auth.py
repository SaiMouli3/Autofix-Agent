"""Authentication: first-run setup, login/logout, session info, password change."""

from __future__ import annotations

import hmac
import re
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from sca.api.deps import (
    Principal,
    clear_session_cookies,
    client_ip,
    current_principal,
    set_session_cookies,
)
from sca.config import get_settings
from sca.db import get_db
from sca.models import AuthSession, Membership, ModelProvider, Organization, User, utcnow
from sca.security.crypto import sha256_hex
from sca.security.passwords import hash_password, validate_password_strength, verify_password
from sca.security.ratelimit import limiter
from sca.security.rbac import PERMISSIONS, ROLE_LABELS
from sca.services import audit
from sca.services.secrets import put_secret

router = APIRouter(prefix="/api/auth", tags=["auth"])

_DUMMY_HASH = hash_password("timing-equalizer-Pa55word!")


class SetupIn(BaseModel):
    org_name: str = Field(min_length=2, max_length=200)
    name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str
    bootstrap_token: str = ""


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class PasswordIn(BaseModel):
    current_password: str
    new_password: str


def _rate_limit(request: Request, bucket: str) -> None:
    if not limiter.allow(f"{bucket}:{client_ip(request)}", get_settings().rate_limit_auth_per_min):
        raise HTTPException(429, "too many attempts; try again in a minute")


def _start_session(db: Session, response: Response, request: Request, user: User, org_id: str) -> None:
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    db.add(AuthSession(id=sha256_hex(token), user_id=user.id, org_id=org_id, csrf_token=csrf,
                       expires_at=utcnow() + timedelta(hours=get_settings().session_ttl_hours),
                       ip=client_ip(request), user_agent=(request.headers.get("user-agent") or "")[:300]))
    user.last_login_at = utcnow()
    set_session_cookies(response, token, csrf)


@router.get("/status")
def status(db: Session = Depends(get_db)):
    users = db.execute(select(func.count()).select_from(User)).scalar_one()
    s = get_settings()
    return {"needs_setup": users == 0, "bootstrap_token_required": bool(s.bootstrap_token), "env": s.env}


@router.post("/setup")
def setup(body: SetupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    _rate_limit(request, "setup")
    s = get_settings()
    if db.execute(select(func.count()).select_from(User)).scalar_one() > 0:
        raise HTTPException(409, "already initialized")
    if s.bootstrap_token and not hmac.compare_digest(body.bootstrap_token, s.bootstrap_token):
        raise HTTPException(403, "invalid bootstrap token")
    try:
        validate_password_strength(body.password)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    slug = re.sub(r"[^a-z0-9]+", "-", body.org_name.lower()).strip("-")[:90] or "org"
    org = Organization(name=body.org_name, slug=slug, settings={"require_distinct_approver": False})
    user = User(email=body.email.lower(), name=body.name, password_hash=hash_password(body.password))
    db.add_all([org, user])
    db.flush()
    db.add(Membership(org_id=org.id, user_id=user.id, role="org_admin"))
    audit.record(db, org.id, "org.created", actor_id=user.id, target_type="organization", target_id=org.id,
                 ip=client_ip(request))
    # Seed the Experiential Labs provider from environment configuration, if provided.
    if s.exp_labs_api_key:
        sec = put_secret(db, org.id, "provider:experiential-labs", "provider", s.exp_labs_api_key, user.id)
        db.add(ModelProvider(org_id=org.id, name="Experiential Labs", kind="experiential_labs",
                             base_url=s.exp_labs_base_url or "https://api.experientiallabs.ai/v1",
                             secret_id=sec.id, default_model=s.exp_labs_model or "",
                             embedding_model=s.embedding_model))
        audit.record(db, org.id, "provider.seeded_from_env", actor_type="system", target_type="provider")
    _start_session(db, response, request, user, org.id)
    db.commit()
    return {"ok": True}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    _rate_limit(request, "login")
    user = db.execute(select(User).where(User.email == body.email.lower())).scalar_one_or_none()
    ok = verify_password(user.password_hash if user else _DUMMY_HASH, body.password)
    if not user or not ok or not user.is_active:
        if user:
            mem = db.execute(select(Membership).where(Membership.user_id == user.id)).scalars().first()
            if mem:
                audit.record(db, mem.org_id, "auth.login_failed", actor_id=user.id, ip=client_ip(request))
                db.commit()
        raise HTTPException(401, "invalid email or password")
    mem = db.execute(select(Membership).where(Membership.user_id == user.id).order_by(Membership.created_at)).scalars().first()
    if mem is None:
        raise HTTPException(403, "user has no organization")
    _start_session(db, response, request, user, mem.org_id)
    audit.record(db, mem.org_id, "auth.login", actor_id=user.id, ip=client_ip(request))
    db.commit()
    return {"ok": True, "must_change_password": user.must_change_password}


@router.post("/logout")
def logout(response: Response, p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    sess = db.get(AuthSession, p.session.id)
    sess.revoked = True
    audit.record(db, p.org_id, "auth.logout", actor_id=p.user_id)
    db.commit()
    clear_session_cookies(response)
    return {"ok": True}


@router.get("/me")
def me(p: Principal = Depends(current_principal)):
    return {
        "user": {"id": p.user.id, "email": p.user.email, "name": p.user.name,
                 "must_change_password": p.user.must_change_password},
        "org": {"id": p.org.id, "name": p.org.name, "slug": p.org.slug, "settings": p.org.settings},
        "role": p.role,
        "role_label": ROLE_LABELS.get(p.role, p.role),
        "permissions": sorted(PERMISSIONS.get(p.role, set())),
        "csrf_token": p.session.csrf_token,
        "env": get_settings().env,
        "runtime": get_settings().runtime,
    }


@router.post("/change-password")
def change_password(body: PasswordIn, request: Request, p: Principal = Depends(current_principal),
                    db: Session = Depends(get_db)):
    _rate_limit(request, "pwd")
    user = db.get(User, p.user_id)
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(403, "current password is incorrect")
    try:
        validate_password_strength(body.new_password)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    # Revoke all other sessions.
    for s in db.execute(select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.id != p.session.id)).scalars():
        s.revoked = True
    audit.record(db, p.org_id, "auth.password_changed", actor_id=user.id, ip=client_ip(request))
    db.commit()
    return {"ok": True}

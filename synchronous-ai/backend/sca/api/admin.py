"""Team management, users/roles, organization settings, audit log."""

from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from sca.api.deps import Principal, require, scoped
from sca.db import get_db
from sca.models import AuditEvent, AuthSession, Membership, Team, TeamMember, User
from sca.security.passwords import hash_password, validate_password_strength
from sca.security.rbac import ROLE_LABELS, ROLES
from sca.services import audit

router = APIRouter(prefix="/api", tags=["admin"])


class UserIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=200)
    role: str
    password: str | None = None  # if omitted, a one-time temporary password is generated


class RoleIn(BaseModel):
    role: str


class ActiveIn(BaseModel):
    is_active: bool


class TeamIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=2000)


class TeamMemberIn(BaseModel):
    user_id: str


class SettingsIn(BaseModel):
    require_distinct_approver: bool | None = None
    default_task_priority: int | None = Field(default=None, ge=1, le=10)


def _member_out(m: Membership) -> dict:
    return {"user_id": m.user_id, "email": m.user.email, "name": m.user.name, "role": m.role,
            "role_label": ROLE_LABELS.get(m.role, m.role), "is_active": m.user.is_active,
            "last_login_at": m.user.last_login_at, "created_at": m.created_at}


@router.get("/roles")
def roles(p: Principal = Depends(require("teams:read"))):
    return [{"key": r, "label": ROLE_LABELS[r]} for r in ROLES]


@router.get("/users")
def list_users(p: Principal = Depends(require("teams:read")), db: Session = Depends(get_db)):
    rows = db.execute(select(Membership).where(Membership.org_id == p.org_id).order_by(Membership.created_at)).scalars()
    return [_member_out(m) for m in rows]


@router.post("/users", status_code=201)
def create_user(body: UserIn, p: Principal = Depends(require("users:write")), db: Session = Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(422, "unknown role")
    email = body.email.lower()
    temp = None
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None:
        password = body.password
        if password:
            try:
                validate_password_strength(password)
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
        else:
            temp = password = secrets.token_urlsafe(12) + "aA1!"
        user = User(email=email, name=body.name, password_hash=hash_password(password), must_change_password=temp is not None)
        db.add(user)
        db.flush()
    elif db.execute(select(Membership).where(Membership.org_id == p.org_id, Membership.user_id == user.id)).first():
        raise HTTPException(409, "user is already a member")
    m = Membership(org_id=p.org_id, user_id=user.id, role=body.role)
    db.add(m)
    db.flush()
    audit.record(db, p.org_id, "user.added", actor_id=p.user_id, target_type="user", target_id=user.id,
                 details={"email": email, "role": body.role})
    db.commit()
    db.refresh(m)
    out = _member_out(m)
    if temp:
        out["temporary_password"] = temp  # shown once; user must change it at first login
    return out


@router.put("/users/{user_id}/role")
def set_role(user_id: str, body: RoleIn, p: Principal = Depends(require("users:write")), db: Session = Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(422, "unknown role")
    m = db.execute(select(Membership).where(Membership.org_id == p.org_id, Membership.user_id == user_id)).scalar_one_or_none()
    if m is None:
        raise HTTPException(404, "user not found")
    if m.role == "org_admin" and body.role != "org_admin":
        admins = db.execute(select(func.count()).select_from(Membership).where(Membership.org_id == p.org_id,
                                                                               Membership.role == "org_admin")).scalar_one()
        if admins <= 1:
            raise HTTPException(409, "cannot demote the last organization administrator")
    old = m.role
    m.role = body.role
    audit.record(db, p.org_id, "user.role_changed", actor_id=p.user_id, target_type="user", target_id=user_id,
                 details={"from": old, "to": body.role})
    db.commit()
    return _member_out(m)


@router.put("/users/{user_id}/active")
def set_active(user_id: str, body: ActiveIn, p: Principal = Depends(require("users:write")), db: Session = Depends(get_db)):
    m = db.execute(select(Membership).where(Membership.org_id == p.org_id, Membership.user_id == user_id)).scalar_one_or_none()
    if m is None:
        raise HTTPException(404, "user not found")
    if user_id == p.user_id and not body.is_active:
        raise HTTPException(409, "you cannot deactivate yourself")
    m.user.is_active = body.is_active
    if not body.is_active:
        for s in db.execute(select(AuthSession).where(AuthSession.user_id == user_id)).scalars():
            s.revoked = True
    audit.record(db, p.org_id, "user.activated" if body.is_active else "user.deactivated", actor_id=p.user_id,
                 target_type="user", target_id=user_id)
    db.commit()
    return _member_out(m)


@router.get("/teams")
def list_teams(p: Principal = Depends(require("teams:read")), db: Session = Depends(get_db)):
    out = []
    for t in db.execute(select(Team).where(Team.org_id == p.org_id).order_by(Team.name)).scalars():
        members = db.execute(select(User).join(TeamMember, TeamMember.user_id == User.id)
                             .where(TeamMember.team_id == t.id)).scalars().all()
        out.append({"id": t.id, "name": t.name, "description": t.description, "created_at": t.created_at,
                    "members": [{"id": u.id, "name": u.name, "email": u.email} for u in members]})
    return out


@router.post("/teams", status_code=201)
def create_team(body: TeamIn, p: Principal = Depends(require("teams:write")), db: Session = Depends(get_db)):
    if db.execute(select(Team).where(Team.org_id == p.org_id, Team.name == body.name)).first():
        raise HTTPException(409, "team already exists")
    t = Team(org_id=p.org_id, name=body.name, description=body.description)
    db.add(t)
    db.flush()
    audit.record(db, p.org_id, "team.created", actor_id=p.user_id, target_type="team", target_id=t.id,
                 details={"name": t.name})
    db.commit()
    return {"id": t.id, "name": t.name, "description": t.description, "members": []}


@router.post("/teams/{team_id}/members", status_code=201)
def add_member(team_id: str, body: TeamMemberIn, p: Principal = Depends(require("teams:write")),
               db: Session = Depends(get_db)):
    scoped(db, Team, team_id, p, "team")
    if not db.execute(select(Membership).where(Membership.org_id == p.org_id, Membership.user_id == body.user_id)).first():
        raise HTTPException(404, "user not found")
    if not db.execute(select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == body.user_id)).first():
        db.add(TeamMember(team_id=team_id, user_id=body.user_id))
    audit.record(db, p.org_id, "team.member_added", actor_id=p.user_id, target_type="team", target_id=team_id,
                 details={"user_id": body.user_id})
    db.commit()
    return {"ok": True}


@router.delete("/teams/{team_id}/members/{user_id}")
def remove_member(team_id: str, user_id: str, p: Principal = Depends(require("teams:write")),
                  db: Session = Depends(get_db)):
    scoped(db, Team, team_id, p, "team")
    tm = db.execute(select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user_id)).scalar_one_or_none()
    if tm:
        db.delete(tm)
    audit.record(db, p.org_id, "team.member_removed", actor_id=p.user_id, target_type="team", target_id=team_id,
                 details={"user_id": user_id})
    db.commit()
    return {"ok": True}


@router.put("/org/settings")
def update_settings(body: SettingsIn, p: Principal = Depends(require("settings:write")), db: Session = Depends(get_db)):
    org = p.org
    settings: dict[str, Any] = dict(org.settings or {})
    settings.update(body.model_dump(exclude_none=True))
    org.settings = settings
    audit.record(db, p.org_id, "org.settings_updated", actor_id=p.user_id, details=body.model_dump(exclude_none=True))
    db.commit()
    return settings


@router.get("/audit")
def audit_log(action: str = "", actor_id: str = "", target_id: str = "", page: int = Query(1, ge=1),
              page_size: int = Query(100, le=500), p: Principal = Depends(require("audit:read")),
              db: Session = Depends(get_db)):
    stmt = select(AuditEvent).where(AuditEvent.org_id == p.org_id)
    if action:
        stmt = stmt.where(AuditEvent.action.like(f"{action}%"))
    if actor_id:
        stmt = stmt.where(AuditEvent.actor_id == actor_id)
    if target_id:
        stmt = stmt.where(AuditEvent.target_id == target_id)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.order_by(AuditEvent.id.desc()).offset((page - 1) * page_size).limit(page_size)).scalars()
    names = {u.id: u.name for u in db.execute(select(User)).scalars()}
    return {"total": total, "items": [
        {"id": e.id, "ts": e.ts, "actor_type": e.actor_type, "actor_id": e.actor_id,
         "actor_name": names.get(e.actor_id, ""), "action": e.action, "target_type": e.target_type,
         "target_id": e.target_id, "ip": e.ip, "details": e.details, "hash": e.hash[:16]}
        for e in rows]}


@router.get("/audit/verify")
def audit_verify(p: Principal = Depends(require("audit:read")), db: Session = Depends(get_db)):
    return audit.verify_chain(db, p.org_id)

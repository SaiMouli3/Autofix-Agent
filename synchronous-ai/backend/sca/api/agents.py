"""Agent registry: create, configure (versioned), activate/disable, catalog."""

from __future__ import annotations

import shutil
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from sca.agent_config import ALL_TOOLS, PLATFORM_TOOLS, RUNTIME_TOOLS, AgentConfig
from sca.api.deps import Principal, require, scoped
from sca.config import get_settings
from sca.db import get_db
from sca.models import (
    Agent,
    AgentVersion,
    ApprovalRequest,
    TASK_ACTIVE_STATES,
    Integration,
    KnowledgeSource,
    ModelProvider,
    Schedule,
    Task,
    Team,
    User,
)
from sca.services import audit, websearch
from sca.templates import TEMPLATES

router = APIRouter(prefix="/api", tags=["agents"])


class Identity(BaseModel):
    name: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _.\-]*$")
    description: str = Field(default="", max_length=2000)
    category: str = Field(default="General", max_length=60)
    avatar: dict[str, str] = Field(default_factory=lambda: {"icon": "bot", "color": "#F97316"})
    team_id: str | None = None
    tags: list[str] = Field(default_factory=list, max_length=20)


class AgentIn(Identity):
    config: dict[str, Any]
    status: Literal["draft", "active"] = "active"
    change_note: str = Field(default="", max_length=300)


class AgentUpdate(BaseModel):
    identity: Identity | None = None
    config: dict[str, Any] | None = None
    change_note: str = Field(default="", max_length=300)


class StatusIn(BaseModel):
    status: Literal["draft", "active", "disabled"]


def _validate_config(db: Session, p: Principal, raw: dict[str, Any], agent_id: str | None = None) -> AgentConfig:
    try:
        cfg = AgentConfig.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_url=False, include_context=False)) from exc
    prov = db.get(ModelProvider, cfg.model.provider_id)
    if prov is None or prov.org_id != p.org_id:
        raise HTTPException(422, "model provider not found")
    if prov.catalog:
        entry = next((m for m in prov.catalog if m["id"] == cfg.model.model), None)
        if entry is None:
            raise HTTPException(422, f"model '{cfg.model.model}' is not offered by {prov.name}")
        if entry.get("supports_tools") is False:
            raise HTTPException(422, f"model '{cfg.model.model}' does not support tool calling (required by the agent runtime)")
        if cfg.model.fallback_model and not any(m["id"] == cfg.model.fallback_model for m in prov.catalog):
            raise HTTPException(422, f"fallback model '{cfg.model.fallback_model}' is not offered by {prov.name}")
    if "browser" in cfg.tools and not get_settings().enable_browser_tool:
        raise HTTPException(422, "the browser tool is not enabled on this deployment (SCA_ENABLE_BROWSER_TOOL)")
    if "web_search" in cfg.tools and not websearch.api_key(db, p.org_id)[0]:
        raise HTTPException(422, "Web search is not set up yet: an administrator adds the Tavily API key in Settings → Web search.")
    for iid in cfg.integrations:
        integ = db.get(Integration, iid)
        if integ is None or integ.org_id != p.org_id:
            raise HTTPException(422, f"integration {iid} not found")
    for sid in cfg.knowledge_sources:
        src = db.get(KnowledgeSource, sid)
        if src is None or src.org_id != p.org_id:
            raise HTTPException(422, f"knowledge source {sid} not found")
    for aid in cfg.policy.delegation.allowed_agent_ids:
        a = db.get(Agent, aid)
        if a is None or a.org_id != p.org_id or aid == agent_id:
            raise HTTPException(422, "delegation targets must be other agents in this organization")
    return cfg


def _agent_out(db: Session, a: Agent, with_config: bool = False) -> dict[str, Any]:
    counts = dict(db.execute(select(Task.status, func.count()).where(Task.agent_id == a.id).group_by(Task.status)).all())
    pending = db.execute(select(func.count()).select_from(ApprovalRequest)
                         .where(ApprovalRequest.agent_id == a.id, ApprovalRequest.status == "pending")).scalar_one()
    if a.status != "active":
        live = a.status
    elif counts.get("waiting_for_approval") or pending:
        live = "waiting_for_approval"
    elif counts.get("running"):
        live = "running"
    elif counts.get("queued"):
        live = "queued"
    else:
        last = db.execute(select(Task.status).where(Task.agent_id == a.id, Task.parent_task_id.is_(None))
                          .order_by(Task.created_at.desc()).limit(1)).scalar_one_or_none()
        live = {"failed": "failed", "timed_out": "failed", "completed": "completed"}.get(last or "", "idle")
    out = {
        "id": a.id, "name": a.name, "description": a.description, "category": a.category, "avatar": a.avatar,
        "tags": a.tags, "status": a.status, "live_status": live, "team_id": a.team_id, "owner_id": a.owner_id,
        "current_version": a.current_version, "created_at": a.created_at, "updated_at": a.updated_at,
        "task_counts": counts, "pending_approvals": pending,
    }
    if with_config:
        ver = db.execute(select(AgentVersion).where(AgentVersion.agent_id == a.id,
                                                    AgentVersion.version == a.current_version)).scalar_one()
        out["config"] = ver.config
        owner = db.get(User, a.owner_id)
        out["owner"] = {"id": owner.id, "name": owner.name, "email": owner.email} if owner else None
        team = db.get(Team, a.team_id) if a.team_id else None
        out["team"] = {"id": team.id, "name": team.name} if team else None
        prov = db.get(ModelProvider, ver.config["model"]["provider_id"])
        out["provider"] = {"id": prov.id, "name": prov.name, "kind": prov.kind, "status": prov.status} if prov else None
    return out


@router.get("/agents")
def list_agents(
    q: str = "", status: str = "", category: str = "", team_id: str = "", owner_id: str = "",
    sort: Literal["name", "updated", "created"] = "name",
    page: int = Query(1, ge=1), page_size: int = Query(100, ge=1, le=500),
    p: Principal = Depends(require("agents:read")), db: Session = Depends(get_db),
):
    stmt = select(Agent).where(Agent.org_id == p.org_id)
    if q:
        stmt = stmt.where(Agent.name.ilike(f"%{q}%") | Agent.description.ilike(f"%{q}%"))
    if status in ("draft", "active", "disabled"):
        stmt = stmt.where(Agent.status == status)
    if category:
        stmt = stmt.where(Agent.category == category)
    if team_id:
        stmt = stmt.where(Agent.team_id == team_id)
    if owner_id:
        stmt = stmt.where(Agent.owner_id == owner_id)
    order = {"name": Agent.name, "updated": Agent.updated_at.desc(), "created": Agent.created_at.desc()}[sort]
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.order_by(order).offset((page - 1) * page_size).limit(page_size)).scalars().all()
    items = [_agent_out(db, a) for a in rows]
    if status and status not in ("draft", "active", "disabled"):
        items = [i for i in items if i["live_status"] == status]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.post("/agents", status_code=201)
def create_agent(body: AgentIn, p: Principal = Depends(require("agents:write")), db: Session = Depends(get_db)):
    if db.execute(select(Agent).where(Agent.org_id == p.org_id, func.lower(Agent.name) == body.name.lower())).first():
        raise HTTPException(409, "an agent with this name already exists")
    if body.team_id:
        scoped(db, Team, body.team_id, p, "team")
    cfg = _validate_config(db, p, body.config)
    agent = Agent(org_id=p.org_id, team_id=body.team_id, owner_id=p.user_id, name=body.name.strip(),
                  description=body.description, category=body.category, avatar=body.avatar,
                  tags=[t.strip()[:40] for t in body.tags if t.strip()], status=body.status, current_version=1)
    db.add(agent)
    db.flush()
    db.add(AgentVersion(agent_id=agent.id, version=1, config=cfg.model_dump(), created_by=p.user_id,
                        change_note=body.change_note or "initial version"))
    audit.record(db, p.org_id, "agent.created", actor_id=p.user_id, target_type="agent", target_id=agent.id,
                 details={"name": agent.name, "tools": cfg.tools, "model": cfg.model.model, "status": agent.status})
    db.commit()
    return _agent_out(db, agent, with_config=True)


@router.get("/agents/{agent_id}")
def get_agent(agent_id: str, p: Principal = Depends(require("agents:read")), db: Session = Depends(get_db)):
    return _agent_out(db, scoped(db, Agent, agent_id, p, "agent"), with_config=True)


@router.put("/agents/{agent_id}")
def update_agent(agent_id: str, body: AgentUpdate, p: Principal = Depends(require("agents:write")),
                 db: Session = Depends(get_db)):
    agent = scoped(db, Agent, agent_id, p, "agent")
    changes: dict[str, Any] = {}
    if body.identity:
        ident = body.identity
        if ident.name.lower() != agent.name.lower() and db.execute(
                select(Agent).where(Agent.org_id == p.org_id, func.lower(Agent.name) == ident.name.lower())).first():
            raise HTTPException(409, "an agent with this name already exists")
        if ident.team_id:
            scoped(db, Team, ident.team_id, p, "team")
        for f in ("name", "description", "category", "avatar", "team_id", "tags"):
            if getattr(agent, f) != getattr(ident, f):
                changes[f] = True
                setattr(agent, f, getattr(ident, f))
    if body.config is not None:
        cfg = _validate_config(db, p, body.config, agent_id=agent.id)
        cur = db.execute(select(AgentVersion).where(AgentVersion.agent_id == agent.id,
                                                    AgentVersion.version == agent.current_version)).scalar_one()
        if cur.config != cfg.model_dump():
            agent.current_version += 1
            db.add(AgentVersion(agent_id=agent.id, version=agent.current_version, config=cfg.model_dump(),
                                created_by=p.user_id, change_note=body.change_note))
            changes["config_version"] = agent.current_version
            old_tools, new_tools = set(cur.config.get("tools", [])), set(cfg.tools)
            if old_tools != new_tools:
                changes["tools_added"] = sorted(new_tools - old_tools)
                changes["tools_removed"] = sorted(old_tools - new_tools)
            if cur.config.get("policy") != cfg.policy.model_dump():
                changes["policy_changed"] = True
    if changes:
        audit.record(db, p.org_id, "agent.updated", actor_id=p.user_id, target_type="agent", target_id=agent.id,
                     details=changes)
    db.commit()
    return _agent_out(db, agent, with_config=True)


@router.post("/agents/{agent_id}/status")
def set_status(agent_id: str, body: StatusIn, p: Principal = Depends(require("agents:write")),
               db: Session = Depends(get_db)):
    agent = scoped(db, Agent, agent_id, p, "agent")
    agent.status = body.status
    audit.record(db, p.org_id, f"agent.{body.status}", actor_id=p.user_id, target_type="agent", target_id=agent.id)
    db.commit()
    return _agent_out(db, agent)


@router.delete("/agents/{agent_id}")
def delete_agent(agent_id: str, p: Principal = Depends(require("agents:write")), db: Session = Depends(get_db)):
    """Permanently delete an agent with its versions, tasks, sessions, schedules and workspace files.
    Refused while it has active tasks or pending approvals. Usage records and the audit log are kept.
    Other agents that could delegate to it get a new config version without it."""
    agent = scoped(db, Agent, agent_id, p, "agent")
    active = db.execute(select(func.count()).select_from(Task)
                        .where(Task.agent_id == agent.id, Task.status.in_(TASK_ACTIVE_STATES))).scalar_one()
    pending = db.execute(select(func.count()).select_from(ApprovalRequest)
                         .where(ApprovalRequest.agent_id == agent.id, ApprovalRequest.status == "pending")).scalar_one()
    if active or pending:
        raise HTTPException(409, f"{agent.name} has {active} active task(s) and {pending} pending approval(s). "
                                 "Cancel them first, then delete the agent.")
    # Drop it from other agents' delegation allow-lists (a new, audited version for each).
    updated: list[str] = []
    for other in db.execute(select(Agent).where(Agent.org_id == p.org_id, Agent.id != agent.id)).scalars():
        cur = db.execute(select(AgentVersion).where(AgentVersion.agent_id == other.id,
                                                    AgentVersion.version == other.current_version)).scalar_one()
        allowed = ((cur.config.get("policy") or {}).get("delegation") or {}).get("allowed_agent_ids") or []
        if agent.id not in allowed:
            continue
        cfg = dict(cur.config)
        policy = dict(cfg["policy"])
        policy["delegation"] = {**policy["delegation"], "allowed_agent_ids": [a for a in allowed if a != agent.id]}
        cfg["policy"] = policy
        other.current_version += 1
        db.add(AgentVersion(agent_id=other.id, version=other.current_version, config=cfg, created_by=p.user_id,
                            change_note=f"Removed deleted agent {agent.name} from delegation targets"[:300]))
        updated.append(other.name)
    tasks = db.execute(select(func.count()).select_from(Task).where(Task.agent_id == agent.id)).scalar_one()
    schedules = db.execute(select(func.count()).select_from(Schedule).where(Schedule.agent_id == agent.id)).scalar_one()
    audit.record(db, p.org_id, "agent.deleted", actor_id=p.user_id, target_type="agent", target_id=agent.id,
                 details={"name": agent.name, "versions": agent.current_version, "tasks": tasks,
                          "schedules": schedules, "delegation_updated": updated})
    db.delete(agent)  # versions, sessions, tasks (with events, artifacts, approvals) and schedules cascade
    db.commit()
    root = get_settings().workspaces_dir
    ws = (root / p.org_id / agent_id).resolve()
    if ws.is_relative_to(root) and ws != root:
        shutil.rmtree(ws, ignore_errors=True)
    return {"deleted": True, "tasks_deleted": tasks, "schedules_deleted": schedules, "delegation_updated": updated}


@router.get("/agents/{agent_id}/versions")
def versions(agent_id: str, p: Principal = Depends(require("agents:read")), db: Session = Depends(get_db)):
    scoped(db, Agent, agent_id, p, "agent")
    rows = db.execute(select(AgentVersion).where(AgentVersion.agent_id == agent_id)
                      .order_by(AgentVersion.version.desc())).scalars().all()
    return [{"version": v.version, "change_note": v.change_note, "created_by": v.created_by,
             "created_at": v.created_at, "config": v.config} for v in rows]


@router.get("/catalog/tools")
def tool_catalog(p: Principal = Depends(require("agents:read")), db: Session = Depends(get_db)):
    s = get_settings()
    web_ready = bool(websearch.api_key(db, p.org_id)[0])
    out = []
    for key, meta in ALL_TOOLS.items():
        available, reason = True, ""
        if key == "browser" and not s.enable_browser_tool:
            available, reason = False, "disabled on this deployment"
        if key == "web_search" and not web_ready:
            available, reason = False, "not set up: add the Tavily API key in Settings → Web search"
        out.append({"key": key, **meta, "kind": "runtime" if key in RUNTIME_TOOLS else "platform",
                    "available": available, "unavailable_reason": reason})
    return {"tools": out, "platform_tools": list(PLATFORM_TOOLS)}


@router.get("/catalog/templates")
def templates(p: Principal = Depends(require("agents:read"))):
    return TEMPLATES

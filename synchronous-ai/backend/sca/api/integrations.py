"""Integration center: HTTP APIs and MCP servers, imports, tests, activation."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from sca.api.deps import Principal, require, scoped
from sca.db import get_db
from sca.agent_config import AgentConfig
from sca.connectors import ConnectorError, instantiate, public_catalog
from sca.models import Agent, AgentVersion, AuditEvent, Integration, Secret
from sca.services import audit
from sca.services.integrations import (
    proposal_from_description,
    proposal_from_openapi,
    test_connection,
    validate_config,
    validation_report,
)
from sca.services.secrets import put_secret

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

CATEGORIES = ("business_api", "developer_tools", "database", "communication", "documents", "other")
Category = Literal["business_api", "developer_tools", "database", "communication", "documents", "other"]


class IntegrationIn(BaseModel):
    name: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _.\-]*$")
    description: str = Field(default="", max_length=2000)
    type: Literal["http", "mcp"]
    category: Category = "business_api"
    config: dict[str, Any]
    credential: str | None = Field(default=None, max_length=4000)


class IntegrationUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=2000)
    category: Category | None = None
    config: dict[str, Any] | None = None


class PermittedAgentsIn(BaseModel):
    agent_ids: list[str] = Field(default_factory=list, max_length=500)


class CredentialIn(BaseModel):
    credential: str = Field(min_length=1, max_length=4000)


class OpenApiIn(BaseModel):
    spec: str = Field(min_length=10, max_length=2_000_000)


class DescribeIn(BaseModel):
    description: str = Field(min_length=5, max_length=4000)
    documentation: str = Field(min_length=20, max_length=200_000)


def _permitted_agents(db: Session, org_id: str, integ_id: str) -> list[dict]:
    out = []
    for a in db.execute(select(Agent).where(Agent.org_id == org_id)).scalars():
        ver = db.execute(select(AgentVersion.config).where(AgentVersion.agent_id == a.id,
                                                           AgentVersion.version == a.current_version)).scalar_one()
        if integ_id in (ver.get("integrations") or []):
            out.append({"id": a.id, "name": a.name})
    return out


def _out(db: Session, i: Integration, detail: bool = False) -> dict:
    sec = db.get(Secret, i.secret_id) if i.secret_id else None
    out = {"id": i.id, "name": i.name, "description": i.description, "type": i.type, "category": i.category,
           "status": i.status,
           "config": i.config, "has_credential": sec is not None, "credential_fingerprint": sec.fingerprint if sec else None,
           "health": i.health, "last_success_at": i.last_success_at, "created_at": i.created_at,
           "updated_at": i.updated_at, "approved_by": i.approved_by,
           "permitted_agents": _permitted_agents(db, i.org_id, i.id)}
    if detail:
        out["validation"] = validation_report(i.type, i.config)
        out["audit"] = [
            {"id": e.id, "ts": e.ts, "action": e.action, "actor_type": e.actor_type, "actor_id": e.actor_id,
             "details": e.details}
            for e in db.execute(select(AuditEvent).where(AuditEvent.org_id == i.org_id, AuditEvent.target_id == i.id)
                                .order_by(AuditEvent.id.desc()).limit(100)).scalars()
        ]
    return out


@router.get("")
def list_integrations(p: Principal = Depends(require("integrations:read")), db: Session = Depends(get_db)):
    rows = db.execute(select(Integration).where(Integration.org_id == p.org_id).order_by(Integration.name)).scalars()
    return [_out(db, i) for i in rows]


class ConnectorIn(BaseModel):
    params: dict[str, str] = Field(default_factory=dict)
    name: str | None = Field(default=None, min_length=2, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _.\-]*$")
    credential: str | None = Field(default=None, max_length=4000)


@router.get("/connectors")
def list_connectors(p: Principal = Depends(require("integrations:read"))):
    return public_catalog()


@router.post("/connectors/{key}", status_code=201)
def create_from_connector(key: str, body: ConnectorIn, p: Principal = Depends(require("integrations:write")),
                          db: Session = Depends(get_db)):
    """Create a proposed integration from a prebuilt connector. It still needs a live test and activation."""
    try:
        spec = instantiate(key, body.params)
    except ConnectorError as exc:
        raise HTTPException(404 if str(exc).startswith("unknown connector") else 422, str(exc)) from exc
    i = _create(db, p, name=body.name or spec["name"], description=spec["description"], kind=spec["type"],
                category=spec["category"], config=spec["config"], credential=body.credential,
                details={"connector": key})
    db.commit()
    return _out(db, i, detail=True)


def _create(db: Session, p: Principal, *, name: str, description: str, kind: str, category: str,
            config: dict[str, Any], credential: str | None, details: dict[str, Any] | None = None) -> Integration:
    if db.execute(select(Integration).where(Integration.org_id == p.org_id, Integration.name == name)).first():
        raise HTTPException(409, "an integration with this name already exists")
    try:
        cfg = validate_config(kind, config)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, str(exc)) from exc
    i = Integration(org_id=p.org_id, name=name, description=description, type=kind,
                    category=category, config=cfg, status="proposed", created_by=p.user_id)
    db.add(i)
    db.flush()
    if credential:
        i.secret_id = put_secret(db, p.org_id, f"integration:{i.id}", "integration", credential, p.user_id).id
    audit.record(db, p.org_id, "integration.created", actor_id=p.user_id, target_type="integration", target_id=i.id,
                 details={"name": i.name, "type": i.type, **(details or {})})
    return i


@router.post("", status_code=201)
def create_integration(body: IntegrationIn, p: Principal = Depends(require("integrations:write")),
                       db: Session = Depends(get_db)):
    i = _create(db, p, name=body.name, description=body.description, kind=body.type, category=body.category,
                config=body.config, credential=body.credential)
    db.commit()
    return _out(db, i, detail=True)


@router.get("/{integration_id}")
def get_integration(integration_id: str, p: Principal = Depends(require("integrations:read")),
                    db: Session = Depends(get_db)):
    return _out(db, scoped(db, Integration, integration_id, p, "integration"), detail=True)


@router.put("/{integration_id}")
def update_integration(integration_id: str, body: IntegrationUpdate,
                       p: Principal = Depends(require("integrations:write")), db: Session = Depends(get_db)):
    i = scoped(db, Integration, integration_id, p, "integration")
    if body.description is not None:
        i.description = body.description
    if body.category is not None:
        i.category = body.category
    if body.config is not None:
        try:
            new = validate_config(i.type, body.config)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(422, str(exc)) from exc
        if new != i.config and i.status == "active":
            i.status = "proposed"  # configuration changes require re-approval
        i.config = new
    audit.record(db, p.org_id, "integration.updated", actor_id=p.user_id, target_type="integration", target_id=i.id,
                 details={"config_changed": body.config is not None, "status": i.status})
    db.commit()
    return _out(db, i, detail=True)


@router.post("/{integration_id}/credential")
def set_credential(integration_id: str, body: CredentialIn, p: Principal = Depends(require("integrations:write")),
                   db: Session = Depends(get_db)):
    i = scoped(db, Integration, integration_id, p, "integration")
    sec = put_secret(db, p.org_id, f"integration:{i.id}", "integration", body.credential, p.user_id)
    i.secret_id = sec.id
    audit.record(db, p.org_id, "integration.credential_updated", actor_id=p.user_id, target_type="integration",
                 target_id=i.id, details={"fingerprint": sec.fingerprint})
    db.commit()
    return _out(db, i)


@router.post("/{integration_id}/test")
def test(integration_id: str, p: Principal = Depends(require("integrations:write")), db: Session = Depends(get_db)):
    i = scoped(db, Integration, integration_id, p, "integration")
    result = test_connection(db, i)
    audit.record(db, p.org_id, "integration.tested", actor_id=p.user_id, target_type="integration", target_id=i.id,
                 details={"ok": result.get("ok"), "detail": result.get("detail")})
    db.commit()
    return {"integration": _out(db, i), "result": result}


@router.post("/{integration_id}/activate")
def activate(integration_id: str, p: Principal = Depends(require("integrations:write")), db: Session = Depends(get_db)):
    i = scoped(db, Integration, integration_id, p, "integration")
    report = validation_report(i.type, i.config)
    errors = [c for c in report if not c["ok"] and c["severity"] == "error"]
    if errors:
        raise HTTPException(422, {"message": "validation failed", "checks": errors})
    if i.config.get("auth", {}).get("type", "none") != "none" and not i.secret_id:
        raise HTTPException(422, "attach a credential before activating this integration")
    i.status = "active"
    i.approved_by = p.user_id
    audit.record(db, p.org_id, "integration.activated", actor_id=p.user_id, target_type="integration", target_id=i.id,
                 details={"enabled_operations": [o["name"] for o in i.config.get("operations", []) if o.get("enabled")]})
    db.commit()
    return _out(db, i, detail=True)


@router.post("/{integration_id}/disable")
def disable(integration_id: str, p: Principal = Depends(require("integrations:write")), db: Session = Depends(get_db)):
    i = scoped(db, Integration, integration_id, p, "integration")
    i.status = "disabled"
    audit.record(db, p.org_id, "integration.disabled", actor_id=p.user_id, target_type="integration", target_id=i.id)
    db.commit()
    return _out(db, i)


@router.put("/{integration_id}/agents")
def set_permitted_agents(integration_id: str, body: PermittedAgentsIn,
                         p: Principal = Depends(require("integrations:write")), db: Session = Depends(get_db)):
    """Grant or revoke this integration for agents. Each changed agent gets a new config version."""
    if not p.can("agents:write"):
        raise HTTPException(403, "changing agent permissions requires agents:write")
    i = scoped(db, Integration, integration_id, p, "integration")
    wanted = set(body.agent_ids)
    for aid in wanted:
        scoped(db, Agent, aid, p, "agent")
    changed: list[str] = []
    for a in db.execute(select(Agent).where(Agent.org_id == p.org_id)).scalars():
        ver = db.execute(select(AgentVersion).where(AgentVersion.agent_id == a.id,
                                                    AgentVersion.version == a.current_version)).scalar_one()
        cfg = dict(ver.config)
        current = list(cfg.get("integrations") or [])
        has = i.id in current
        if (a.id in wanted) == has:
            continue
        if a.id in wanted:
            current.append(i.id)
            tools = set(cfg.get("tools") or [])
            if i.type == "http":
                tools.add("integrations")
            cfg["tools"] = sorted(tools)
        else:
            current.remove(i.id)
        cfg["integrations"] = current
        new_cfg = AgentConfig.model_validate(cfg).model_dump()
        a.current_version += 1
        db.add(AgentVersion(agent_id=a.id, version=a.current_version, config=new_cfg, created_by=p.user_id,
                            change_note=f"{'granted' if a.id in wanted else 'revoked'} integration {i.name}"))
        changed.append(a.name)
    audit.record(db, p.org_id, "integration.permissions_changed", actor_id=p.user_id, target_type="integration",
                 target_id=i.id, details={"agents": sorted(wanted), "changed": changed})
    db.commit()
    return _out(db, i, detail=True)


@router.delete("/{integration_id}")
def delete_integration(integration_id: str, p: Principal = Depends(require("integrations:write")),
                       db: Session = Depends(get_db)):
    i = scoped(db, Integration, integration_id, p, "integration")
    users = _permitted_agents(db, p.org_id, i.id)
    if users:
        raise HTTPException(409, f"revoke access first: still assigned to {', '.join(a['name'] for a in users)}")
    if i.secret_id:
        sec = db.get(Secret, i.secret_id)
        if sec is not None:
            db.delete(sec)
    db.delete(i)
    audit.record(db, p.org_id, "integration.deleted", actor_id=p.user_id, target_type="integration",
                 target_id=integration_id, details={"name": i.name})
    db.commit()
    return {"ok": True}


@router.post("/import/openapi")
def import_openapi(body: OpenApiIn, p: Principal = Depends(require("integrations:write"))):
    try:
        proposal = proposal_from_openapi(body.spec)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, f"could not parse specification: {exc}") from exc
    return {"proposal": proposal, "validation": validation_report("http", proposal["config"]),
            "note": "Review the proposal. Write operations start disabled and require approval when enabled. "
                    "No credentials are extracted; attach one after review."}


@router.post("/import/describe")
def import_describe(body: DescribeIn, p: Principal = Depends(require("integrations:write")),
                    db: Session = Depends(get_db)):
    try:
        proposal = proposal_from_description(db, p.org_id, body.description, body.documentation)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, str(exc)) from exc
    audit.record(db, p.org_id, "integration.proposal_generated", actor_id=p.user_id,
                 details={"name": proposal["name"], "operations": len(proposal["config"]["operations"])})
    db.commit()
    return {"proposal": proposal, "validation": validation_report("http", proposal["config"]),
            "note": "Generated by a model from your documentation. Verify every operation before activation."}

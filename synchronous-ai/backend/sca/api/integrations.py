"""Integration center: HTTP APIs and MCP servers, imports, tests, activation."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from sca.api.deps import Principal, require, scoped
from sca.db import get_db
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


class IntegrationIn(BaseModel):
    name: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _.\-]*$")
    description: str = Field(default="", max_length=2000)
    type: Literal["http", "mcp"]
    config: dict[str, Any]
    credential: str | None = Field(default=None, max_length=4000)


class IntegrationUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=2000)
    config: dict[str, Any] | None = None


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
    out = {"id": i.id, "name": i.name, "description": i.description, "type": i.type, "status": i.status,
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


@router.post("", status_code=201)
def create_integration(body: IntegrationIn, p: Principal = Depends(require("integrations:write")),
                       db: Session = Depends(get_db)):
    if db.execute(select(Integration).where(Integration.org_id == p.org_id, Integration.name == body.name)).first():
        raise HTTPException(409, "an integration with this name already exists")
    try:
        cfg = validate_config(body.type, body.config)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, str(exc)) from exc
    i = Integration(org_id=p.org_id, name=body.name, description=body.description, type=body.type, config=cfg,
                    status="proposed", created_by=p.user_id)
    db.add(i)
    db.flush()
    if body.credential:
        i.secret_id = put_secret(db, p.org_id, f"integration:{i.id}", "integration", body.credential, p.user_id).id
    audit.record(db, p.org_id, "integration.created", actor_id=p.user_id, target_type="integration", target_id=i.id,
                 details={"name": i.name, "type": i.type})
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

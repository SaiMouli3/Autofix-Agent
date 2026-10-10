"""Human approval of sensitive agent actions."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from sca import events as bus
from sca.api.deps import Principal, require, scoped
from sca.db import get_db
from sca.models import Agent, ApprovalRequest, Task, User, utcnow
from sca.orchestrator import executor
from sca.orchestrator.dispatcher import get_orchestrator
from sca.services import audit

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


class DecisionIn(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str = Field(default="", max_length=2000)


def _out(db: Session, a: ApprovalRequest) -> dict:
    agent = db.get(Agent, a.agent_id)
    task = db.get(Task, a.task_id)
    decider = db.get(User, a.decided_by) if a.decided_by else None
    return {"id": a.id, "task_id": a.task_id, "task_title": task.title if task else "", "agent_id": a.agent_id,
            "agent_name": agent.name if agent else "", "kind": a.kind, "summary": a.summary, "details": a.details,
            "status": a.status, "requested_at": a.requested_at, "expires_at": a.expires_at,
            "decided_by": decider.name if decider else None, "decided_at": a.decided_at,
            "decision_note": a.decision_note, "requested_by": task.requested_by if task else None}


@router.get("")
def list_approvals(status: str = "pending", page: int = Query(1, ge=1), page_size: int = Query(50, le=200),
                   p: Principal = Depends(require("approvals:read")), db: Session = Depends(get_db)):
    stmt = select(ApprovalRequest).where(ApprovalRequest.org_id == p.org_id)
    if status:
        stmt = stmt.where(ApprovalRequest.status == status)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.order_by(ApprovalRequest.requested_at.desc()).offset((page - 1) * page_size)
                      .limit(page_size)).scalars()
    return {"items": [_out(db, a) for a in rows], "total": total}


@router.post("/{approval_id}/decide")
def decide(approval_id: str, body: DecisionIn, p: Principal = Depends(require("approvals:decide")),
           db: Session = Depends(get_db)):
    from sqlalchemy import update

    a = scoped(db, ApprovalRequest, approval_id, p, "approval")
    task = db.get(Task, a.task_id)
    if (p.org.settings or {}).get("require_distinct_approver") and task and task.requested_by == p.user_id:
        raise HTTPException(403, "organization policy requires a different person to approve your own task")
    # Atomic transition: only one decision can win.
    res = db.execute(update(ApprovalRequest).where(ApprovalRequest.id == a.id, ApprovalRequest.status == "pending")
                     .values(status=body.decision, decided_by=p.user_id, decided_at=utcnow(), decision_note=body.note))
    if res.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "this request was already decided or has expired")
    audit.record(db, p.org_id, f"approval.{body.decision}", actor_id=p.user_id, target_type="approval",
                 target_id=a.id, details={"task_id": a.task_id, "summary": a.summary, "note": body.note})
    resumed = False
    if a.kind == "tool_action" and task and task.status == "waiting_for_approval" and not task.inline:
        # Re-queue the parked conversation; a worker will apply the decision and continue.
        task.status = "queued"
        task.usage = {**(task.usage or {}), "resume_approval_id": a.id}
        resumed = True
    bus.emit(a.org_id, a.task_id, a.agent_id, "approval", f"{body.decision.capitalize()} by {p.user.name}",
             {"approval_id": a.id, "decision": body.decision}, db=db)
    db.commit()
    if resumed:
        get_orchestrator().wake()
    db.refresh(a)
    return _out(db, a)


@router.get("/parked")
def parked(p: Principal = Depends(require("approvals:read"))):
    return {"parked_task_ids": [tid for tid, pk in executor.PARKED.items() if pk.prepared.org_id == p.org_id]}

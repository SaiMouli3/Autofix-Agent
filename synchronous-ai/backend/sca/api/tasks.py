"""Tasks, live events (SSE), execution sessions and artifacts."""

from __future__ import annotations

import asyncio
import json
import mimetypes
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from sca import events as bus
from sca.api.deps import Principal, require, scoped
from sca.db import SessionLocal, get_db
from sca.models import (
    TASK_ACTIVE_STATES,
    Agent,
    ApprovalRequest,
    Artifact,
    Delegation,
    ExecutionSession,
    Task,
    TaskEvent,
    User,
    utcnow,
)
from sca.orchestrator import executor
from sca.orchestrator.dispatcher import get_orchestrator
from sca.services import attachments, audit
from sca.services.tasks import SubmissionError, submit_task

router = APIRouter(prefix="/api", tags=["tasks"])


class TaskIn(BaseModel):
    instructions: str = Field(min_length=1, max_length=50_000)
    title: str | None = Field(default=None, max_length=200)
    priority: int = Field(default=5, ge=1, le=10)
    session_id: str | None = None
    attachment_ids: list[str] = Field(default_factory=list, max_length=10)


PROVIDER_ERRORS = {"auth_failed", "rate_limited", "provider_unavailable", "network_error", "timeout_provider",
                   "missing_credential", "provider_missing", "unknown_model", "no_tool_calling", "malformed_response"}
INFRA_ERRORS = {"worker_lost", "sandbox_lost", "RuntimeError", "OperationalError"}


def error_category(error: dict[str, Any] | None, status: str) -> str | None:
    """Classify a failure for operators: provider, tool, timeout, permission, cancelled, limit,
    infrastructure or runtime. Derived from the stored error code only."""
    if status == "cancelled":
        return "cancelled"
    if not error or status not in ("failed", "timed_out", "queued"):
        return None
    code = str(error.get("code", ""))
    low = (code + " " + str(error.get("message", ""))).lower()
    if status == "timed_out" or code == "timeout":
        return "timeout"
    if code in ("budget_exceeded", "tool_limit_exceeded", "MaxIterationsReached"):
        return "limit"
    if code in PROVIDER_ERRORS or code.startswith("LLM") or "litellm" in low or "apierror" in low or "ratelimit" in low:
        return "provider"
    if code in ("agent_unavailable",) or "permission" in low or "denied" in low:
        return "permission"
    if code in INFRA_ERRORS:
        return "infrastructure"
    if "tool" in low:
        return "tool"
    return "runtime"


def task_out(db: Session, t: Task, detail: bool = False) -> dict[str, Any]:
    agent = db.get(Agent, t.agent_id)
    requester = db.get(User, t.requested_by) if t.requested_by else None
    out = {
        "id": t.id, "agent_id": t.agent_id, "agent_name": agent.name if agent else "", "agent_version": t.agent_version,
        "title": t.title, "status": t.status, "priority": t.priority, "attempt": t.attempt, "max_retries": t.max_retries,
        "created_at": t.created_at, "started_at": t.started_at, "finished_at": t.finished_at,
        "duration_s": (t.finished_at - t.started_at).total_seconds() if t.finished_at and t.started_at else None,
        "error": t.error, "session_id": t.session_id, "parent_task_id": t.parent_task_id,
        "delegation_depth": t.delegation_depth, "schedule_id": t.schedule_id, "trace_id": t.trace_id,
        "usage": t.usage or {}, "requested_by": t.requested_by, "requested_by_agent_id": t.requested_by_agent_id,
        "cancel_requested": t.cancel_requested, "scheduled_for": t.scheduled_for,
        "requested_by_name": requester.name if requester else None,
        "error_category": error_category(t.error, t.status),
        "attachments": [attachments.public(a) for a in attachments.for_task(db, t.id)],
    }
    if detail:
        out["instructions"] = t.instructions
        out["result_summary"] = t.result_summary
        out["children"] = [
            {"delegation_id": d.id, "child_task_id": d.child_task_id, "to_agent_id": d.to_agent_id,
             "objective": d.objective, "status": d.status, "depth": d.depth}
            for d in db.execute(select(Delegation).where(Delegation.parent_task_id == t.id)).scalars()
        ]
        out["approvals"] = [
            {"id": a.id, "kind": a.kind, "summary": a.summary, "status": a.status, "requested_at": a.requested_at,
             "decided_at": a.decided_at, "decision_note": a.decision_note}
            for a in db.execute(select(ApprovalRequest).where(ApprovalRequest.task_id == t.id)
                                .order_by(ApprovalRequest.requested_at)).scalars()
        ]
    return out


@router.post("/agents/{agent_id}/tasks", status_code=201)
def create_task(agent_id: str, body: TaskIn, p: Principal = Depends(require("tasks:create")),
                idempotency_key: str | None = Header(default=None, max_length=200),
                db: Session = Depends(get_db)):
    agent = scoped(db, Agent, agent_id, p, "agent")
    try:
        task, created = submit_task(db, agent=agent, instructions=body.instructions, title=body.title,
                                    requested_by=p.user_id, priority=body.priority,
                                    idempotency_key=f"user:{idempotency_key}" if idempotency_key else None,
                                    session_id=body.session_id)
        if created and body.attachment_ids:
            attachments.link(db, p.org_id, p.user_id, body.attachment_ids, task)
    except (SubmissionError, attachments.AttachmentError) as exc:
        raise HTTPException(422, str(exc)) from exc
    db.commit()
    get_orchestrator().wake()
    out = task_out(db, task, detail=True)
    out["created"] = created
    return out


TASK_SORTS = {
    "created": Task.created_at, "started": Task.started_at, "finished": Task.finished_at,
    "priority": Task.priority, "status": Task.status, "title": Task.title,
}


@router.get("/tasks")
def list_tasks(agent_id: str = "", status: str = "", q: str = "", session_id: str = "", top_level: bool = False,
               created_after: datetime | None = None, created_before: datetime | None = None,
               requested_by: str = "", sort: str = "created", order: str = "desc",
               page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
               p: Principal = Depends(require("tasks:read")), db: Session = Depends(get_db)):
    stmt = select(Task).where(Task.org_id == p.org_id)
    if agent_id:
        stmt = stmt.where(Task.agent_id == agent_id)
    if status == "active":
        stmt = stmt.where(Task.status.in_(TASK_ACTIVE_STATES))
    elif status:
        stmt = stmt.where(Task.status.in_([s.strip() for s in status.split(",") if s.strip()]))
    if session_id:
        stmt = stmt.where(Task.session_id == session_id)
    if q:
        stmt = stmt.where(Task.title.ilike(f"%{q}%") | Task.instructions.ilike(f"%{q}%"))
    if top_level:
        stmt = stmt.where(Task.parent_task_id.is_(None))
    if created_after:
        stmt = stmt.where(Task.created_at >= created_after)
    if created_before:
        stmt = stmt.where(Task.created_at <= created_before)
    if requested_by:
        stmt = stmt.where(Task.requested_by == (p.user_id if requested_by == "me" else requested_by))
    if sort not in TASK_SORTS:
        raise HTTPException(422, f"sort must be one of {sorted(TASK_SORTS)}")
    col = TASK_SORTS[sort]
    ordering = col.asc() if order == "asc" else col.desc()
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.order_by(ordering, Task.created_at.desc())
                      .offset((page - 1) * page_size).limit(page_size)).scalars()
    return {"items": [task_out(db, t) for t in rows], "total": total, "page": page, "page_size": page_size}


@router.get("/tasks/{task_id}")
def get_task(task_id: str, p: Principal = Depends(require("tasks:read")), db: Session = Depends(get_db)):
    return task_out(db, scoped(db, Task, task_id, p, "task"), detail=True)


def _event_out(e: TaskEvent) -> dict[str, Any]:
    return {"id": e.id, "task_id": e.task_id, "agent_id": e.agent_id, "ts": e.ts.isoformat(), "type": e.type,
            "summary": e.summary, "data": e.data}


@router.get("/tasks/{task_id}/events")
def task_events(task_id: str, after: int = 0, limit: int = Query(500, le=2000),
                p: Principal = Depends(require("tasks:read")), db: Session = Depends(get_db)):
    scoped(db, Task, task_id, p, "task")
    rows = db.execute(select(TaskEvent).where(TaskEvent.task_id == task_id, TaskEvent.id > after)
                      .order_by(TaskEvent.id).limit(limit)).scalars()
    return [_event_out(e) for e in rows]


@router.get("/agents/{agent_id}/events")
def agent_events(agent_id: str, after: int = 0, limit: int = Query(200, le=1000),
                 p: Principal = Depends(require("tasks:read")), db: Session = Depends(get_db)):
    scoped(db, Agent, agent_id, p, "agent")
    stmt = select(TaskEvent).where(TaskEvent.agent_id == agent_id, TaskEvent.org_id == p.org_id)
    if after:
        rows = db.execute(stmt.where(TaskEvent.id > after).order_by(TaskEvent.id).limit(limit)).scalars().all()
    else:
        rows = list(reversed(db.execute(stmt.order_by(TaskEvent.id.desc()).limit(limit)).scalars().all()))
    return [_event_out(e) for e in rows]


@router.get("/stream")
async def stream(request: Request, task_id: str = "", agent_id: str = "", after: int = 0,
                 p: Principal = Depends(require("tasks:read"))):
    """Server-sent events of task activity for the organization (optionally filtered)."""
    org_id = p.org_id
    if task_id or agent_id:
        db = SessionLocal()
        try:
            if task_id:
                scoped(db, Task, task_id, p, "task")
            if agent_id:
                scoped(db, Agent, agent_id, p, "agent")
        finally:
            db.close()

    async def gen():
        last_id = after
        if not last_id:
            db = SessionLocal()
            try:
                last_id = db.execute(select(func.coalesce(func.max(TaskEvent.id), 0))
                                     .where(TaskEvent.org_id == org_id)).scalar_one() if not task_id else 0
            finally:
                db.close()
        version = bus.current_version()
        yield "retry: 3000\n\n"
        idle = 0.0
        while True:
            if await request.is_disconnected():
                break
            db = SessionLocal()
            try:
                stmt = select(TaskEvent).where(TaskEvent.org_id == org_id, TaskEvent.id > last_id)
                if task_id:
                    stmt = stmt.where(TaskEvent.task_id == task_id)
                if agent_id:
                    stmt = stmt.where(TaskEvent.agent_id == agent_id)
                rows = db.execute(stmt.order_by(TaskEvent.id).limit(200)).scalars().all()
            finally:
                db.close()
            for e in rows:
                last_id = e.id
                yield f"id: {e.id}\nevent: activity\ndata: {json.dumps(_event_out(e), default=str)}\n\n"
            if rows:
                idle = 0.0
                continue
            # Wait for an in-process notification, or poll (multi-process deployments).
            version = await asyncio.to_thread(bus.wait_for_change, version, 2.0)
            idle += 2.0
            if idle >= 20:
                idle = 0.0
                yield ": keep-alive\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: str, p: Principal = Depends(require("tasks:cancel")), db: Session = Depends(get_db)):
    task = scoped(db, Task, task_id, p, "task")
    if task.status not in TASK_ACTIVE_STATES:
        raise HTTPException(409, f"task is already {task.status}")
    task.cancel_requested = True
    audit.record(db, p.org_id, "task.cancel_requested", actor_id=p.user_id, target_type="task", target_id=task.id)
    if task.status == "queued":
        task.status = "cancelled"
        task.finished_at = utcnow()
        task.error = {"code": "cancelled", "message": "Cancelled before start"}
        bus.emit(task.org_id, task.id, task.agent_id, "status", "Task cancelled", {"status": "cancelled"}, db=db)
        db.commit()
    elif task.status == "waiting_for_approval" and task.id in executor.PARKED:
        for a in db.execute(select(ApprovalRequest).where(ApprovalRequest.task_id == task.id,
                                                          ApprovalRequest.status == "pending")).scalars():
            a.status, a.decided_at, a.decided_by, a.decision_note = "cancelled", utcnow(), p.user_id, "task cancelled"
        db.commit()
        executor.finalize_parked_cancel(task.id)
    else:
        db.commit()
        executor.request_stop(task.id, "cancelled")
    return task_out(db, db.get(Task, task_id))


@router.post("/tasks/{task_id}/retry", status_code=201)
def retry_task(task_id: str, p: Principal = Depends(require("tasks:create")), db: Session = Depends(get_db)):
    old = scoped(db, Task, task_id, p, "task")
    if old.status not in ("failed", "timed_out", "cancelled"):
        raise HTTPException(409, "only failed, timed-out or cancelled tasks can be retried")
    agent = db.get(Agent, old.agent_id)
    try:
        task, _ = submit_task(db, agent=agent, instructions=old.instructions, title=old.title,
                              requested_by=p.user_id, priority=old.priority)
    except SubmissionError as exc:
        raise HTTPException(422, str(exc)) from exc
    audit.record(db, p.org_id, "task.retried", actor_id=p.user_id, target_type="task", target_id=task.id,
                 details={"retry_of": old.id})
    db.commit()
    get_orchestrator().wake()
    return task_out(db, task, detail=True)


# --------------------------------------------------------------------------- sessions & artifacts


def _session_out(db: Session, s: ExecutionSession) -> dict[str, Any]:
    agent = db.get(Agent, s.agent_id)
    n = db.execute(select(func.count()).select_from(Task).where(Task.session_id == s.id)).scalar_one()
    active = db.execute(select(Task.id).where(Task.session_id == s.id, Task.status.in_(TASK_ACTIVE_STATES))).first()
    return {"id": s.id, "agent_id": s.agent_id, "agent_name": agent.name if agent else "", "title": s.title,
            "runtime": s.runtime, "status": s.status, "created_at": s.created_at, "last_active_at": s.last_active_at,
            "task_count": n, "active": bool(active),
            "continuable": s.status == "active" and s.runtime == "local"}


@router.get("/sessions")
def list_sessions(agent_id: str = "", page: int = Query(1, ge=1), page_size: int = Query(50, le=200),
                  p: Principal = Depends(require("tasks:read")), db: Session = Depends(get_db)):
    stmt = select(ExecutionSession).where(ExecutionSession.org_id == p.org_id)
    if agent_id:
        stmt = stmt.where(ExecutionSession.agent_id == agent_id)
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.order_by(ExecutionSession.last_active_at.desc())
                      .offset((page - 1) * page_size).limit(page_size)).scalars()
    return {"items": [_session_out(db, s) for s in rows], "total": total}


def _safe_path(root: Path, rel: str) -> Path:
    target = (root / rel).resolve()
    if not str(target).startswith(str(root.resolve()) + "/") or target.is_symlink():
        raise HTTPException(403, "path outside of workspace")
    return target


@router.get("/sessions/{session_id}/files")
def session_files(session_id: str, p: Principal = Depends(require("artifacts:read")), db: Session = Depends(get_db)):
    s = scoped(db, ExecutionSession, session_id, p, "session")
    root = Path(s.workspace_path) / "project"
    files = []
    if root.exists():
        for fp in sorted(root.rglob("*")):
            if len(files) >= 1000:
                break
            if any(part in (".git", "node_modules", "__pycache__", ".venv") for part in fp.relative_to(root).parts):
                continue
            if fp.is_file() and not fp.is_symlink():
                st = fp.stat()
                files.append({"path": str(fp.relative_to(root)), "size": st.st_size, "modified": st.st_mtime})
    return {"session": _session_out(db, s), "files": files}


@router.get("/sessions/{session_id}/file")
def session_file(session_id: str, path: str, download: bool = False,
                 p: Principal = Depends(require("artifacts:read")), db: Session = Depends(get_db)):
    s = scoped(db, ExecutionSession, session_id, p, "session")
    root = (Path(s.workspace_path) / "project").resolve()
    target = _safe_path(root, path)
    if not target.is_file():
        raise HTTPException(404, "file not found")
    audit.record(db, p.org_id, "artifact.accessed", actor_id=p.user_id, target_type="session", target_id=s.id,
                 details={"path": path})
    db.commit()
    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    inline_ok = mime.startswith("text/") or mime in ("application/json",) or target.suffix in (".md", ".py", ".csv", ".log", ".yaml", ".yml", ".ts", ".js")
    if not download and inline_ok and target.stat().st_size <= 2_000_000:
        return {"path": path, "mime": mime, "content": target.read_text(errors="replace")}
    return FileResponse(target, media_type="application/octet-stream", filename=target.name,
                        headers={"Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff"})


@router.get("/tasks/{task_id}/artifacts")
def task_artifacts(task_id: str, p: Principal = Depends(require("artifacts:read")), db: Session = Depends(get_db)):
    scoped(db, Task, task_id, p, "task")
    rows = db.execute(select(Artifact).where(Artifact.task_id == task_id).order_by(Artifact.path)).scalars()
    return [{"id": a.id, "path": a.path, "size": a.size, "sha256": a.sha256, "mime": a.mime, "session_id": a.session_id,
             "created_at": a.created_at} for a in rows]


@router.get("/artifacts")
def list_artifacts(agent_id: str = "", limit: int = Query(50, le=500),
                   p: Principal = Depends(require("artifacts:read")), db: Session = Depends(get_db)):
    stmt = select(Artifact).where(Artifact.org_id == p.org_id)
    if agent_id:
        stmt = stmt.where(Artifact.agent_id == agent_id)
    rows = db.execute(stmt.order_by(Artifact.created_at.desc()).limit(limit)).scalars()
    out = []
    for a in rows:
        agent = db.get(Agent, a.agent_id)
        out.append({"id": a.id, "task_id": a.task_id, "agent_id": a.agent_id, "agent_name": agent.name if agent else "",
                    "path": a.path, "size": a.size, "mime": a.mime, "session_id": a.session_id, "created_at": a.created_at})
    return out

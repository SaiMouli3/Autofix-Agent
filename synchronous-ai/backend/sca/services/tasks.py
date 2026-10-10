"""Task submission shared by the API, scheduler, webhooks and delegation."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from sca import events as bus
from sca.agent_config import AgentConfig
from sca.models import Agent, AgentVersion, ExecutionSession, Task
from sca.services import audit


class SubmissionError(ValueError):
    pass


def submit_task(
    db: Session,
    *,
    agent: Agent,
    instructions: str,
    title: str | None = None,
    requested_by: str | None = None,
    priority: int = 5,
    idempotency_key: str | None = None,
    session_id: str | None = None,
    schedule_id: str | None = None,
    parent: Task | None = None,
    requested_by_agent_id: str | None = None,
    inline: bool = False,
    timeout_s: int | None = None,
) -> tuple[Task, bool]:
    """Create a queued task. Returns (task, created). Idempotent on ``idempotency_key``."""
    if agent.status != "active":
        raise SubmissionError("agent is not active (drafts and disabled agents cannot run tasks)")
    instructions = (instructions or "").strip()
    if not instructions:
        raise SubmissionError("task instructions are required")
    if len(instructions) > 50_000:
        raise SubmissionError("task instructions are too long (max 50k characters)")
    if idempotency_key:
        existing = db.execute(select(Task).where(Task.org_id == agent.org_id,
                                                 Task.idempotency_key == idempotency_key)).scalar_one_or_none()
        if existing is not None:
            return existing, False
    if session_id:
        sess = db.get(ExecutionSession, session_id)
        if sess is None or sess.agent_id != agent.id or sess.org_id != agent.org_id:
            raise SubmissionError("session does not belong to this agent")
        busy = db.execute(select(Task.id).where(Task.session_id == session_id,
                                                Task.status.in_(("queued", "running", "waiting_for_approval")))).first()
        if busy:
            raise SubmissionError("this session already has an active task; wait for it to finish")
    ver = db.execute(select(AgentVersion).where(AgentVersion.agent_id == agent.id,
                                                AgentVersion.version == agent.current_version)).scalar_one()
    cfg = AgentConfig.model_validate(ver.config)
    task = Task(
        org_id=agent.org_id, agent_id=agent.id, agent_version=agent.current_version, session_id=session_id,
        requested_by=requested_by, requested_by_agent_id=requested_by_agent_id,
        title=(title or instructions.splitlines()[0])[:200], instructions=instructions,
        priority=max(1, min(10, priority)), idempotency_key=idempotency_key, schedule_id=schedule_id,
        parent_task_id=parent.id if parent else None,
        root_task_id=(parent.root_task_id or parent.id) if parent else None,
        delegation_depth=(parent.delegation_depth + 1) if parent else 0,
        max_retries=0 if inline else cfg.policy.max_retries,
        timeout_s=timeout_s or cfg.policy.task_timeout_s, inline=inline,
    )
    db.add(task)
    try:
        db.flush()
    except IntegrityError as exc:  # concurrent request with the same idempotency key
        db.rollback()
        existing = db.execute(select(Task).where(Task.org_id == agent.org_id,
                                                 Task.idempotency_key == idempotency_key)).scalar_one_or_none()
        if existing is not None:
            return existing, False
        raise SubmissionError("could not create task") from exc
    audit.record(db, agent.org_id, "task.submitted", actor_type="agent" if requested_by_agent_id else "user",
                 actor_id=requested_by_agent_id or requested_by or "", target_type="task", target_id=task.id,
                 details={"agent_id": agent.id, "title": task.title, "schedule_id": schedule_id,
                          "parent_task_id": task.parent_task_id})
    bus.emit(task.org_id, task.id, agent.id, "status", "Task queued", {"status": "queued"}, db=db)
    return task, True

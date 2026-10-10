"""Persistent schedules: one-time, cron and authenticated webhook triggers."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from croniter import croniter
from sqlalchemy import select

from sca.db import session_scope
from sca.models import Agent, Schedule, utcnow
from sca.services import audit
from sca.services.tasks import SubmissionError, submit_task

log = logging.getLogger("sca.scheduler")


def next_cron_run(expr: str, tz: str, after: datetime) -> datetime:
    if not croniter.is_valid(expr):
        raise ValueError("invalid cron expression")
    zone = ZoneInfo(tz)
    base = after.astimezone(zone)
    nxt = croniter(expr, base).get_next(datetime)
    return nxt.astimezone(UTC)


def compute_next(sched: Schedule, after: datetime | None = None) -> datetime | None:
    after = after or utcnow()
    if not sched.enabled:
        return None
    if sched.kind == "once":
        return sched.run_at if sched.run_at and (sched.last_run_at is None) else None
    if sched.kind == "cron":
        return next_cron_run(sched.cron, sched.timezone or "UTC", after)
    return None  # webhook schedules have no calculable next run


def run_due_schedules() -> int:
    fired = 0
    now = utcnow()
    with session_scope() as db:
        due = db.execute(select(Schedule).where(Schedule.enabled.is_(True), Schedule.next_run_at.is_not(None),
                                                Schedule.next_run_at <= now)).scalars().all()
        for sched in due:
            planned = sched.next_run_at
            agent = db.get(Agent, sched.agent_id)
            missed = now - planned > timedelta(minutes=5)
            if missed and sched.missed_policy == "skip":
                audit.record(db, sched.org_id, "schedule.missed_skipped", actor_type="system",
                             target_type="schedule", target_id=sched.id, details={"planned": planned.isoformat()})
            elif agent is not None:
                try:
                    _, created = submit_task(
                        db, agent=agent, instructions=sched.instructions, title=f"[Scheduled] {sched.name}",
                        requested_by=sched.created_by, schedule_id=sched.id,
                        idempotency_key=f"schedule:{sched.id}:{planned.isoformat()}",
                    )
                    fired += int(created)
                except SubmissionError as exc:
                    audit.record(db, sched.org_id, "schedule.fire_failed", actor_type="system",
                                 target_type="schedule", target_id=sched.id, details={"error": str(exc)})
            sched.last_run_at = now
            if sched.kind == "once":
                sched.enabled = False
                sched.next_run_at = None
            else:
                try:
                    sched.next_run_at = compute_next(sched, now)  # coalesces missed runs into one
                except Exception:  # noqa: BLE001
                    sched.enabled, sched.next_run_at = False, None
    return fired

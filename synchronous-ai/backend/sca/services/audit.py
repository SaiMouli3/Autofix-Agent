"""Hash-chained audit log."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from sca.models import AuditEvent, utcnow
from sca.security.redaction import redact


def _digest(prev: str, ev: AuditEvent) -> str:
    payload = json.dumps(
        [prev, ev.org_id, ev.ts.isoformat(), ev.actor_type, ev.actor_id, ev.action,
         ev.target_type, ev.target_id, ev.details],
        sort_keys=True, default=str,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def record(
    db: Session,
    org_id: str,
    action: str,
    *,
    actor_type: str = "user",
    actor_id: str = "",
    target_type: str = "",
    target_id: str = "",
    details: dict[str, Any] | None = None,
    ip: str = "",
) -> AuditEvent:
    """Append an audit event. Caller commits.

    Appends are serialized by the database, never by an in-process lock: a Python lock
    taken while another session already holds the database write lock (and waits for the
    Python lock) deadlocks until the SQLite busy timeout. On PostgreSQL a transaction-scoped
    advisory lock per organization orders appends across processes; on SQLite inserting the
    row first takes the database-wide write lock, which is held until commit.
    """
    if db.get_bind().dialect.name == "postgresql":
        key = int.from_bytes(hashlib.sha256(org_id.encode()).digest()[:8], "big", signed=True)
        db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": key})
    ev = AuditEvent(
        org_id=org_id, ts=utcnow().replace(microsecond=0), actor_type=actor_type, actor_id=actor_id or "",
        action=action, target_type=target_type, target_id=target_id or "",
        details=redact(details or {}), ip=ip,
    )
    db.add(ev)
    db.flush()
    prev = db.execute(
        select(AuditEvent.hash).where(AuditEvent.org_id == org_id, AuditEvent.id < ev.id)
        .order_by(AuditEvent.id.desc()).limit(1)
    ).scalar_one_or_none() or ""
    ev.prev_hash = prev
    ev.hash = _digest(prev, ev)
    db.flush()
    return ev


def verify_chain(db: Session, org_id: str) -> dict[str, Any]:
    prev: str | None = None  # anchored at the oldest retained event (retention prunes the head)
    count = 0
    for ev in db.execute(select(AuditEvent).where(AuditEvent.org_id == org_id).order_by(AuditEvent.id)).scalars():
        if prev is None:
            prev = ev.prev_hash
        if ev.prev_hash != prev or _digest(prev, ev) != ev.hash:
            return {"valid": False, "broken_at": ev.id, "checked": count}
        prev = ev.hash
        count += 1
    return {"valid": True, "checked": count}

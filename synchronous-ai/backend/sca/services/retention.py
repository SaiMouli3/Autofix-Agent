"""Data retention: prune old task events and audit events per configured windows."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import delete

from sca.config import get_settings
from sca.db import session_scope
from sca.models import AuditEvent, OAuthState, PlatformToken, TaskEvent, utcnow


def apply_retention() -> dict[str, int]:
    s = get_settings()
    now = utcnow()
    with session_scope() as db:
        ev = db.execute(delete(TaskEvent).where(TaskEvent.ts < now - timedelta(days=s.event_retention_days))).rowcount
        au = db.execute(delete(AuditEvent).where(AuditEvent.ts < now - timedelta(days=s.audit_retention_days))).rowcount
        tok = db.execute(delete(PlatformToken).where(PlatformToken.expires_at < now - timedelta(days=1))).rowcount
        st = db.execute(delete(OAuthState).where(OAuthState.expires_at < now - timedelta(days=1))).rowcount
    return {"task_events": ev or 0, "audit_events": au or 0, "platform_tokens": tok or 0, "oauth_states": st or 0}

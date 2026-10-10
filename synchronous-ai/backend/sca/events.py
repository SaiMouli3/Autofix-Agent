"""Task event persistence + in-process change notification (for SSE)."""

from __future__ import annotations

import threading
from typing import Any

from sca.db import session_scope
from sca.models import TaskEvent
from sca.security.redaction import redact, redact_text

_cond = threading.Condition()
_version = 0


def notify() -> None:
    global _version
    with _cond:
        _version += 1
        _cond.notify_all()


def wait_for_change(last_version: int, timeout: float) -> int:
    with _cond:
        if _version == last_version:
            _cond.wait(timeout)
        return _version


def current_version() -> int:
    return _version


def emit(org_id: str, task_id: str, agent_id: str, type_: str, summary: str, data: dict[str, Any] | None = None,
         db=None) -> None:
    ev = TaskEvent(org_id=org_id, task_id=task_id, agent_id=agent_id, type=type_,
                   summary=redact_text(summary)[:4000], data=redact(data or {}))
    if db is not None:
        db.add(ev)
        db.flush()
    else:
        with session_scope() as s:
            s.add(ev)
    notify()

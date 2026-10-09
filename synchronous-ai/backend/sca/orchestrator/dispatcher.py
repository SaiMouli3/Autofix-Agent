"""Durable, bounded, concurrent task orchestration.

* Tasks are persisted rows; the dispatcher claims queued tasks with an atomic
  ``UPDATE ... WHERE status='queued'`` so a task is executed at most once even with
  several API processes sharing the database.
* A ``ThreadPoolExecutor`` bounds global concurrency (``SCA_MAX_WORKERS``); each
  agent's ``policy.max_concurrent_tasks`` bounds per-agent concurrency.
* Running tasks hold a lease renewed by the watchdog. Leases of crashed workers
  expire and their tasks are re-queued (if retries remain) or failed.
* The watchdog also delivers cancellation and timeouts, expires stale approvals,
  and the scheduler loop turns due schedules into tasks.
"""

from __future__ import annotations

import logging
import os
import socket
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import timedelta

from sqlalchemy import func, select, update

from sca import events as bus
from sca.config import get_settings
from sca.db import session_scope
from sca.models import AgentVersion, ApprovalRequest, Task, utcnow
from sca.orchestrator import executor
from sca.services import audit

log = logging.getLogger("sca.dispatcher")


class Orchestrator:
    def __init__(self) -> None:
        s = get_settings()
        self.worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"
        self.max_workers = s.max_workers
        self.pool = ThreadPoolExecutor(max_workers=s.max_workers, thread_name_prefix="agent-worker")
        self.running: dict[str, Future] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._threads: list[threading.Thread] = []
        self.started_at = time.time()
        self.last_dispatch_at = 0.0
        self.last_watchdog_at = 0.0

    # ------------------------------------------------------------------ lifecycle

    def start(self) -> None:
        executor.preload_runtime()
        self.recover(startup=True)
        for target, name in ((self._dispatch_loop, "dispatcher"), (self._watchdog_loop, "watchdog"),
                             (self._scheduler_loop, "scheduler"), (self._retention_loop, "retention")):
            t = threading.Thread(target=target, name=name, daemon=True)
            t.start()
            self._threads.append(t)
        log.info("orchestrator %s started with %d workers", self.worker_id, self.max_workers)

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        for tid in executor.live_task_ids():
            executor.request_stop(tid, "worker_shutdown")
        executor.service_stop_requests()
        self.pool.shutdown(wait=False, cancel_futures=True)

    def wake(self) -> None:
        self._wake.set()

    def health(self) -> dict:
        now = time.time()
        return {
            "worker_id": self.worker_id,
            "max_workers": self.max_workers,
            "active_workers": len(self.running),
            "dispatcher_alive": now - self.last_dispatch_at < 10,
            "watchdog_alive": now - self.last_watchdog_at < 15,
            "parked_for_approval": len(executor.PARKED),
        }

    # ------------------------------------------------------------------ dispatch

    def _dispatch_loop(self) -> None:
        interval = get_settings().dispatch_interval_s
        while not self._stop.is_set():
            self.last_dispatch_at = time.time()
            try:
                self.dispatch_once()
            except Exception:  # noqa: BLE001
                log.exception("dispatch failed")
            self._wake.wait(interval)
            self._wake.clear()

    def dispatch_once(self) -> int:
        with self._lock:
            done = [tid for tid, f in self.running.items() if f.done()]
            for tid in done:
                self.running.pop(tid, None)
            free = self.max_workers - len(self.running)
        if free <= 0:
            return 0
        s = get_settings()
        claimed: list[str] = []
        with session_scope() as db:
            candidates = db.execute(
                select(Task).where(Task.status == "queued", Task.scheduled_for <= utcnow(), Task.inline.is_(False))
                .order_by(Task.priority.desc(), Task.created_at).limit(100)
            ).scalars().all()
            if not candidates:
                return 0
            running_by_agent = dict(db.execute(
                select(Task.agent_id, func.count()).where(Task.status == "running").group_by(Task.agent_id)
            ).all())
            limits: dict[tuple[str, int], int] = {}
            for t in candidates:
                if free <= 0:
                    break
                key = (t.agent_id, t.agent_version)
                if key not in limits:
                    cfg = db.execute(select(AgentVersion.config).where(AgentVersion.agent_id == t.agent_id,
                                                                       AgentVersion.version == t.agent_version)).scalar_one_or_none() or {}
                    limits[key] = int(((cfg.get("policy") or {}).get("max_concurrent_tasks")) or 1)
                if running_by_agent.get(t.agent_id, 0) >= limits[key]:
                    continue
                now = utcnow()
                res = db.execute(
                    update(Task).where(Task.id == t.id, Task.status == "queued").values(
                        status="running", lease_owner=self.worker_id,
                        lease_expires_at=now + timedelta(seconds=s.lease_seconds),
                        started_at=t.started_at or now,
                    )
                )
                if res.rowcount != 1:
                    continue  # claimed by another worker
                db.commit()
                claimed.append(t.id)
                running_by_agent[t.agent_id] = running_by_agent.get(t.agent_id, 0) + 1
                free -= 1
        for tid in claimed:
            fut = self.pool.submit(self._run, tid)
            with self._lock:
                self.running[tid] = fut
        if claimed:
            bus.notify()
        return len(claimed)

    def _run(self, task_id: str) -> None:
        try:
            executor.execute_task(task_id, self.worker_id)
        except Exception:  # noqa: BLE001
            log.exception("executor raised for %s", task_id)
        finally:
            self._wake.set()

    # ------------------------------------------------------------------ watchdog

    def _scheduler_loop(self) -> None:
        from sca.services.scheduler import run_due_schedules

        while not self._stop.is_set():
            try:
                if run_due_schedules():
                    self._wake.set()
            except Exception:  # noqa: BLE001
                log.exception("scheduler iteration failed")
            self._stop.wait(10.0)

    def _retention_loop(self) -> None:
        from sca.services.retention import apply_retention

        while not self._stop.is_set():
            try:
                apply_retention()
            except Exception:  # noqa: BLE001
                log.exception("retention iteration failed")
            self._stop.wait(3600.0)

    def _watchdog_loop(self) -> None:
        last_lease = 0.0
        while not self._stop.is_set():
            self.last_watchdog_at = time.time()
            try:
                self._check_cancellations()
                executor.service_stop_requests()
                if time.time() - last_lease > 10:
                    self._renew_leases()
                    self.recover(startup=False)
                    self._expire_approvals()
                    last_lease = time.time()
            except Exception:  # noqa: BLE001
                log.exception("watchdog iteration failed")
            self._stop.wait(0.5)

    def _check_cancellations(self) -> None:
        live = executor.live_task_ids()
        if not live:
            return
        with session_scope() as db:
            ids = db.execute(select(Task.id).where(Task.id.in_(live), Task.cancel_requested.is_(True))).scalars().all()
        for tid in ids:
            executor.request_stop(tid, "cancelled")

    def _renew_leases(self) -> None:
        live = executor.live_task_ids()
        if not live:
            return
        s = get_settings()
        with session_scope() as db:
            db.execute(update(Task).where(Task.id.in_(live), Task.lease_owner == self.worker_id)
                       .values(lease_expires_at=utcnow() + timedelta(seconds=s.lease_seconds)))

    def recover(self, startup: bool) -> int:
        """Re-queue or fail tasks whose worker lease expired (crash / restart)."""
        host = socket.gethostname()
        recovered = 0
        with session_scope() as db:
            rows = db.execute(select(Task).where(Task.status == "running")).scalars().all()
            for t in rows:
                if t.id in executor.LIVE_RUNS:
                    continue
                dead = t.lease_expires_at is None or t.lease_expires_at < utcnow()
                if startup and t.lease_owner and t.lease_owner.startswith(f"{host}:") and not t.inline:
                    pid = int(t.lease_owner.split(":")[1])
                    if pid != os.getpid() and not _pid_alive(pid):
                        dead = True
                if t.inline and startup:
                    dead = True
                if not dead:
                    continue
                recovered += 1
                err = {"code": "worker_lost", "message": "The worker executing this task stopped (restart or crash).",
                       "retryable": True}
                if t.attempt < t.max_retries and not t.inline and not t.cancel_requested:
                    t.status, t.attempt, t.error = "queued", t.attempt + 1, err
                    t.scheduled_for = utcnow()
                    t.session_id = None
                else:
                    t.status, t.error, t.finished_at = ("cancelled" if t.cancel_requested else "failed"), err, utcnow()
                t.lease_owner = None
                t.lease_expires_at = None
                audit.record(db, t.org_id, "task.recovered", actor_type="system", target_type="task", target_id=t.id,
                             details={"new_status": t.status})
                bus.emit(t.org_id, t.id, t.agent_id, "status", f"Recovered after worker loss → {t.status}",
                         {"status": t.status, "error": err}, db=db)
        if recovered:
            log.warning("recovered %d task(s) with expired leases", recovered)
            self._wake.set()
        return recovered

    def _expire_approvals(self) -> None:
        with session_scope() as db:
            stale = db.execute(select(ApprovalRequest).where(ApprovalRequest.status == "pending",
                                                             ApprovalRequest.expires_at < utcnow())).scalars().all()
            for a in stale:
                a.status = "expired"
                a.decided_at = utcnow()
                task = db.get(Task, a.task_id)
                audit.record(db, a.org_id, "approval.expired", actor_type="system", target_type="approval", target_id=a.id)
                if task and task.status == "waiting_for_approval" and a.kind == "tool_action" and not task.inline:
                    task.status = "queued"
                    task.usage = {**(task.usage or {}), "resume_approval_id": a.id}
        self._wake.set()


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


_orchestrator: Orchestrator | None = None


def get_orchestrator() -> Orchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = Orchestrator()
    return _orchestrator


def reset_orchestrator() -> None:
    global _orchestrator
    if _orchestrator is not None:
        _orchestrator.stop()
    _orchestrator = None

"""Overview dashboard, usage and monitoring — all figures come from stored records."""

from __future__ import annotations

import time
from datetime import timedelta

import psutil
from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from sca.api.deps import Principal, require
from sca.config import get_settings
from sca.db import get_db
from sca.models import (
    Agent,
    ApprovalRequest,
    Artifact,
    Integration,
    ModelProvider,
    Task,
    TaskEvent,
    UsageRecord,
    utcnow,
)
from sca.orchestrator.dispatcher import get_orchestrator
from sca.runtime.sandbox import docker_available

router = APIRouter(tags=["dashboard"])

_started = time.time()


@router.get("/api/overview")
def overview(p: Principal = Depends(require("agents:read")), db: Session = Depends(get_db)):
    org = p.org_id
    status_counts = dict(db.execute(select(Task.status, func.count()).where(Task.org_id == org).group_by(Task.status)).all())
    agents = db.execute(select(func.count()).select_from(Agent).where(Agent.org_id == org)).scalar_one()
    active_agents = db.execute(select(func.count()).select_from(Agent).where(Agent.org_id == org, Agent.status == "active")).scalar_one()
    pending = db.execute(select(func.count()).select_from(ApprovalRequest)
                         .where(ApprovalRequest.org_id == org, ApprovalRequest.status == "pending")).scalar_one()
    since = utcnow() - timedelta(days=30)
    usage = db.execute(select(func.coalesce(func.sum(UsageRecord.prompt_tokens), 0),
                              func.coalesce(func.sum(UsageRecord.completion_tokens), 0),
                              func.sum(UsageRecord.cost_usd), func.count(UsageRecord.id),
                              func.coalesce(func.sum(UsageRecord.llm_requests), 0))
                       .where(UsageRecord.org_id == org, UsageRecord.created_at >= since)).one()
    unknown_cost = db.execute(select(func.count()).select_from(UsageRecord).where(
        UsageRecord.org_id == org, UsageRecord.created_at >= since, UsageRecord.cost_usd.is_(None))).scalar_one()
    recent = db.execute(select(TaskEvent, Agent.name).join(Agent, Agent.id == TaskEvent.agent_id)
                        .where(TaskEvent.org_id == org).order_by(TaskEvent.id.desc()).limit(25)).all()
    artifacts = db.execute(select(Artifact, Agent.name).join(Agent, Agent.id == Artifact.agent_id)
                           .where(Artifact.org_id == org).order_by(Artifact.created_at.desc()).limit(10)).all()
    integ_errors = [
        {"id": i.id, "name": i.name, "detail": (i.health or {}).get("detail"), "checked_at": (i.health or {}).get("checked_at")}
        for i in db.execute(select(Integration).where(Integration.org_id == org)).scalars()
        if i.health and not i.health.get("ok")
    ]
    providers = [{"id": pr.id, "name": pr.name, "status": pr.status, "last_tested_at": pr.last_tested_at}
                 for pr in db.execute(select(ModelProvider).where(ModelProvider.org_id == org)).scalars()]
    return {
        "agents": {"total": agents, "active": active_agents},
        "tasks": {
            "running": status_counts.get("running", 0), "queued": status_counts.get("queued", 0),
            "waiting_for_approval": status_counts.get("waiting_for_approval", 0),
            "completed": status_counts.get("completed", 0),
            "failed": status_counts.get("failed", 0) + status_counts.get("timed_out", 0),
            "cancelled": status_counts.get("cancelled", 0),
        },
        "pending_approvals": pending,
        "usage_30d": {"prompt_tokens": usage[0], "completion_tokens": usage[1],
                      "estimated_cost_usd": round(usage[2], 4) if usage[2] is not None else None,
                      "records": usage[3], "llm_requests": usage[4], "records_without_pricing": unknown_cost,
                      "cost_note": "Estimated from provider-published per-token rates."},
        "recent_activity": [{"id": e.id, "task_id": e.task_id, "agent_id": e.agent_id, "agent_name": n,
                             "type": e.type, "summary": e.summary, "ts": e.ts} for e, n in recent],
        "recent_artifacts": [{"id": a.id, "task_id": a.task_id, "agent_name": n, "path": a.path, "size": a.size,
                              "session_id": a.session_id, "created_at": a.created_at} for a, n in artifacts],
        "integration_errors": integ_errors,
        "providers": providers,
        "system": _system_health(db),
    }


def _system_health(db: Session) -> dict:
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        db_ok = False
    s = get_settings()
    orch = get_orchestrator().health()
    return {"database": db_ok, "runtime": s.runtime,
            "docker_available": docker_available() if s.runtime == "docker" else None,
            "uptime_s": int(time.time() - _started), **orch}


@router.get("/api/monitoring")
def monitoring(days: int = Query(14, ge=1, le=90), p: Principal = Depends(require("usage:read")),
               db: Session = Depends(get_db)):
    org = p.org_id
    since = utcnow() - timedelta(days=days)
    by_agent = db.execute(
        select(Agent.name, func.sum(UsageRecord.prompt_tokens), func.sum(UsageRecord.completion_tokens),
               func.sum(UsageRecord.cost_usd), func.sum(UsageRecord.llm_requests), func.sum(UsageRecord.tool_calls),
               func.count(func.distinct(UsageRecord.task_id)))
        .join(Agent, Agent.id == UsageRecord.agent_id)
        .where(UsageRecord.org_id == org, UsageRecord.created_at >= since).group_by(Agent.name)).all()
    by_model = db.execute(
        select(UsageRecord.model, func.sum(UsageRecord.prompt_tokens), func.sum(UsageRecord.completion_tokens),
               func.sum(UsageRecord.cost_usd), func.sum(UsageRecord.llm_requests))
        .where(UsageRecord.org_id == org, UsageRecord.created_at >= since).group_by(UsageRecord.model)).all()
    daily: dict[str, dict] = {}
    for r in db.execute(select(UsageRecord).where(UsageRecord.org_id == org, UsageRecord.created_at >= since)).scalars():
        d = r.created_at.date().isoformat()
        e = daily.setdefault(d, {"date": d, "tokens": 0, "cost_usd": 0.0, "tasks": set()})
        e["tokens"] += r.prompt_tokens + r.completion_tokens
        e["cost_usd"] += r.cost_usd or 0.0
        e["tasks"].add(r.task_id)
    task_daily: dict[str, dict] = {}
    for t in db.execute(select(Task).where(Task.org_id == org, Task.created_at >= since)).scalars():
        d = t.created_at.date().isoformat()
        e = task_daily.setdefault(d, {"date": d, "completed": 0, "failed": 0, "other": 0})
        key = "completed" if t.status == "completed" else "failed" if t.status in ("failed", "timed_out") else "other"
        e[key] += 1
    durations = [((t.finished_at - t.started_at).total_seconds(), t.status) for t in db.execute(
        select(Task).where(Task.org_id == org, Task.finished_at.is_not(None), Task.started_at.is_not(None),
                           Task.created_at >= since)).scalars()]
    secs = sorted(d for d, _ in durations)

    def pct(q: float):
        return round(secs[min(len(secs) - 1, int(q * len(secs)))], 1) if secs else None

    from sca.api.tasks import error_category

    errors = db.execute(select(TaskEvent.summary, TaskEvent.ts, Agent.name, TaskEvent.task_id, TaskEvent.type)
                        .join(Agent, Agent.id == TaskEvent.agent_id)
                        .where(TaskEvent.org_id == org, TaskEvent.type.in_(("error", "tool_error")), TaskEvent.ts >= since)
                        .order_by(TaskEvent.id.desc()).limit(25)).all()
    error_codes: dict[str, int] = {}
    error_categories: dict[str, int] = {}
    for err, st in db.execute(select(Task.error, Task.status).where(Task.org_id == org, Task.error.is_not(None),
                                                                   Task.created_at >= since)).all():
        code = (err or {}).get("code", "unknown")
        error_codes[code] = error_codes.get(code, 0) + 1
        cat = error_category(err, st)
        if cat:
            error_categories[cat] = error_categories.get(cat, 0) + 1
    proc = psutil.Process()
    with proc.oneshot():
        mem = proc.memory_info().rss
        cpu = proc.cpu_percent(interval=None)
        threads = proc.num_threads()
    vm = psutil.virtual_memory()
    queue = dict(db.execute(select(Task.status, func.count()).where(
        Task.org_id == org, Task.status.in_(("queued", "running", "waiting_for_approval"))).group_by(Task.status)).all())
    oldest_queued = db.execute(select(func.min(Task.created_at)).where(Task.org_id == org, Task.status == "queued")).scalar_one()
    return {
        "window_days": days,
        "usage_by_agent": [{"agent": a, "prompt_tokens": pt or 0, "completion_tokens": ct or 0,
                            "estimated_cost_usd": round(c, 4) if c is not None else None, "llm_requests": rq or 0,
                            "tool_calls": tc or 0, "tasks": n} for a, pt, ct, c, rq, tc, n in by_agent],
        "usage_by_model": [{"model": m, "prompt_tokens": pt or 0, "completion_tokens": ct or 0,
                            "estimated_cost_usd": round(c, 4) if c is not None else None, "llm_requests": rq or 0}
                           for m, pt, ct, c, rq in by_model],
        "daily_usage": [{**{k: v for k, v in e.items() if k != "tasks"}, "tasks": len(e["tasks"]),
                         "cost_usd": round(e["cost_usd"], 4)} for e in sorted(daily.values(), key=lambda x: x["date"])],
        "daily_tasks": sorted(task_daily.values(), key=lambda x: x["date"]),
        "durations": {"count": len(secs), "p50_s": pct(0.5), "p90_s": pct(0.9), "max_s": secs[-1] if secs else None},
        "error_codes": error_codes,
        "error_categories": error_categories,
        "recent_errors": [{"summary": s, "ts": ts, "agent": n, "task_id": tid, "type": ty} for s, ts, n, tid, ty in errors],
        "queue": {**queue, "oldest_queued_at": oldest_queued},
        "workers": get_orchestrator().health(),
        "resources": {"process_rss_mb": round(mem / 1e6, 1), "process_cpu_percent": cpu, "threads": threads,
                      "host_memory_percent": vm.percent, "host_cpu_percent": psutil.cpu_percent(interval=None),
                      "cpu_count": psutil.cpu_count()},
        "cost_note": "Costs are estimates computed from provider-published per-token rates; "
                     "records for models without published pricing are counted as unknown.",
    }


# --------------------------------------------------------------------------- health


@router.get("/healthz")
def healthz():
    return {"status": "ok"}


@router.get("/readyz")
def readyz(db: Session = Depends(get_db)):
    from fastapi.responses import JSONResponse

    checks = {}
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = True
    except Exception:  # noqa: BLE001
        checks["database"] = False
    s = get_settings()
    if s.start_workers:
        h = get_orchestrator().health()
        checks["dispatcher"] = h["dispatcher_alive"]
        checks["watchdog"] = h["watchdog_alive"]
    if s.runtime == "docker":
        checks["docker"] = docker_available()
    ok = all(checks.values())
    return JSONResponse({"ready": ok, "checks": checks}, status_code=200 if ok else 503)


@router.get("/metrics", response_class=PlainTextResponse)
def metrics(db: Session = Depends(get_db)):
    """Prometheus exposition (aggregate counts only; no tenant identifiers)."""
    lines = ["# TYPE sca_tasks gauge"]
    for status, n in db.execute(select(Task.status, func.count()).group_by(Task.status)).all():
        lines.append(f'sca_tasks{{status="{status}"}} {n}')
    h = get_orchestrator().health()
    lines += ["# TYPE sca_workers_active gauge", f"sca_workers_active {h['active_workers']}",
              "# TYPE sca_workers_max gauge", f"sca_workers_max {h['max_workers']}",
              "# TYPE sca_parked_for_approval gauge", f"sca_parked_for_approval {h['parked_for_approval']}",
              "# TYPE sca_process_rss_bytes gauge", f"sca_process_rss_bytes {psutil.Process().memory_info().rss}"]
    return "\n".join(lines) + "\n"

"""Executes one task on the real OpenHands agent runtime.

Lifecycle of a task execution segment:

1. ``_prepare`` loads the pinned agent version, enforces budgets and tool policy,
   resolves (or creates) the execution session and builds the OpenHands ``LLM``,
   tool specs and MCP configuration. Credentials are decrypted in-process only.
2. A ``Conversation`` is created (``LocalConversation`` for the local runtime,
   ``RemoteConversation`` against a sandboxed agent-server container for docker),
   or a parked conversation is resumed after a human approval decision.
3. ``conversation.run()`` executes; every SDK event is translated, redacted and
   persisted as a ``TaskEvent``. The orchestrator's watchdog can interrupt the run
   for cancellation, timeouts and budget/tool-call limits.
4. The outcome (completed / failed / timed_out / cancelled / waiting_for_approval)
   is persisted with usage, artifacts and the final summary.
"""

from __future__ import annotations

import hashlib
import logging
import re
import mimetypes
import os
import secrets as pysecrets
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func, select

from sca import events as bus
from sca.agent_config import WEB_GUIDANCE, AgentConfig, compose_identity, compose_system_suffix
from sca.config import get_settings
from sca.db import session_scope
from sca.models import (
    Agent,
    AgentVersion,
    ApprovalRequest,
    Artifact,
    Delegation,
    ExecutionSession,
    Integration,
    ModelProvider,
    Organization,
    PlatformToken,
    Task,
    UsageRecord,
    utcnow,
)
from sca.runtime.sandbox import make_docker_workspace, session_dir
from sca.runtime.translate import translate
from sca.security.crypto import sha256_hex
from sca.security.redaction import redact_text
from sca.services import audit
from sca.services.providers import ProviderError, build_llm

log = logging.getLogger("sca.executor")

RETRYABLE_CODES = {
    "rate_limited", "provider_unavailable", "timeout", "network_error", "RateLimitError",
    "APIConnectionError", "ServiceUnavailableError", "InternalServerError", "Timeout", "APIError",
    "LLMServiceUnavailableError", "LLMRateLimitError", "LLMTimeoutError", "worker_lost",
}
PROVIDER_CODES = RETRYABLE_CODES | {"auth_failed", "AuthenticationError", "LLMAuthenticationError"}


class ExecutionFailure(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass
class LiveRun:
    task_id: str
    org_id: str
    agent_id: str
    deadline: float
    budget_usd: float | None
    max_tool_calls: int
    conversation: Any = None
    stop_reason: str | None = None
    tool_calls: int = 0
    stop_sent: bool = False
    waiting_since: float | None = None


@dataclass
class Parked:
    """A conversation waiting for a human approval decision (no worker slot held)."""

    conversation: Any
    prepared: Any
    approval_id: str
    baseline: dict[str, float]


@dataclass
class Prepared:
    task_id: str
    org_id: str
    agent_id: str
    agent_name: str
    org_name: str
    cfg: AgentConfig
    instructions: str
    title: str
    session_id: str
    conversation_id: str
    is_continuation: bool
    runtime: str
    project_dir: Path
    state_dir: Path
    llm: Any
    model: str
    provider_id: str
    pricing_known: bool
    platform_token: str | None
    platform_tools: list[str]
    mcp_integrations: dict[str, Any]
    timeout_s: int
    started_at: float
    requested_by: str | None
    inline: bool
    parent_task_id: str | None
    depth: int
    extra: dict[str, Any] = field(default_factory=dict)


def preload_runtime() -> None:
    """Import OpenHands runtime modules once, up front.

    Concurrent first-time imports of the tool packages from several worker threads
    can deadlock on Python's per-module import locks, so workers never import lazily.
    """
    import openhands.sdk  # noqa: F401
    import openhands.sdk.context.condenser  # noqa: F401
    import openhands.sdk.conversation.state  # noqa: F401
    import openhands.sdk.mcp.config  # noqa: F401
    import openhands.sdk.security.confirmation_policy  # noqa: F401
    import openhands.sdk.security.llm_analyzer  # noqa: F401
    import openhands.tools  # noqa: F401
    import openhands.tools.file_editor  # noqa: F401
    import openhands.tools.glob  # noqa: F401
    import openhands.tools.grep  # noqa: F401
    import openhands.tools.task_tracker  # noqa: F401
    import openhands.tools.terminal  # noqa: F401

    if get_settings().runtime == "docker":
        import openhands.workspace  # noqa: F401
    if get_settings().enable_browser_tool:
        import openhands.tools.browser_use  # noqa: F401


LIVE_RUNS: dict[str, LiveRun] = {}
PARKED: dict[str, Parked] = {}
_lock = threading.Lock()


def request_stop(task_id: str, reason: str) -> bool:
    """Ask a running task to stop (cancelled / timed_out / budget / tool_limit)."""
    with _lock:
        run = LIVE_RUNS.get(task_id)
    if run is None:
        return False
    if run.stop_reason is None:
        run.stop_reason = reason
    return True


def service_stop_requests() -> None:
    """Called by the watchdog thread: deliver pending interrupts outside SDK callbacks."""
    with _lock:
        runs = list(LIVE_RUNS.values())
    now = time.monotonic()
    for run in runs:
        if run.stop_reason is None and run.waiting_since is None and now > run.deadline:
            run.stop_reason = "timed_out"
        if run.stop_reason and not run.stop_sent and run.conversation is not None:
            run.stop_sent = True
            try:
                run.conversation.interrupt()
            except Exception:  # noqa: BLE001
                log.exception("interrupt failed for %s", run.task_id)


def live_task_ids() -> list[str]:
    with _lock:
        return list(LIVE_RUNS)


def get_live(task_id: str) -> LiveRun | None:
    with _lock:
        return LIVE_RUNS.get(task_id)


# --------------------------------------------------------------------------- preparation


def _monthly_spend(db, agent_id: str) -> float:
    start = utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return float(db.execute(
        select(func.coalesce(func.sum(UsageRecord.cost_usd), 0.0))
        .where(UsageRecord.agent_id == agent_id, UsageRecord.created_at >= start)
    ).scalar_one())


def _prepare(task_id: str) -> Prepared:
    s = get_settings()
    with session_scope() as db:
        task = db.get(Task, task_id)
        if task is None:
            raise ExecutionFailure("not_found", "task no longer exists")
        agent = db.get(Agent, task.agent_id)
        org = db.get(Organization, task.org_id)
        if agent is None or agent.status != "active":
            raise ExecutionFailure("agent_unavailable", "agent is not active")
        ver = db.execute(select(AgentVersion).where(AgentVersion.agent_id == agent.id,
                                                    AgentVersion.version == task.agent_version)).scalar_one()
        cfg = AgentConfig.model_validate(ver.config)
        provider = db.get(ModelProvider, cfg.model.provider_id)
        if provider is None or provider.org_id != task.org_id:
            raise ExecutionFailure("provider_missing", "the agent's model provider no longer exists")

        if cfg.policy.budget_usd_monthly is not None:
            spent = _monthly_spend(db, agent.id)
            if spent >= cfg.policy.budget_usd_monthly:
                raise ExecutionFailure("budget_exceeded",
                                       f"monthly budget ${cfg.policy.budget_usd_monthly:.2f} reached (${spent:.2f} spent)")

        # Session: continue a compatible session or create a new one.
        sess = db.get(ExecutionSession, task.session_id) if task.session_id else None
        is_continuation = bool(sess and sess.status == "active" and sess.agent_id == agent.id
                               and sess.runtime == s.runtime and task.attempt == 0)
        if not is_continuation:
            sess = ExecutionSession(org_id=task.org_id, agent_id=agent.id, conversation_id=str(uuid.uuid4()),
                                    runtime=s.runtime, workspace_path="", title=task.title[:200])
            db.add(sess)
            db.flush()
            base = session_dir(task.org_id, agent.id, sess.id)
            sess.workspace_path = str(base)
            task.session_id = sess.id
        base = Path(sess.workspace_path)
        sess.last_active_at = utcnow()

        # Model (fallback on retry after provider failure).
        model = cfg.model.model
        if task.attempt > 0 and cfg.model.fallback_model and (task.error or {}).get("code") in PROVIDER_CODES:
            model = cfg.model.fallback_model
        try:
            llm, pricing_known = build_llm(db, provider, cfg.model.model_dump(), model_override=model)
        except ProviderError as exc:
            raise ExecutionFailure(exc.code, exc.message, exc.retryable) from exc

        # Platform tools (served by the platform MCP server, permission-checked per call).
        platform_tools: list[str] = []
        if "knowledge_search" in cfg.tools and cfg.knowledge_sources:
            platform_tools.append("knowledge_search")
        http_integrations = []
        mcp_integrations: dict[str, Any] = {}
        if cfg.integrations:
            integs = db.execute(select(Integration).where(Integration.org_id == task.org_id,
                                                          Integration.id.in_(cfg.integrations),
                                                          Integration.status == "active")).scalars().all()
            from sca.services.integrations import build_mcp_server

            for integ in integs:
                if integ.type == "http" and "integrations" in cfg.tools and cfg.policy.network_access:
                    http_integrations.append(integ.name)
                elif integ.type == "mcp" and cfg.policy.network_access:
                    try:
                        mcp_integrations[f"int_{integ.name.lower().replace(' ', '_')[:40]}"] = build_mcp_server(db, integ)
                    except Exception as exc:  # noqa: BLE001
                        log.warning("skipping MCP integration %s: %s", integ.name, exc)
        if http_integrations:
            platform_tools += ["list_integrations", "call_integration"]
        if "web_search" in cfg.tools:
            from sca.services import websearch

            if websearch.api_key(db, task.org_id)[0]:
                platform_tools += ["web_search", "web_read"]
            else:
                log.warning("web search enabled for agent %s but no Tavily key is configured", agent.id)
        if ("delegation" in cfg.tools and cfg.policy.delegation.allowed_agent_ids
                and task.delegation_depth < cfg.policy.delegation.max_depth):
            platform_tools.append("delegate_task")

        token = None
        if platform_tools:
            token = pysecrets.token_urlsafe(32)
            db.add(PlatformToken(id=sha256_hex(token), org_id=task.org_id, task_id=task.id, agent_id=agent.id,
                                 expires_at=utcnow() + timedelta(seconds=task.timeout_s + s.approval_timeout_s + 600)))

        return Prepared(
            task_id=task.id, org_id=task.org_id, agent_id=agent.id, agent_name=agent.name, org_name=org.name,
            cfg=cfg, instructions=task.instructions, title=task.title, session_id=sess.id,
            conversation_id=sess.conversation_id, is_continuation=is_continuation, runtime=s.runtime,
            project_dir=base / "project", state_dir=base / "state", llm=llm, model=model,
            provider_id=provider.id, pricing_known=pricing_known, platform_token=token,
            platform_tools=platform_tools, mcp_integrations=mcp_integrations, timeout_s=task.timeout_s,
            started_at=time.time(), requested_by=task.requested_by, inline=task.inline,
            parent_task_id=task.parent_task_id, depth=task.delegation_depth,
        )


def _runtime_tools(cfg: AgentConfig) -> list:
    from openhands.sdk import Tool

    tools = []
    if "terminal" in cfg.tools:
        from openhands.tools.terminal import TerminalTool

        tools.append(Tool(name=TerminalTool.name))
    if "file_editor" in cfg.tools:
        from openhands.tools.file_editor import FileEditorTool

        tools.append(Tool(name=FileEditorTool.name))
    if "task_tracker" in cfg.tools:
        from openhands.tools.task_tracker import TaskTrackerTool

        tools.append(Tool(name=TaskTrackerTool.name))
    if "grep" in cfg.tools:
        from openhands.tools.grep import GrepTool

        tools.append(Tool(name=GrepTool.name))
    if "glob" in cfg.tools:
        from openhands.tools.glob import GlobTool

        tools.append(Tool(name=GlobTool.name))
    if "browser" in cfg.tools and get_settings().enable_browser_tool:
        from openhands.tools.browser_use import BrowserToolSet

        tools.append(Tool(name=BrowserToolSet.name))
    return tools


def _build_conversation(p: Prepared, callback):
    from pydantic import SecretStr

    from openhands.sdk import Agent as SdkAgent
    from openhands.sdk import AgentContext, Conversation
    from openhands.sdk.context.condenser import LLMSummarizingCondenser
    from openhands.sdk.mcp.config import MCPServer
    from openhands.sdk.security.confirmation_policy import AlwaysConfirm, ConfirmRisky, NeverConfirm
    from openhands.sdk.security.llm_analyzer import LLMSecurityAnalyzer

    s = get_settings()
    mcp_config: dict[str, Any] = dict(p.mcp_integrations)
    if p.platform_token:
        base = s.internal_base_url.rstrip("/")
        if p.runtime == "docker":
            base = base.replace("127.0.0.1", "host.docker.internal").replace("localhost", "host.docker.internal")
        mcp_config["platform"] = MCPServer(
            url=f"{base}/mcp/platform/mcp", transport="http",
            headers={"Authorization": SecretStr(f"Bearer {p.platform_token}")},
            timeout=float(s.approval_timeout_s + p.cfg.policy.delegation.child_timeout_s + 120),
        )
    filter_regex = None
    if p.platform_token:
        hidden = {"knowledge_search", "list_integrations", "call_integration", "delegate_task",
                  "web_search", "web_read"} - set(p.platform_tools)
        if hidden:
            filter_regex = "^(?!(?:.*_)?(?:" + "|".join(sorted(hidden)) + ")$).*$"

    suffix = compose_system_suffix(p.cfg, p.agent_name, p.org_name)
    if "knowledge_search" in p.platform_tools:
        suffix += "\n\nUse the knowledge_search tool to consult approved company knowledge and cite the returned source references."
    if "web_search" in p.platform_tools:
        suffix += "\n\n" + WEB_GUIDANCE
    if "delegate_task" in p.platform_tools:
        suffix += "\n\nYou may delegate well-scoped sub-tasks to permitted agents with delegate_task."
    agent = SdkAgent(
        llm=p.llm,
        tools=_runtime_tools(p.cfg),
        mcp_config=mcp_config,
        filter_tools_regex=filter_regex,
        # Our identity replaces the runtime's default "You are OpenHands agent" line (SDK soul_content).
        system_prompt_kwargs={"soul_content": compose_identity(p.agent_name, p.org_name, p.cfg)},
        agent_context=AgentContext(system_message_suffix=suffix, load_user_skills=False, load_public_skills=False),
        condenser=LLMSummarizingCondenser(llm=p.llm.model_copy(update={"usage_id": "condenser"}),
                                          max_size=120, keep_first=4),
    )
    common = dict(agent=agent, conversation_id=uuid.UUID(p.conversation_id), callbacks=[callback],
                  visualizer=None, max_iteration_per_run=p.cfg.policy.max_iterations)
    if p.runtime == "docker":
        ws = make_docker_workspace(p.project_dir, p.cfg.policy.cpu_limit, p.cfg.policy.memory_mb)
        conv = Conversation(workspace=ws, **common)
        conv._sca_workspace = ws  # noqa: SLF001 - kept for cleanup
    else:
        conv = Conversation(workspace=str(p.project_dir), persistence_dir=str(p.state_dir),
                            delete_on_close=False, **common)
    mode = p.cfg.policy.approval_mode
    if mode == "always":
        conv.set_confirmation_policy(AlwaysConfirm())
    elif mode == "risky":
        conv.set_security_analyzer(LLMSecurityAnalyzer())
        conv.set_confirmation_policy(ConfirmRisky())
    else:
        conv.set_confirmation_policy(NeverConfirm())
    return conv


# --------------------------------------------------------------------------- helpers


def _metrics(conv) -> dict[str, float]:
    try:
        m = conv.conversation_stats.get_combined_metrics()
        u = m.accumulated_token_usage
        return {
            "prompt_tokens": float(getattr(u, "prompt_tokens", 0) or 0),
            "completion_tokens": float(getattr(u, "completion_tokens", 0) or 0),
            "cache_read_tokens": float(getattr(u, "cache_read_tokens", 0) or 0),
            "cost": float(m.accumulated_cost or 0.0),
            "requests": float(len(m.token_usages or [])),
        }
    except Exception:  # noqa: BLE001
        return {"prompt_tokens": 0, "completion_tokens": 0, "cache_read_tokens": 0, "cost": 0.0, "requests": 0}


def _final_text(conv) -> str:
    try:
        events = list(conv.state.events)
    except Exception:  # noqa: BLE001
        return ""
    for ev in reversed(events):
        name = type(ev).__name__
        if name == "ActionEvent" and ev.tool_name == "finish" and ev.action is not None:
            msg = getattr(ev.action, "message", "")
            if msg:
                return msg
        if name == "MessageEvent" and ev.source == "agent":
            text = "\n".join(getattr(c, "text", "") for c in ev.llm_message.content)
            if text.strip():
                return text
    return ""


def _last_error(conv) -> tuple[str, str]:
    try:
        for ev in reversed(list(conv.state.events)):
            if type(ev).__name__ == "ConversationErrorEvent":
                return ev.code, ev.detail
    except Exception:  # noqa: BLE001
        pass
    return "runtime_error", "the agent stopped without finishing"


def _pending_actions(conv) -> list[dict[str, Any]]:
    from openhands.sdk.conversation.state import ConversationState

    from sca.runtime.translate import _action_args

    out = []
    try:
        for a in ConversationState.get_unmatched_actions(list(conv.state.events)):
            out.append({"tool": a.tool_name, "summary": a.summary or f"call {a.tool_name}",
                        "args": _action_args(a.action), "risk": getattr(a.security_risk, "value", "")})
    except Exception:  # noqa: BLE001
        log.exception("could not read pending actions")
    return out


def _scan_artifacts(p: Prepared, since: float) -> None:
    root = p.project_dir
    if not root.exists():
        return
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules", "__pycache__", ".venv", ".cache")]
        for fn in filenames:
            fp = Path(dirpath) / fn
            try:
                if fp.is_symlink():
                    continue
                st = fp.stat()
            except OSError:
                continue
            if st.st_mtime + 1 < since or st.st_size > 200 * 1024 * 1024:
                continue
            found.append((fp, st.st_size))
            if len(found) >= 500:
                break
    with session_scope() as db:
        for fp, size in found:
            rel = str(fp.relative_to(root))
            h = hashlib.sha256()
            with open(fp, "rb") as fh:
                for block in iter(lambda: fh.read(1 << 20), b""):
                    h.update(block)
            existing = db.execute(select(Artifact).where(Artifact.task_id == p.task_id, Artifact.path == rel)).scalar_one_or_none()
            if existing is None:
                db.add(Artifact(org_id=p.org_id, task_id=p.task_id, agent_id=p.agent_id, session_id=p.session_id,
                                path=rel, size=size, sha256=h.hexdigest(),
                                mime=mimetypes.guess_type(fn)[0] or "application/octet-stream"))
            else:
                existing.size, existing.sha256 = size, h.hexdigest()
    if found:
        bus.emit(p.org_id, p.task_id, p.agent_id, "artifact", f"{len(found)} file(s) produced or updated",
                 {"files": [str(f.relative_to(root)) for f, _ in found[:50]]})


def _record_usage(p: Prepared, conv, baseline: dict[str, float], tool_calls: int) -> dict[str, float]:
    now = _metrics(conv)
    delta = {k: max(now[k] - baseline.get(k, 0.0), 0.0) for k in now}
    with session_scope() as db:
        db.add(UsageRecord(
            org_id=p.org_id, agent_id=p.agent_id, task_id=p.task_id, user_id=p.requested_by,
            provider_id=p.provider_id, model=p.model, prompt_tokens=int(delta["prompt_tokens"]),
            completion_tokens=int(delta["completion_tokens"]), cache_read_tokens=int(delta["cache_read_tokens"]),
            llm_requests=int(delta["requests"]), tool_calls=tool_calls,
            cost_usd=round(delta["cost"], 6) if p.pricing_known else None,
            cost_source="estimated" if p.pricing_known else "unknown",
        ))
        task = db.get(Task, p.task_id)
        u = dict(task.usage or {})
        for k in ("prompt_tokens", "completion_tokens", "cache_read_tokens", "requests"):
            u[k] = int(u.get(k, 0) + delta[k])
        u["tool_calls"] = int(u.get("tool_calls", 0) + tool_calls)
        if p.pricing_known:
            u["cost_usd"] = round(float(u.get("cost_usd", 0.0)) + delta["cost"], 6)
            u["cost_source"] = "estimated from provider-published rates"
        u["model"] = p.model
        task.usage = u
    return now


def _close(conv) -> None:
    try:
        conv.close()
    except Exception:  # noqa: BLE001
        log.debug("conversation close failed", exc_info=True)
    ws = getattr(conv, "_sca_workspace", None)
    if ws is not None:
        try:
            ws.cleanup()
        except Exception:  # noqa: BLE001
            log.warning("sandbox cleanup failed", exc_info=True)


def _revoke_token(task_id: str) -> None:
    with session_scope() as db:
        for t in db.execute(select(PlatformToken).where(PlatformToken.task_id == task_id)).scalars():
            t.revoked = True


def _workspace_relative(text: str) -> str:
    """Replace server paths to a session's project folder with workspace-relative ones, so replies never
    show internal paths (host data dir or the sandbox mount) that users cannot open."""
    if not text:
        return text
    root = re.escape(str(get_settings().workspaces_dir))
    text = re.sub(root + r"/[0-9a-f]{32}/[0-9a-f]{32}/[0-9a-f]{32}/project/?", "", text)
    text = re.sub(r"(?<![\w.])/workspace/project/?", "", text)
    return re.sub(root + r"[^\s`'\")]*", "the workspace", text)


def _finish(task_id: str, status: str, *, summary: str = "", error: dict | None = None,
            requeue_in: float | None = None) -> None:
    with session_scope() as db:
        task = db.get(Task, task_id)
        if task is None:
            return
        if requeue_in is not None:
            task.status = "queued"
            task.attempt += 1
            task.scheduled_for = utcnow() + timedelta(seconds=requeue_in)
            task.error = error
            task.lease_owner = None
            task.lease_expires_at = None
            task.session_id = None  # retry starts a fresh session
        else:
            task.status = status
            task.finished_at = utcnow()
            task.result_summary = _workspace_relative(redact_text(summary))[:50_000]
            task.error = error
            task.lease_owner = None
            task.lease_expires_at = None
        deleg = db.execute(select(Delegation).where(Delegation.child_task_id == task_id)).scalar_one_or_none()
        if deleg is not None:
            deleg.status = task.status
            deleg.result_ref = f"task:{task_id}"
        audit.record(db, task.org_id, f"task.{'retry_scheduled' if requeue_in is not None else status}",
                     actor_type="system", target_type="task", target_id=task_id,
                     details={"error": error, "attempt": task.attempt})
    msg = {"completed": "Task completed", "failed": "Task failed", "cancelled": "Task cancelled",
           "timed_out": "Task timed out", "waiting_for_approval": "Waiting for approval"}.get(status, status)
    if requeue_in is not None:
        msg = f"Retry scheduled in {int(requeue_in)}s"
    with session_scope() as db:
        t = db.get(Task, task_id)
        bus.emit(t.org_id, t.id, t.agent_id, "status", msg if not error else f"{msg}: {error.get('message', '')[:300]}",
                 {"status": t.status, "error": error}, db=db)


# --------------------------------------------------------------------------- main entry point


def execute_task(task_id: str, worker_id: str, *, inline: bool = False) -> str:
    """Run (or resume) a task. Returns the resulting task status."""
    parked = PARKED.pop(task_id, None)
    resume_decision: ApprovalRequest | None = None
    with session_scope() as db:
        task = db.get(Task, task_id)
        if task is None:
            return "missing"
        resume_id = (task.usage or {}).get("resume_approval_id")
        if resume_id:
            resume_decision = db.get(ApprovalRequest, resume_id)
            u = dict(task.usage)
            u.pop("resume_approval_id", None)
            task.usage = u
        if inline:
            task.status = "running"
            task.started_at = task.started_at or utcnow()
        org_id, agent_id = task.org_id, task.agent_id

    try:
        if parked is not None:
            p = parked.prepared
            conv = parked.conversation
            baseline = parked.baseline
        else:
            p = _prepare(task_id)
            conv = None
            baseline = {}
    except ExecutionFailure as exc:
        _handle_failure(task_id, exc.code, exc.message, exc.retryable)
        return "failed"

    run = LiveRun(task_id=task_id, org_id=org_id, agent_id=agent_id,
                  deadline=time.monotonic() + p.timeout_s, budget_usd=p.cfg.policy.budget_usd_per_task,
                  max_tool_calls=p.cfg.policy.max_tool_calls)
    segment_start = time.time()

    def on_event(event) -> None:
        try:
            out = translate(event)
        except Exception:  # noqa: BLE001
            log.exception("event translation failed")
            return
        if out is None:
            return
        type_, summary, data = out
        if type_ == "tool_call":
            run.tool_calls += 1
            if run.tool_calls > run.max_tool_calls and run.stop_reason is None:
                run.stop_reason = "tool_limit"
        bus.emit(org_id, task_id, agent_id, type_, summary, data)
        if run.budget_usd is not None and run.conversation is not None and run.stop_reason is None:
            spent = _metrics(run.conversation)["cost"] - baseline.get("cost", 0.0)
            if spent > run.budget_usd:
                run.stop_reason = "budget"

    with _lock:
        LIVE_RUNS[task_id] = run
    try:
        if conv is None:
            bus.emit(org_id, task_id, agent_id, "status",
                     f"Starting on {p.runtime} runtime with model {p.model}"
                     + (" (continuing session)" if p.is_continuation else ""),
                     {"status": "running", "runtime": p.runtime, "model": p.model, "session_id": p.session_id})
            holder = {"fn": on_event}
            p.extra["holder"] = holder

            def dispatch(e, _h=holder):
                _h["fn"](e)

            try:
                conv = _build_conversation(p, dispatch)
            except Exception as exc:  # noqa: BLE001
                if p.is_continuation:
                    log.warning("could not resume session %s (%s); starting fresh conversation", p.session_id, exc)
                    p.conversation_id = str(uuid.uuid4())
                    with session_scope() as db:
                        sess = db.get(ExecutionSession, p.session_id)
                        sess.conversation_id = p.conversation_id
                    conv = _build_conversation(p, dispatch)
                else:
                    raise
            run.conversation = conv
            baseline = _metrics(conv)
            message = p.instructions
            if p.parent_task_id:
                message = (f"[Delegated sub-task from another agent, depth {p.depth}]\n{p.instructions}\n\n"
                           "Return a concise, self-contained result.")
            if resume_decision is not None:
                # Process restarted while waiting for approval: the conversation was reloaded
                # from its persisted state, so apply the decision instead of re-sending the task.
                if p.runtime == "docker":
                    raise ExecutionFailure("sandbox_lost", "the sandbox was lost while waiting for approval")
                if resume_decision.status != "approved":
                    conv.reject_pending_actions(resume_decision.decision_note or "Rejected by a human reviewer")
                bus.emit(org_id, task_id, agent_id, "approval", f"Approval {resume_decision.status}; resuming",
                         {"approval_id": resume_decision.id, "decision": resume_decision.status})
            else:
                conv.send_message(message)
        else:
            run.conversation = conv
            # Route the conversation's callback to this segment's LiveRun accounting.
            p.extra["holder"]["fn"] = on_event
            if resume_decision is not None and resume_decision.status != "approved":
                reason = resume_decision.decision_note or f"Action {resume_decision.status} by a human reviewer"
                conv.reject_pending_actions(reason)
                bus.emit(org_id, task_id, agent_id, "approval", f"Action rejected: {reason[:200]}",
                         {"approval_id": resume_decision.id, "decision": resume_decision.status})
            else:
                bus.emit(org_id, task_id, agent_id, "approval", "Action approved; resuming",
                         {"approval_id": parked.approval_id, "decision": "approved"})

        return _run_loop(p, conv, run, baseline, segment_start, inline)
    except ExecutionFailure as exc:
        if conv is not None:
            _record_usage(p, conv, baseline, run.tool_calls)
            _close(conv)
        _revoke_token(task_id)
        _handle_failure(task_id, exc.code, exc.message, exc.retryable)
        return "failed"
    except Exception as exc:  # noqa: BLE001
        log.exception("task %s crashed", task_id)
        root = exc.__cause__ or exc
        code = type(root).__name__
        if conv is not None:
            try:
                _record_usage(p, conv, baseline, run.tool_calls)
            except Exception:  # noqa: BLE001
                pass
            _close(conv)
        _revoke_token(task_id)
        _handle_failure(task_id, code, redact_text(str(root))[:1500], code in RETRYABLE_CODES or _looks_transient(root))
        return "failed"
    finally:
        with _lock:
            LIVE_RUNS.pop(task_id, None)


def _looks_transient(exc: Exception) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    if any(code.lower() in text for code in RETRYABLE_CODES):
        return True
    return any(k in text for k in ("rate limit", "timeout", "timed out", "503", "502", "overloaded",
                                   "connection reset", "connection error", "service unavailable"))


def _run_loop(p: Prepared, conv, run: LiveRun, baseline: dict[str, float], segment_start: float, inline: bool) -> str:
    from openhands.sdk.conversation.state import ConversationExecutionStatus as S

    s = get_settings()
    while True:
        conv.run()
        status = conv.state.execution_status
        if run.stop_reason:
            break
        if status == S.WAITING_FOR_CONFIRMATION:
            actions = _pending_actions(conv)
            with session_scope() as db:
                appr = ApprovalRequest(
                    org_id=p.org_id, task_id=p.task_id, agent_id=p.agent_id, kind="tool_action",
                    summary="; ".join(a["summary"] for a in actions)[:500] or "Agent action requires approval",
                    details={"actions": actions, "policy": p.cfg.policy.approval_mode},
                    expires_at=utcnow() + timedelta(seconds=s.approval_timeout_s),
                )
                db.add(appr)
                db.flush()
                approval_id = appr.id
                task = db.get(Task, p.task_id)
                task.status = "waiting_for_approval"
                audit.record(db, p.org_id, "approval.requested", actor_type="agent", actor_id=p.agent_id,
                             target_type="task", target_id=p.task_id, details={"approval_id": approval_id,
                                                                              "actions": actions})
            bus.emit(p.org_id, p.task_id, p.agent_id, "approval", f"Approval required: {actions[0]['summary'] if actions else ''}",
                     {"approval_id": approval_id, "actions": actions, "status": "waiting_for_approval"})
            if inline:
                decision = _await_decision(approval_id, run)
                if decision is None:
                    break
                if decision.status != "approved":
                    conv.reject_pending_actions(decision.decision_note or f"Action {decision.status} by reviewer")
                with session_scope() as db:
                    db.get(Task, p.task_id).status = "running"
                continue
            # Park: release the worker slot until a human decides.
            baseline_now = _record_usage(p, conv, baseline, run.tool_calls)
            run.tool_calls = 0
            PARKED[p.task_id] = Parked(conversation=conv, prepared=p, approval_id=approval_id, baseline=baseline_now)
            with session_scope() as db:
                task = db.get(Task, p.task_id)
                task.lease_owner = None
                task.lease_expires_at = None
            return "waiting_for_approval"
        break

    # Terminal outcome for this task.
    _record_usage(p, conv, baseline, run.tool_calls)
    _scan_artifacts(p, segment_start)
    reason = run.stop_reason
    if reason == "cancelled":
        _close(conv)
        _revoke_token(p.task_id)
        _finish(p.task_id, "cancelled", summary=_final_text(conv), error={"code": "cancelled", "message": "Cancelled by user"})
        return "cancelled"
    if reason == "timed_out":
        _close(conv)
        _revoke_token(p.task_id)
        _finish(p.task_id, "timed_out", summary=_final_text(conv),
                error={"code": "timeout", "message": f"Exceeded the {p.timeout_s}s task timeout"})
        return "timed_out"
    if reason in ("budget", "tool_limit"):
        _close(conv)
        _revoke_token(p.task_id)
        msg = (f"Per-task budget of ${p.cfg.policy.budget_usd_per_task} exceeded" if reason == "budget"
               else f"Tool-call limit of {p.cfg.policy.max_tool_calls} exceeded")
        _finish(p.task_id, "failed", summary=_final_text(conv), error={"code": f"{reason}_exceeded", "message": msg})
        return "failed"

    status = conv.state.execution_status
    final = _final_text(conv)
    _close(conv)
    _revoke_token(p.task_id)
    from openhands.sdk.conversation.state import ConversationExecutionStatus as S

    if status == S.FINISHED:
        with session_scope() as db:
            sess = db.get(ExecutionSession, p.session_id)
            if sess and p.runtime == "docker":
                sess.status = "closed"  # docker conversation state lives in the (removed) container
        _finish(p.task_id, "completed", summary=final or "Completed.")
        return "completed"
    code, detail = _last_error(conv)
    _handle_failure(p.task_id, code, detail, code in RETRYABLE_CODES, summary=final)
    return "failed"


def _await_decision(approval_id: str, run: LiveRun) -> ApprovalRequest | None:
    run.waiting_since = time.monotonic()
    try:
        while run.stop_reason is None:
            with session_scope() as db:
                appr = db.get(ApprovalRequest, approval_id)
                if appr.status != "pending":
                    db.expunge(appr)
                    return appr
            time.sleep(1.0)
        return None
    finally:
        run.deadline += time.monotonic() - run.waiting_since
        run.waiting_since = None


def _handle_failure(task_id: str, code: str, message: str, retryable: bool, summary: str = "") -> None:
    with session_scope() as db:
        task = db.get(Task, task_id)
        if task is None:
            return
        can_retry = retryable and not task.inline and task.attempt < task.max_retries and not task.cancel_requested
        attempt = task.attempt
    err = {"code": code, "message": message[:2000], "retryable": retryable}
    if can_retry:
        _finish(task_id, "queued", error=err, requeue_in=min(15 * (2 ** attempt), 600))
    else:
        _finish(task_id, "failed", summary=summary, error=err)


def discard_parked(task_id: str) -> None:
    parked = PARKED.pop(task_id, None)
    if parked is not None:
        _close(parked.conversation)
    _revoke_token(task_id)


def finalize_parked_cancel(task_id: str) -> None:
    discard_parked(task_id)
    _finish(task_id, "cancelled", error={"code": "cancelled", "message": "Cancelled by user"})

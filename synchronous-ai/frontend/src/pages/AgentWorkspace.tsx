import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  FolderOpen,
  History,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Power,
  RotateCcw,
  Send,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BotMark } from "../components/BotMark";
import { Markdown } from "../components/Markdown";
import { Shell, useLive } from "../components/Shell";
import { Timeline } from "../components/Timeline";
import { Alert, Dots, Empty, ErrorState, KV, Menu, Skeleton, Status, Tabs, Tag, useConfirm, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { bytes, clock, duration, elapsedSince, fullDateTime, num, shortId, timeAgo, usd } from "../lib/format";
import { usePref } from "../lib/prefs";
import { useSession } from "../lib/session";
import { ACTIVE_TASK_STATES, FAILURE, statusOf } from "../lib/status";
import { ActivityEvent, useActivityStream } from "../lib/stream";

const TOOL_ACCESS: Record<string, string> = {
  terminal: "execute", file_editor: "write", task_tracker: "internal", grep: "read", glob: "read", browser: "execute",
  knowledge_search: "read", integrations: "external", delegation: "delegate",
};

export default function AgentWorkspace() {
  const { agentId = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const { markSeen } = useLive();
  const [ctxOpen, setCtxOpen] = usePref("ws.context", true);
  const [drawer, setDrawer] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const agent = useQuery({ queryKey: ["agents", agentId], queryFn: ({ signal }) => api.get(`/api/agents/${agentId}`, signal), refetchInterval: 10000 });
  const sessions = useQuery({ queryKey: ["sessions", agentId], queryFn: ({ signal }) => api.get(`/api/sessions?agent_id=${agentId}&page_size=50`, signal), refetchInterval: 10000 });
  const sessionParam = sp.get("session");
  const taskParam = sp.get("task");
  const sessionList: any[] = sessions.data?.items ?? [];
  // Session shown in the thread: explicit, or the one owning the selected task, or the latest.
  const taskDetail = useQuery({ queryKey: ["task", taskParam], queryFn: ({ signal }) => api.get(`/api/tasks/${taskParam}`, signal), enabled: !!taskParam, refetchInterval: 4000 });
  const sessionId = sessionParam === "new" ? "" : sessionParam || taskDetail.data?.session_id || (taskParam ? "" : sessionList[0]?.id ?? "");
  const pendingTask = taskParam && taskDetail.data && !taskDetail.data.session_id ? taskDetail.data : null;

  const thread = useQuery({
    queryKey: ["tasks", "thread", agentId, sessionId],
    queryFn: ({ signal }) => api.get(`/api/tasks${qs({ agent_id: agentId, session_id: sessionId, top_level: true, page_size: 50, sort: "created", order: "asc" })}`, signal),
    enabled: !!sessionId,
    refetchInterval: 6000,
  });
  const turns: any[] = useMemo(() => {
    const list: any[] = sessionId ? thread.data?.items ?? [] : [];
    if (pendingTask && !list.some((t) => t.id === pendingTask.id)) return [...list, pendingTask];
    return list;
  }, [thread.data, sessionId, pendingTask]);
  const selectedId = taskParam ?? turns[turns.length - 1]?.id ?? null;

  useEffect(() => markSeen(agentId), [agentId, markSeen]);

  // Live updates: append streamed events to per-task caches and refresh affected task state.
  const refreshTimer = useRef<number | null>(null);
  const stream = useActivityStream((e: ActivityEvent) => {
    qc.setQueryData<ActivityEvent[]>(["task-events", e.task_id], (old) => (old && !old.some((x) => x.id === e.id) ? [...old, e] : old));
    if (["status", "approval", "artifact", "message"].includes(e.type)) {
      if (refreshTimer.current === null)
        refreshTimer.current = window.setTimeout(() => {
          refreshTimer.current = null;
          qc.invalidateQueries({ queryKey: ["tasks", "thread", agentId] });
          qc.invalidateQueries({ queryKey: ["task"] });
          qc.invalidateQueries({ queryKey: ["agents", agentId] });
          qc.invalidateQueries({ queryKey: ["sessions", agentId] });
          qc.invalidateQueries({ queryKey: ["artifacts", e.task_id] });
        }, 400);
    }
  }, { agentId });

  const select = useCallback((taskId: string) => {
    const n = new URLSearchParams(sp);
    n.set("task", taskId);
    setSp(n, { replace: true });
    if (window.matchMedia("(max-width: 1080px)").matches) setDrawer(true);
  }, [sp, setSp]);
  const setSession = (sid: string) => {
    const n = new URLSearchParams();
    n.set("session", sid || "new");
    setSp(n, { replace: true });
  };

  if (agent.isLoading) return <Shell crumbs={[{ label: "Agents", to: "/agents" }, { label: "…" }]}><Skeleton h={48} /><Skeleton h={300} style={{ marginTop: 16 }} /></Shell>;
  if (agent.isError) return <Shell crumbs={[{ label: "Agents", to: "/agents" }, { label: "Unavailable" }]}><ErrorState error={agent.error} onRetry={() => agent.refetch()} what="this agent" /></Shell>;
  const a = agent.data;
  const activeTask = turns.find((t) => ACTIVE_TASK_STATES.includes(t.status));
  const stateForMark = a.status !== "active" ? a.status : a.live_status;
  const currentSession = sessionList.find((s) => s.id === sessionId);

  return (
    <Shell full crumbs={[{ label: "Agents", to: "/agents" }, { label: a.name }]}>
      <div className={`ws ${ctxOpen ? "" : "ctx-off"} ${drawer ? "ctx-drawer" : ""}`}>
        <div className="ws-main">
          <WorkspaceHeader a={a} state={stateForMark} activeTask={activeTask} onRun={() => composerRef.current?.focus()}
            ctxOpen={ctxOpen} onToggleCtx={() => (window.matchMedia("(max-width: 1080px)").matches ? setDrawer(!drawer) : setCtxOpen(!ctxOpen))} />
          <div className="ws-bar">
            <label className="tiny muted" htmlFor="session-select">Session</label>
            <select id="session-select" value={sessionParam === "new" ? "" : sessionId} onChange={(e) => setSession(e.target.value)} className="ws-session" style={{ height: 28, fontSize: 12.5 }}>
              <option value="">New session</option>
              {sessionList.map((s) => <option key={s.id} value={s.id}>{(s.title || "Session").slice(0, 60)} · {timeAgo(s.last_active_at)}{s.active ? " · running" : ""}</option>)}
            </select>
            <span className="tiny muted hide-sm">
              {sessionId ? (currentSession?.continuable ? "Follow-ups share this session's files and conversation memory." : "Closed session: follow-ups start a new session.") : "A new task starts a fresh session with its own workspace."}
            </span>
            <span className="grow" />
            <span className="tiny muted row" style={{ gap: 6 }} aria-live="polite">
              <span style={{ width: 6, height: 6, borderRadius: 3, background: stream === "live" ? "var(--success)" : "var(--faint)" }} aria-hidden />
              {stream === "live" ? "Live" : stream === "reconnecting" ? "Reconnecting…" : "Connecting…"}
            </span>
          </div>
          <div className="ws-scroll" id="thread">
            <Thread agent={a} turns={turns} loading={!!sessionId && thread.isLoading} error={thread.error} selectedId={selectedId} onSelect={select} />
          </div>
          <Composer agent={a} sessionId={sessionId} continuable={!sessionId || !!currentSession?.continuable} busy={!!activeTask && !!sessionId}
            textareaRef={composerRef} onSubmitted={(t) => { const n = new URLSearchParams(); if (sessionId) n.set("session", sessionId); n.set("task", t.id); setSp(n, { replace: true }); }} />
        </div>
        <ContextPanel agent={a} taskId={selectedId} onClose={() => (drawer ? setDrawer(false) : setCtxOpen(false))} />
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------------ header

function WorkspaceHeader({ a, state, activeTask, onRun, ctxOpen, onToggleCtx }: { a: any; state: string; activeTask: any; onRun: () => void; ctxOpen: boolean; onToggleCtx: () => void }) {
  const { can } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const setStatus = useMutation({
    mutationFn: (status: string) => api.post(`/api/agents/${a.id}/status`, { status }),
    onSuccess: (_, s) => { qc.invalidateQueries({ queryKey: ["agents"] }); toast("ok", s === "active" ? `${a.name} activated` : `${a.name} disabled`); },
    onError: (e: any) => toast("error", e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/api/agents/${a.id}`),
    onSuccess: (r: any) => {
      nav("/agents", { replace: true });
      qc.removeQueries({ queryKey: ["agents", a.id] });
      qc.removeQueries({ queryKey: ["sessions", a.id] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast("ok", `${a.name} deleted${r.delegation_updated?.length ? `. Removed from delegation targets of ${r.delegation_updated.join(", ")}` : ""}`);
    },
    onError: (e: any) => toast("error", e.message),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/api/tasks/${id}/cancel`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast("ok", "Cancellation requested. The agent stops at its next step."); },
    onError: (e: any) => toast("error", e.message),
  });
  const s = statusOf(state);
  return (
    <header className="ws-head">
      <BotMark seed={a.id} avatar={a.avatar} size={38} state={state} title={`${a.name}, ${s.label}`} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row ws-title" style={{ gap: 10 }}>
          <h1 className="ellipsis">{a.name}</h1>
          <Status status={state} />
        </div>
        <div className="ws-meta">
          <span>{a.config.role || a.category}</span>
          <span className="sep" aria-hidden />
          <span className="mono" title="Model">{a.config.model.model}</span>
          {activeTask && (<><span className="sep" aria-hidden /><span className="ellipsis" style={{ maxWidth: 320 }}>Working on “{activeTask.title}”</span></>)}
        </div>
      </div>
      {activeTask && can("tasks:cancel") && (
        <button className="btn sm danger hide-sm" onClick={async () => {
          if (await confirm({ title: "Cancel this execution?", body: `“${activeTask.title}” will stop at the agent's next step. Work already done stays in the workspace.`, confirmLabel: "Cancel execution", danger: true })) cancel.mutate(activeTask.id);
        }}><Ban /> Cancel execution</button>
      )}
      {can("tasks:create") && <button className="btn sm dark" onClick={onRun} disabled={a.status !== "active"} title={a.status !== "active" ? "Activate the agent to run tasks" : undefined} aria-label="Run task"><Play /> <span className="hide-sm">Run task</span></button>}
      <button className="btn ghost icon sm hide-sm" onClick={onToggleCtx} aria-label={ctxOpen ? "Hide details panel" : "Show details panel"} data-tip={ctxOpen ? "Hide panel" : "Show panel"}>
        {ctxOpen ? <PanelRightClose /> : <PanelRightOpen />}
      </button>
      <Menu label="Agent actions" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label="More actions"><MoreHorizontal /></button>} items={[
        { label: "Edit configuration", icon: Settings2, onSelect: () => nav(`/agents/${a.id}/settings`), disabled: !can("agents:write"), hint: "Requires agent administration rights" },
        { label: "Task history", icon: History, onSelect: () => nav(`/tasks?agent=${a.id}`) },
        { label: "Workspace files", icon: FolderOpen, onSelect: () => nav(`/workspaces?agent=${a.id}`) },
        { label: "Show details panel", icon: PanelRightOpen, onSelect: onToggleCtx },
        { label: "", separator: true },
        a.status === "active"
          ? { label: "Disable agent", icon: Power, danger: true, disabled: !can("agents:write"), hint: "Requires agent administration rights", onSelect: async () => {
            if (await confirm({ title: `Disable ${a.name}?`, body: "Queued tasks will not start and nobody can assign new tasks until it is re-activated. Running executions continue. History is kept.", confirmLabel: "Disable", danger: true })) setStatus.mutate("disabled");
          } }
          : { label: "Activate agent", icon: Power, disabled: !can("agents:write"), onSelect: () => setStatus.mutate("active") },
        { label: "Delete agent", icon: Trash2, danger: true, disabled: !can("agents:write") || remove.isPending, hint: "Requires agent administration rights", onSelect: async () => {
          if (await confirm({
            title: `Delete ${a.name} permanently?`,
            body: "This removes the agent, its configuration versions, task history, schedules and workspace files. It cannot be undone. Usage records and the audit log are kept. Agents with active tasks or pending approvals cannot be deleted; cancel those first, or disable the agent instead to keep its history.",
            confirmLabel: "Delete agent", danger: true, requireText: a.name,
          })) remove.mutate();
        } },
      ]} />
    </header>
  );
}

// ------------------------------------------------------------------ thread

function Thread({ agent, turns, loading, error, selectedId, onSelect }: { agent: any; turns: any[]; loading: boolean; error: any; selectedId: string | null; onSelect: (id: string) => void }) {
  const end = useRef<HTMLDivElement>(null);
  const last = turns[turns.length - 1];
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns.length, last?.status]);
  if (loading) return <div className="thread"><Skeleton h={60} /><Skeleton h={120} /></div>;
  if (error) return <div className="thread"><ErrorState error={error} what="this session" /></div>;
  if (!turns.length)
    return (
      <div className="thread">
        <Empty title={`Give ${agent.name} a task`}>
          {agent.config.objective || agent.description || "Describe the outcome you need. The agent plans, uses its permitted tools, and reports back with results and files."}
        </Empty>
        <StarterHints agent={agent} />
      </div>
    );
  return (
    <div className="thread" aria-live="polite" aria-relevant="additions">
      {turns.map((t) => <Turn key={t.id} t={t} agent={agent} selected={t.id === selectedId} onSelect={() => onSelect(t.id)} />)}
      <div ref={end} />
    </div>
  );
}

function StarterHints({ agent }: { agent: any }) {
  const tools: string[] = agent.config.tools;
  const hints = [
    tools.includes("knowledge_search") && "Answer questions from assigned company knowledge, with citations",
    tools.includes("terminal") && "Write and run scripts in a sandboxed workspace",
    tools.includes("file_editor") && "Produce reports and files you can download",
    tools.includes("integrations") && "Call approved business APIs through the governed gateway",
    tools.includes("delegation") && "Delegate sub-tasks to permitted agents",
  ].filter(Boolean) as string[];
  if (!hints.length) return null;
  return (
    <div className="panel" style={{ padding: "12px 16px" }}>
      <div className="section-title">This agent can</div>
      <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{hints.map((h) => <li key={h}>{h}</li>)}</ul>
    </div>
  );
}

function Turn({ t, agent, selected, onSelect }: { t: any; agent: any; selected: boolean; onSelect: () => void }) {
  const { me } = useSession();
  const terminal = !ACTIVE_TASK_STATES.includes(t.status);
  const detail = useQuery({ queryKey: ["task", t.id], queryFn: ({ signal }) => api.get(`/api/tasks/${t.id}`, signal), staleTime: terminal ? 60_000 : 2_000 });
  const d = detail.data ?? t;
  const [expanded, setExpanded] = useState(false);
  const requester = d.requested_by_name ?? (d.requested_by === me.user.id ? me.user.name : d.schedule_id ? "Schedule" : "Someone");
  const instructions: string = d.instructions ?? t.title;
  const long = instructions.length > 600;
  return (
    <article className="turn" aria-label={`Task ${t.title}`}>
      <div className="msg-user">
        <span className="initials" style={{ background: "var(--surface-3)", color: "var(--ink-2)", width: 26, height: 26 }} aria-hidden>{requester.slice(0, 1).toUpperCase()}</span>
        <div>
          <div className="msg-head"><b>{requester}</b><time dateTime={t.created_at} title={fullDateTime(t.created_at)}>{timeAgo(t.created_at)}</time>
            {t.priority !== 5 && <Tag>priority {t.priority}</Tag>}{t.schedule_id && <Tag>scheduled</Tag>}</div>
          <div className="body prose">{long && !expanded ? `${instructions.slice(0, 600)}…` : instructions}
            {long && <button className="disclose" style={{ display: "block", marginTop: 4 }} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Show full instructions"}</button>}
          </div>
        </div>
      </div>
      <div className="msg-agent">
        <BotMark seed={agent.id} avatar={agent.avatar} size={26} state={t.status === "running" ? "running" : undefined} />
        <div className="body">
          <div className="msg-head">
            <b>{agent.name}</b><Status status={t.status} />
            {t.duration_s != null && <span className="num">{duration(t.duration_s)}</span>}
            {t.status === "running" && t.started_at && <span className="num">{duration(elapsedSince(t.started_at))}</span>}
            {t.usage?.prompt_tokens ? <span className="num">{num((t.usage.prompt_tokens ?? 0) + (t.usage.completion_tokens ?? 0))} tokens</span> : null}
            <span className="grow" />
            <button className={`btn xs ${selected ? "" : "ghost"}`} onClick={onSelect} aria-pressed={selected}>{selected ? "Shown in activity" : "Show activity"}</button>
          </div>
          <TurnBody t={d} onSelect={onSelect} />
        </div>
      </div>
    </article>
  );
}

function TurnBody({ t, onSelect }: { t: any; onSelect: () => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const retry = useMutation({
    mutationFn: () => api.post(`/api/tasks/${t.id}/retry`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast("ok", "Resubmitted as a new task"); },
    onError: (e: any) => toast("error", e.message),
  });
  const events = useQuery({ queryKey: ["task-events", t.id], queryFn: ({ signal }) => api.get(`/api/tasks/${t.id}/events?limit=2000`, signal), staleTime: Infinity });
  const steps = (events.data ?? []).filter((e: ActivityEvent) => ["tool_call", "knowledge", "integration", "delegation"].includes(e.type));
  const lastEvent = (events.data ?? []).filter((e: ActivityEvent) => e.type !== "status").slice(-1)[0];
  const artifacts = useQuery({ queryKey: ["artifacts", t.id], queryFn: ({ signal }) => api.get(`/api/tasks/${t.id}/artifacts`, signal), enabled: !ACTIVE_TASK_STATES.includes(t.status) });
  const pendingApproval = (t.approvals ?? []).find((x: any) => x.status === "pending");
  const failure = t.error_category && t.status !== "completed" && t.status !== "queued" ? FAILURE[t.error_category] ?? FAILURE.runtime : null;
  return (
    <div>
      {t.status === "queued" && <p className="small muted" style={{ margin: 0 }}>{t.error ? `Retry scheduled after: ${t.error.message}` : "Waiting for a free worker…"}</p>}
      {t.status === "running" && (
        <p className="small row" style={{ margin: 0, color: "var(--info)" }}>
          <Dots /> <span className="ellipsis" style={{ color: "var(--ink-2)" }}>{lastEvent ? lastEvent.summary : "Starting the runtime…"}</span>
        </p>
      )}
      {pendingApproval && <InlineApproval approval={pendingApproval} taskId={t.id} canDecide={can("approvals:decide")} />}
      {steps.length > 0 && <ExecSummary steps={steps} live={t.status === "running"} onSelect={onSelect} />}
      {t.status === "completed" && (t.result_summary ? <div className="mt8"><Markdown>{t.result_summary}</Markdown></div> : <p className="small muted">Completed without a written summary.</p>)}
      {failure && (
        <div className="mt8">
          <Alert kind={t.status === "cancelled" ? "neutral" : "error"} actions={can("tasks:create") && <button className="btn xs" onClick={() => retry.mutate()} disabled={retry.isPending}><RotateCcw /> Retry</button>}>
            <b>{failure.label}.</b> {t.error?.message ? <span className="mono" style={{ fontSize: 12 }}>{String(t.error.message).slice(0, 280)}</span> : null}
            <div className="tiny mt4">{failure.next}</div>
          </Alert>
        </div>
      )}
      {(artifacts.data?.length ?? 0) > 0 && (
        <div className="row wrap mt8" aria-label="Generated files">
          {artifacts.data.map((f: any) => (
            <Link key={f.id} className="tag outline" to={`/tasks/${t.id}?tab=artifacts&file=${encodeURIComponent(f.path)}`} title={`${f.path} · ${bytes(f.size)}`}>
              <FileText size={12} aria-hidden /> <span className="mono">{f.path}</span>
            </Link>
          ))}
        </div>
      )}
      {(t.children?.length ?? 0) > 0 && (
        <div className="tiny muted mt8">Delegated: {t.children.map((c: any) => <Link key={c.child_task_id} to={`/tasks/${c.child_task_id}`} style={{ color: "var(--accent)", marginRight: 8 }}>{c.objective.slice(0, 50)} ({statusOf(c.status).label})</Link>)}</div>
      )}
    </div>
  );
}

function ExecSummary({ steps, live, onSelect }: { steps: ActivityEvent[]; live: boolean; onSelect: () => void }) {
  const [open, setOpen] = useState(false);
  const tools = Array.from(new Set(steps.map((s) => s.data?.tool ?? s.type)));
  return (
    <div className="exec-card">
      <button className="exec-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span><b className="num">{steps.length}</b> step{steps.length === 1 ? "" : "s"}{live ? " so far" : ""}</span>
        <span className="muted ellipsis">· {tools.slice(0, 4).join(", ")}{tools.length > 4 ? ` +${tools.length - 4}` : ""}</span>
        <span className="grow" />
        <span className="disclose" role="link" tabIndex={0} onClick={(e) => { e.stopPropagation(); onSelect(); }} onKeyDown={(e) => e.key === "Enter" && onSelect()}>Full timeline</span>
      </button>
      {open && (
        <ol className="exec-list" style={{ listStyle: "none", margin: 0 }}>
          {steps.slice(-30).map((s) => (
            <li key={s.id} className="row small" style={{ padding: "3px 0" }}>
              <time className="mono faint" dateTime={s.ts} style={{ width: 62 }}>{clock(s.ts)}</time>
              <span className="tag mono">{s.data?.tool ?? s.type}</span>
              <span className="ellipsis grow">{s.summary}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function InlineApproval({ approval, taskId, canDecide }: { approval: any; taskId: string; canDecide: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const decide = useMutation({
    mutationFn: (decision: string) => api.post(`/api/approvals/${approval.id}/decide`, { decision }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["task", taskId] }); qc.invalidateQueries({ queryKey: ["approvals-count"] }); toast("ok", r.status === "approved" ? "Approved — the agent will continue" : "Rejected — the agent was told not to proceed"); },
    onError: (e: any) => toast("error", e.message),
  });
  return (
    <div className="approval-card" role="group" aria-label="Approval required">
      <div className="small"><b>Approval required.</b> {approval.summary}</div>
      <div className="row mt8">
        {canDecide ? (
          <>
            <button className="btn xs dark" disabled={decide.isPending} onClick={async () => {
              if (await confirm({ title: "Approve this action?", body: <>The agent will perform: <b>{approval.summary}</b>. This is recorded in the audit log.</>, confirmLabel: "Approve" })) decide.mutate("approved");
            }}><Check /> Approve</button>
            <button className="btn xs" disabled={decide.isPending} onClick={() => decide.mutate("rejected")}><X /> Reject</button>
          </>
        ) : <span className="tiny muted">Waiting for an approver.</span>}
        <Link className="disclose" to="/approvals">Inspect full request →</Link>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ composer

function Composer({ agent, sessionId, continuable, busy, textareaRef, onSubmitted }: {
  agent: any; sessionId: string; continuable: boolean; busy: boolean; textareaRef: React.RefObject<HTMLTextAreaElement>; onSubmitted: (t: any) => void;
}) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const [priority, setPriority] = useState(5);
  const submit = useMutation({
    mutationFn: () => api.post(`/api/agents/${agent.id}/tasks`, { instructions: text.trim(), priority, session_id: sessionId && continuable ? sessionId : null }, { "Idempotency-Key": crypto.randomUUID() }),
    onSuccess: (t) => { setText(""); qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["sessions", agent.id] }); onSubmitted(t); },
    onError: (e: any) => toast("error", e.message),
  });
  if (!can("tasks:create")) return <div className="composer-wrap"><Alert kind="neutral">Your role can view this agent but not assign tasks.</Alert></div>;
  const reason = agent.status !== "active" ? `${agent.name} is ${agent.status}. Activate it to assign tasks.`
    : busy ? "This session has an active task. Wait for it to finish, or start a new session." : null;
  const p = agent.config.policy;
  return (
    <div className="composer-wrap">
      <form className="composer" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !reason) submit.mutate(); }}>
        <label htmlFor="composer" className="sr-only">Task instructions for {agent.name}</label>
        <textarea id="composer" ref={textareaRef} value={text} disabled={!!reason}
          placeholder={reason ?? (sessionId && continuable ? `Follow up with ${agent.name}…` : `Describe a task for ${agent.name}…`)}
          onChange={(e) => setText(e.target.value)} rows={3}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && !reason) { e.preventDefault(); submit.mutate(); } }} />
        <div className="composer-foot">
          <span className="tiny muted ellipsis grow">
            {sessionId && continuable ? "Continues this session" : "New session"} · approvals: {p.approval_mode} · timeout {Math.round(p.task_timeout_s / 60)} min
          </span>
          <label className="sr-only" htmlFor="prio">Priority</label>
          <select id="prio" value={priority} onChange={(e) => setPriority(Number(e.target.value))} title="Priority">
            <option value={2}>Low priority</option><option value={5}>Normal priority</option><option value={8}>High priority</option><option value={10}>Urgent</option>
          </select>
          <span className="kbd hide-sm" aria-hidden>Ctrl ↵</span>
          <button className="btn primary sm" type="submit" disabled={!text.trim() || !!reason || submit.isPending}><Send /> {submit.isPending ? "Submitting…" : "Run"}</button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ context panel

function ContextPanel({ agent, taskId, onClose }: { agent: any; taskId: string | null; onClose: () => void }) {
  const [tab, setTab] = usePref<"activity" | "details">("ws.ctxTab", "activity");
  const task = useQuery({ queryKey: ["task", taskId], queryFn: ({ signal }) => api.get(`/api/tasks/${taskId}`, signal), enabled: !!taskId });
  const events = useQuery({ queryKey: ["task-events", taskId], queryFn: ({ signal }) => api.get(`/api/tasks/${taskId}/events?limit=2000`, signal), enabled: !!taskId, staleTime: Infinity });
  const artifacts = useQuery({ queryKey: ["artifacts", taskId], queryFn: ({ signal }) => api.get(`/api/tasks/${taskId}/artifacts`, signal), enabled: !!taskId });
  const t = task.data;
  const refs = (events.data ?? []).filter((e: ActivityEvent) => e.type === "knowledge").flatMap((e: ActivityEvent) => e.data.sources ?? []);
  const uniqRefs = Array.from(new Map(refs.map((r: any) => [`${r.source}/${r.document}`, r])).values()) as any[];
  return (
    <aside className="ctx" aria-label="Execution details">
      <div className="row" style={{ padding: "0 8px 0 0", borderBottom: "1px solid var(--border)" }}>
        <div className="grow"><Tabs label="Details panel" value={tab} onChange={setTab} tabs={[{ key: "activity", label: "Activity", count: events.data?.length }, { key: "details", label: "Details" }]} /></div>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close details panel"><PanelRightClose /></button>
      </div>
      {!taskId && <Empty title="No task selected">Select a task in the thread to inspect its execution.</Empty>}
      {taskId && tab === "activity" && (
        <div className="ctx-section" style={{ borderBottom: 0 }}>
          {t && <div className="small strong ellipsis mb8" title={t.title} style={{ marginBottom: 10 }}>{t.title}</div>}
          {events.isLoading ? <Skeleton h={120} /> : <Timeline events={events.data ?? []} compact />}
          {t?.status === "running" && <p className="tiny muted row mt8"><Dots /> Streaming live</p>}
          <p className="tiny faint mt12">Tool calls, results and outputs only. Private model reasoning is never stored or shown.</p>
        </div>
      )}
      {taskId && tab === "details" && t && (
        <>
          <section className="ctx-section">
            <h3>Task <Link className="disclose" to={`/tasks/${t.id}`}>Open</Link></h3>
            <KV items={[
              ["Status", <Status key="s" status={t.status} />],
              ["Started", t.started_at ? fullDateTime(t.started_at) : "—"],
              ["Duration", t.duration_s != null ? duration(t.duration_s) : t.started_at && t.status === "running" ? `${duration(elapsedSince(t.started_at))} so far` : "—"],
              ["Attempt", `${t.attempt + 1} of ${t.max_retries + 1}`],
              ["Requested by", t.requested_by_name ?? "—"],
              ["Task ID", <CopyId key="id" id={t.id} />],
              ["Trace ID", <span key="tr" className="mono">{shortId(t.trace_id)}</span>],
            ]} />
          </section>
          <section className="ctx-section">
            <h3>Usage</h3>
            <KV items={[
              ["Model", <span key="m" className="mono">{t.usage?.model ?? agent.config.model.model}</span>],
              ["Tokens", t.usage?.prompt_tokens != null ? `${num(t.usage.prompt_tokens)} in · ${num(t.usage.completion_tokens)} out` : "—"],
              ["Requests", num(t.usage?.requests)],
              ["Tool calls", num(t.usage?.tool_calls)],
              ["Est. cost", t.usage?.cost_usd != null ? <span key="c">{usd(t.usage.cost_usd)} <span className="tiny muted">estimate</span></span> : "Not available"],
            ]} />
          </section>
          <section className="ctx-section">
            <h3>Generated files</h3>
            {(artifacts.data ?? []).length === 0 ? <p className="small muted" style={{ margin: 0 }}>None yet.</p> : artifacts.data.map((f: any) => (
              <Link key={f.id} className="file-link" to={`/tasks/${t.id}?tab=artifacts&file=${encodeURIComponent(f.path)}`}><FileText aria-hidden /><span className="grow ellipsis mono">{f.path}</span><span className="tiny muted">{bytes(f.size)}</span></Link>
            ))}
          </section>
          {(t.approvals ?? []).length > 0 && (
            <section className="ctx-section">
              <h3>Approvals</h3>
              {t.approvals.map((x: any) => <div key={x.id} className="row small" style={{ padding: "3px 0" }}><Status status={x.status} quiet /><span className="grow ellipsis" title={x.summary}>{x.summary}</span></div>)}
            </section>
          )}
          {uniqRefs.length > 0 && (
            <section className="ctx-section">
              <h3>Knowledge references</h3>
              {uniqRefs.map((r) => <div key={`${r.source}/${r.document}`} className="small ellipsis" style={{ padding: "2px 0" }}>{r.source} / <span className="mono">{r.document}</span></div>)}
            </section>
          )}
          <section className="ctx-section">
            <h3>Agent <Link className="disclose" to={`/agents/${agent.id}/settings`}>Configure</Link></h3>
            <KV items={[
              ["Version", `v${t.agent_version}${t.agent_version !== agent.current_version ? ` (current v${agent.current_version})` : ""}`],
              ["Approvals", agent.config.policy.approval_mode],
              ["Tools", <div key="t" className="row wrap" style={{ gap: 4 }}>{agent.config.tools.map((x: string) => <Tag key={x} tone={["execute", "external", "write"].includes(TOOL_ACCESS[x]) ? "warning" : ""} title={`${TOOL_ACCESS[x] ?? "tool"} access`}>{x}</Tag>)}</div>],
              ["Knowledge", `${agent.config.knowledge_sources.length} source(s)`],
              ["Integrations", `${agent.config.integrations.length}`],
            ]} />
          </section>
        </>
      )}
    </aside>
  );
}

function CopyId({ id }: { id: string }) {
  const toast = useToast();
  return (
    <button className="disclose mono" onClick={() => navigator.clipboard?.writeText(id).then(() => toast("ok", "Task ID copied"))} aria-label="Copy task ID">
      {shortId(id)} <Copy size={11} />
    </button>
  );
}


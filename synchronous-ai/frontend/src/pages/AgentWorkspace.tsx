import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  FileStack,
  History,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Power,
  RotateCcw,
  ScrollText,
  Send,
  Settings2,
  Square,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Config,
  Identity,
  IdentitySection,
  KnowledgeSection,
  ModelSection,
  PolicySection,
  RoleSection,
  ToolsSection,
} from "../components/AgentForm";
import { FilesBrowser } from "../components/FilesBrowser";
import { Shell, useLive } from "../components/Shell";
import { Timeline } from "../components/Timeline";
import { AgentAvatar, Empty, ErrorBox, KV, Loading, Notice, Pager, StatusBadge, Tabs, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { dateTime, duration, num, timeAgo, usd } from "../lib/format";
import { useSession } from "../lib/session";
import { ActivityEvent, useActivityStream } from "../lib/stream";

type Tab = "overview" | "chat" | "activity" | "history" | "files" | "settings" | "logs";

export default function AgentWorkspace() {
  const { agentId = "", tab = "overview" } = useParams();
  const nav = useNavigate();
  const { markSeen } = useLive();
  const agent = useQuery({ queryKey: ["agents", agentId], queryFn: () => api.get(`/api/agents/${agentId}`), refetchInterval: 8000 });
  useEffect(() => markSeen(agentId), [agentId, markSeen, agent.dataUpdatedAt]);
  const a = agent.data;
  const tabs: { key: Tab; label: string; icon: any; count?: number }[] = [
    { key: "overview", label: "Overview", icon: LayoutDashboard },
    { key: "chat", label: "Chat & tasks", icon: MessageSquare, count: (a?.task_counts?.running ?? 0) + (a?.task_counts?.queued ?? 0) },
    { key: "activity", label: "Live activity", icon: Activity },
    { key: "history", label: "Task history", icon: History },
    { key: "files", label: "Files & artifacts", icon: FileStack },
    { key: "settings", label: "Tools & settings", icon: Settings2 },
    { key: "logs", label: "Logs & traces", icon: ScrollText },
  ];
  return (
    <Shell crumbs={<span><Link to="/agents">My Agents</Link> / {a?.name ?? "…"}</span>}>
      {agent.isLoading && <Loading />}
      <ErrorBox error={agent.error} title="Agent unavailable" />
      {a && (
        <>
          <div className="page-head">
            <div className="row" style={{ alignItems: "flex-start", gap: 14 }}>
              <AgentAvatar avatar={a.avatar} size="lg" status={a.live_status} />
              <div>
                <div className="row"><h1 style={{ margin: 0 }}>{a.name}</h1><StatusBadge status={a.live_status} /></div>
                <p className="small">{a.category} · v{a.current_version} · owner {a.owner?.name ?? "—"}{a.team ? ` · team ${a.team.name}` : ""}</p>
              </div>
            </div>
            <AgentActions a={a} />
          </div>
          <Tabs tabs={tabs} value={tab as Tab} onChange={(t) => nav(`/agents/${agentId}/${t === "overview" ? "" : t}`)} />
          {tab === "overview" && <OverviewTab a={a} />}
          {tab === "chat" && <ChatTab a={a} />}
          {tab === "activity" && <ActivityTab a={a} />}
          {tab === "history" && <HistoryTab a={a} />}
          {tab === "files" && <FilesTab a={a} />}
          {tab === "settings" && <SettingsTab a={a} />}
          {tab === "logs" && <LogsTab a={a} />}
        </>
      )}
    </Shell>
  );
}

function AgentActions({ a }: { a: any }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const setStatus = useMutation({
    mutationFn: (status: string) => api.post(`/api/agents/${a.id}/status`, { status }),
    onSuccess: (_, s) => { qc.invalidateQueries({ queryKey: ["agents"] }); toast("ok", `Agent ${s === "active" ? "activated" : s}`); },
    onError: (e: any) => toast("error", e.message),
  });
  return (
    <div className="row">
      {can("tasks:create") && a.status === "active" && <button className="btn primary" onClick={() => nav(`/agents/${a.id}/chat`)}><Send /> Assign task</button>}
      {can("agents:write") && a.status !== "active" && <button className="btn success" onClick={() => setStatus.mutate("active")}><Power /> Activate</button>}
      {can("agents:write") && a.status === "active" && <button className="btn ghost" onClick={() => confirm("Disable this agent? Queued tasks will not start.") && setStatus.mutate("disabled")}><Power /> Disable</button>}
    </div>
  );
}

// ------------------------------------------------------------------ overview

function OverviewTab({ a }: { a: any }) {
  const c = a.config;
  const tasks = useQuery({ queryKey: ["tasks", { agent_id: a.id, recent: true }], queryFn: () => api.get(`/api/tasks?agent_id=${a.id}&page_size=8&top_level=true`), refetchInterval: 8000 });
  const nav = useNavigate();
  return (
    <div className="split">
      <div className="stack">
        <div className="card">
          <div className="card-title">Purpose</div>
          <p className="muted" style={{ marginTop: 0 }}>{a.description || "No description."}</p>
          <KV items={[["Role", c.role || "—"], ["Objective", c.objective || "—"], ["Expected outputs", c.expected_outputs || "—"], ["Completion criteria", c.completion_criteria || "—"]]} />
        </div>
        <div className="card flush">
          <div className="card-head"><b>Recent tasks</b><Link className="btn xs ghost" to={`/agents/${a.id}/history`}>All</Link></div>
          {tasks.data?.items?.length === 0 && <Empty title="No tasks yet">Use “Assign task” to give this agent its first assignment.</Empty>}
          <table className="table"><tbody>
            {tasks.data?.items?.map((t: any) => (
              <tr key={t.id} className="click" onClick={() => nav(`/tasks/${t.id}`)}>
                <td><StatusBadge status={t.status} /></td><td className="ellipsis" style={{ maxWidth: 380 }}>{t.title}</td>
                <td className="faint small nowrap">{timeAgo(t.created_at)}</td><td className="faint small">{duration(t.duration_s)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </div>
      <div className="stack">
        <div className="card">
          <div className="card-title">Configuration</div>
          <KV items={[
            ["Model", <span key="m">{c.model.model}<div className="faint tiny">{a.provider?.name} · {a.provider?.status}</div></span>],
            ["Fallback", c.model.fallback_model ?? "none"],
            ["Tools", <div key="t" className="pill-list">{c.tools.map((t: string) => <span key={t} className="badge outline">{t}</span>)}</div>],
            ["Integrations", String(c.integrations.length)],
            ["Knowledge", String(c.knowledge_sources.length) + " sources"],
            ["Approvals", c.policy.approval_mode],
            ["Concurrency", `${c.policy.max_concurrent_tasks} parallel tasks`],
            ["Timeout", `${c.policy.task_timeout_s}s · ${c.policy.max_retries} retries`],
            ["Budget", `${c.policy.budget_usd_per_task != null ? usd(c.policy.budget_usd_per_task) : "∞"}/task · ${c.policy.budget_usd_monthly != null ? usd(c.policy.budget_usd_monthly) : "∞"}/month`],
          ]} />
        </div>
        <div className="card">
          <div className="card-title">Task totals</div>
          <div className="grid cols-2" style={{ gap: 8 }}>
            {["running", "queued", "waiting_for_approval", "completed", "failed", "cancelled"].map((s) => (
              <div key={s} className="row small"><StatusBadge status={s} /><b>{a.task_counts?.[s] ?? 0}</b></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ chat & tasks

function ChatTab({ a }: { a: any }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const sessions = useQuery({ queryKey: ["sessions", a.id], queryFn: () => api.get(`/api/sessions?agent_id=${a.id}&page_size=30`), refetchInterval: 10000 });
  const [sessionId, setSessionId] = useState<string>("");
  const [text, setText] = useState("");
  const [priority, setPriority] = useState(5);
  const tasks = useQuery({
    queryKey: ["tasks", { session: sessionId, agent: a.id }],
    queryFn: () => api.get(`/api/tasks${qs({ agent_id: a.id, session_id: sessionId, page_size: 50, top_level: true })}`),
    refetchInterval: 4000,
  });
  const endRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => [...(tasks.data?.items ?? [])].reverse(), [tasks.data]);
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [items.length]);
  useActivityStream(() => qc.invalidateQueries({ queryKey: ["tasks", { session: sessionId, agent: a.id }] }), { agentId: a.id });

  const submit = useMutation({
    mutationFn: () => api.post(`/api/agents/${a.id}/tasks`, { instructions: text, priority, session_id: sessionId || null }, { "Idempotency-Key": crypto.randomUUID() }),
    onSuccess: (t) => { setText(""); qc.invalidateQueries({ queryKey: ["tasks"] }); toast("ok", "Task queued"); if (!sessionId && t.session_id) setSessionId(t.session_id); },
    onError: (e: any) => toast("error", e.message),
  });
  const cancel = useMutation({ mutationFn: (id: string) => api.post(`/api/tasks/${id}/cancel`), onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }), onError: (e: any) => toast("error", e.message) });
  const retry = useMutation({ mutationFn: (id: string) => api.post(`/api/tasks/${id}/retry`), onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }), onError: (e: any) => toast("error", e.message) });
  const current = sessions.data?.items?.find((s: any) => s.id === sessionId);
  const sessionBusy = current?.active;

  return (
    <div className="grid" style={{ gridTemplateColumns: "260px minmax(0,1fr)", alignItems: "start" }}>
      <div className="card" style={{ padding: 10 }}>
        <button className={`btn block ${!sessionId ? "primary" : ""}`} onClick={() => setSessionId("")}><Plus /> New session</button>
        <div className="section-title mt16" style={{ padding: "0 4px" }}>Execution sessions</div>
        {sessions.data?.items?.length === 0 && <div className="faint small" style={{ padding: 6 }}>Each task starts a session; follow-ups can continue one.</div>}
        <div className="stack" style={{ gap: 2 }}>
          {sessions.data?.items?.map((s: any) => (
            <button key={s.id} className={`step ${s.id === sessionId ? "on" : ""}`} onClick={() => setSessionId(s.id)} style={{ alignItems: "flex-start" }}>
              <span className={`status-dot ${s.active ? "running" : s.status === "active" ? "completed" : "disabled"}`} style={{ marginTop: 6 }} />
              <span className="grow" style={{ minWidth: 0 }}>
                <div className="small strong ellipsis">{s.title || "Session"}</div>
                <div className="faint tiny">{s.task_count} task(s) · {timeAgo(s.last_active_at)}{!s.continuable ? " · closed" : ""}</div>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <Notice>
          {sessionId ? (current?.continuable ? "Follow-up tasks continue this session: same workspace files and conversation memory." : "This session is closed (Docker sandboxes are removed after each run). Start a new session to continue.")
            : "A new task starts a fresh execution session with its own workspace. The agent profile (instructions, tools, policies) is shared across sessions."}
        </Notice>
        <div className="chat mt16" style={{ minHeight: 200 }}>
          {!sessionId && items.length > 0 && <div className="faint tiny">Showing recent tasks across all sessions.</div>}
          {items.length === 0 && <div className="faint small">No tasks in this view yet.</div>}
          {items.map((t: any) => (
            <div key={t.id} className="stack" style={{ gap: 8 }}>
              <div className="bubble user">
                <div className="who">Task · {timeAgo(t.created_at)} · priority {t.priority}</div>
                <div className="md">{t.title}</div>
              </div>
              <div className="bubble agent">
                <div className="who">
                  <StatusBadge status={t.status} /> {a.name}
                  {t.duration_s != null && <span>· {duration(t.duration_s)}</span>}
                  {t.usage?.prompt_tokens ? <span>· {num((t.usage.prompt_tokens ?? 0) + (t.usage.completion_tokens ?? 0))} tokens</span> : null}
                  <Link to={`/tasks/${t.id}`} className="btn xs ghost">details</Link>
                  {["queued", "running", "waiting_for_approval"].includes(t.status) && can("tasks:cancel") && (
                    <button className="btn xs danger" onClick={() => cancel.mutate(t.id)}><Square /> Cancel</button>
                  )}
                  {["failed", "timed_out", "cancelled"].includes(t.status) && can("tasks:create") && (
                    <button className="btn xs" onClick={() => retry.mutate(t.id)}><RotateCcw /> Retry</button>
                  )}
                </div>
                <TaskResult t={t} onOpen={() => nav(`/tasks/${t.id}`)} />
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {can("tasks:create") ? (
          <div className="composer mt16">
            <textarea value={text} placeholder={a.status !== "active" ? "Activate the agent to assign tasks." : sessionId ? "Follow-up instructions for this session…" : "Describe a task for this agent…"}
              disabled={a.status !== "active"} onChange={(e) => setText(e.target.value)} aria-label="Task instructions"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) submit.mutate(); }} />
            <div className="row between">
              <label className="row small faint">Priority
                <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} style={{ width: 140, height: 30 }}>
                  {[1, 3, 5, 7, 9, 10].map((p) => <option key={p} value={p}>{p}{p === 5 ? " (normal)" : p >= 9 ? " (high)" : p <= 3 ? " (low)" : ""}</option>)}
                </select>
              </label>
              <div className="row">
                <span className="faint tiny">Ctrl/⌘ + Enter</span>
                <button className="btn primary" disabled={!text.trim() || submit.isPending || a.status !== "active" || (!!sessionId && (sessionBusy || !current?.continuable))} onClick={() => submit.mutate()}>
                  <Send /> {sessionId ? "Send follow-up" : "Start task"}
                </button>
              </div>
            </div>
          </div>
        ) : <Notice>Your role can view this agent but not assign tasks.</Notice>}
      </div>
    </div>
  );
}

function TaskResult({ t, onOpen }: { t: any; onOpen: () => void }) {
  const detail = useQuery({ queryKey: ["task", t.id], queryFn: () => api.get(`/api/tasks/${t.id}`), enabled: ["completed", "failed", "timed_out", "cancelled"].includes(t.status) });
  if (t.status === "queued") return <div className="faint small">Waiting for a worker…</div>;
  if (t.status === "running") return <div className="row small muted"><span className="spinner" /> Working… <button className="btn xs ghost" onClick={onOpen}>watch live</button></div>;
  if (t.status === "waiting_for_approval") return <div className="small"><Link to="/approvals" className="badge waiting_for_approval">Action awaiting human approval →</Link></div>;
  if (t.error && t.status !== "completed") return <div className="error-text small">{t.error.message}</div>;
  return <div className="md small">{detail.data?.result_summary || "…"}</div>;
}

// ------------------------------------------------------------------ live activity

function ActivityTab({ a }: { a: any }) {
  const initial = useQuery({ queryKey: ["agent-events", a.id], queryFn: () => api.get(`/api/agents/${a.id}/events?limit=200`) });
  const [live, setLive] = useState<ActivityEvent[]>([]);
  const [paused, setPaused] = useState(false);
  useActivityStream((e) => !paused && setLive((l) => (l.some((x) => x.id === e.id) ? l : [...l, e].slice(-500))), { agentId: a.id });
  const events = useMemo(() => {
    const seen = new Set<number>();
    return [...(initial.data ?? []), ...live].filter((e) => !seen.has(e.id) && seen.add(e.id)).reverse();
  }, [initial.data, live]);
  return (
    <div className="card">
      <div className="row between mb16">
        <div className="row small muted"><span className={`status-dot ${paused ? "disabled" : "running"}`} /> {paused ? "Stream paused" : "Streaming live events"}</div>
        <button className="btn sm" onClick={() => setPaused(!paused)}>{paused ? "Resume" : "Pause"}</button>
      </div>
      {initial.isLoading ? <Loading /> : <Timeline events={events} />}
      <p className="faint tiny mt16">Shows tool calls, results, approvals, errors and outputs. Hidden model reasoning is never stored or displayed.</p>
    </div>
  );
}

// ------------------------------------------------------------------ history

function HistoryTab({ a }: { a: any }) {
  const nav = useNavigate();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const tasks = useQuery({ queryKey: ["tasks", { agent: a.id, status, page }], queryFn: () => api.get(`/api/tasks${qs({ agent_id: a.id, status, page, page_size: 25 })}`), refetchInterval: 8000 });
  return (
    <div className="card flush">
      <div className="card-head">
        <b>Task history</b>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={{ width: 200 }} aria-label="Status filter">
          <option value="">All statuses</option>
          {["active", "queued", "running", "waiting_for_approval", "completed", "failed", "timed_out", "cancelled"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      <TaskTable items={tasks.data?.items ?? []} onOpen={(id) => nav(`/tasks/${id}`)} />
      {tasks.data && <Pager page={page} pageSize={25} total={tasks.data.total} onPage={setPage} />}
    </div>
  );
}

export function TaskTable({ items, onOpen, showAgent }: { items: any[]; onOpen: (id: string) => void; showAgent?: boolean }) {
  if (!items.length) return <Empty title="No tasks">Nothing matches this view.</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Task</th>{showAgent && <th>Agent</th>}<th>Status</th><th>Started</th><th>Duration</th><th>Tokens</th><th>Est. cost</th><th>Attempt</th></tr></thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="click" onClick={() => onOpen(t.id)}>
              <td style={{ maxWidth: 380 }}>
                <div className="ellipsis strong small">{t.title}</div>
                <div className="faint tiny mono">{t.id.slice(0, 12)}{t.parent_task_id ? " · delegated" : ""}{t.schedule_id ? " · scheduled" : ""}</div>
              </td>
              {showAgent && <td className="small nowrap">{t.agent_name}</td>}
              <td><StatusBadge status={t.status} /></td>
              <td className="faint small nowrap">{dateTime(t.started_at)}</td>
              <td className="small">{duration(t.duration_s)}</td>
              <td className="small">{t.usage?.prompt_tokens != null ? num((t.usage.prompt_tokens ?? 0) + (t.usage.completion_tokens ?? 0)) : "—"}</td>
              <td className="small">{t.usage?.cost_usd != null ? usd(t.usage.cost_usd) : "—"}</td>
              <td className="small">{t.attempt + 1}/{t.max_retries + 1}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ files

function FilesTab({ a }: { a: any }) {
  const sessions = useQuery({ queryKey: ["sessions", a.id], queryFn: () => api.get(`/api/sessions?agent_id=${a.id}&page_size=50`) });
  const [sid, setSid] = useState("");
  const list = sessions.data?.items ?? [];
  const active = sid || list[0]?.id;
  if (sessions.isLoading) return <Loading />;
  if (!list.length) return <div className="card"><Empty title="No workspaces yet">Each execution session gets an isolated workspace. Files appear after the first task.</Empty></div>;
  return (
    <div className="card flush">
      <div className="card-head">
        <b>Workspace files</b>
        <select value={active} onChange={(e) => setSid(e.target.value)} style={{ width: 360 }} aria-label="Session">
          {list.map((s: any) => <option key={s.id} value={s.id}>{s.title || s.id} — {timeAgo(s.last_active_at)}</option>)}
        </select>
      </div>
      {active && <FilesBrowser sessionId={active} />}
    </div>
  );
}

// ------------------------------------------------------------------ settings

function SettingsTab({ a }: { a: any }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [identity, setIdentity] = useState<Identity>({ name: a.name, description: a.description, category: a.category, avatar: a.avatar, team_id: a.team_id, tags: a.tags });
  const [config, setConfig] = useState<Config>(a.config);
  const [note, setNote] = useState("");
  const [section, setSection] = useState("identity");
  const versions = useQuery({ queryKey: ["versions", a.id], queryFn: () => api.get(`/api/agents/${a.id}/versions`) });
  const save = useMutation({
    mutationFn: () => api.put(`/api/agents/${a.id}`, { identity, config, change_note: note }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["agents"] }); qc.invalidateQueries({ queryKey: ["versions", a.id] }); setNote(""); toast("ok", `Saved — now version ${r.current_version}. Applies to new tasks.`); },
    onError: (e: any) => toast("error", e.message),
  });
  const editable = can("agents:write");
  const sections: [string, string][] = [["identity", "Identity"], ["role", "Role & instructions"], ["model", "Model"], ["tools", "Tools & integrations"], ["knowledge", "Knowledge"], ["policy", "Policies"], ["versions", "Version history"]];
  return (
    <div className="wizard">
      <div className="card" style={{ padding: 10 }}>
        <div className="steps">
          {sections.map(([k, l]) => <button key={k} className={`step ${section === k ? "on" : ""}`} onClick={() => setSection(k)}>{l}</button>)}
        </div>
      </div>
      <div className="card">
        {!editable && <div className="mb16"><Notice>Read-only: your role cannot change agent configuration.</Notice></div>}
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
          {section === "identity" && <IdentitySection value={identity} onChange={setIdentity} />}
          {section === "role" && <RoleSection value={config} onChange={setConfig} />}
          {section === "model" && <ModelSection value={config} onChange={setConfig} />}
          {section === "tools" && <ToolsSection value={config} onChange={setConfig} />}
          {section === "knowledge" && <KnowledgeSection value={config} onChange={setConfig} />}
          {section === "policy" && <PolicySection value={config} onChange={setConfig} agentId={a.id} />}
        </fieldset>
        {section === "versions" && (
          <table className="table">
            <thead><tr><th>Version</th><th>Change note</th><th>Created</th><th>Model</th><th>Tools</th></tr></thead>
            <tbody>{(versions.data ?? []).map((v: any) => (
              <tr key={v.version}><td>v{v.version}{v.version === a.current_version && <span className="badge accent" style={{ marginLeft: 6 }}>current</span>}</td>
                <td className="small">{v.change_note || "—"}</td><td className="faint small">{dateTime(v.created_at)}</td><td className="small">{v.config.model.model}</td><td className="small">{v.config.tools.join(", ")}</td></tr>
            ))}</tbody>
          </table>
        )}
        {editable && section !== "versions" && (
          <div className="row mt24" style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <input placeholder="Change note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            <button className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>Save changes</button>
          </div>
        )}
        {editable && <p className="faint tiny">Saving creates a new immutable version. Running tasks keep the version they started with.</p>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ logs

function LogsTab({ a }: { a: any }) {
  const [type, setType] = useState("");
  const events = useQuery({ queryKey: ["agent-events", a.id, "logs"], queryFn: () => api.get(`/api/agents/${a.id}/events?limit=500`), refetchInterval: 10000 });
  const tasks = useQuery({ queryKey: ["tasks", { agent: a.id, logs: true }], queryFn: () => api.get(`/api/tasks?agent_id=${a.id}&page_size=200`) });
  const trace: Record<string, string> = Object.fromEntries((tasks.data?.items ?? []).map((t: any) => [t.id, t.trace_id]));
  const rows = (events.data ?? []).filter((e: any) => !type || e.type === type).slice().reverse();
  const types = Array.from(new Set((events.data ?? []).map((e: any) => e.type))) as string[];
  return (
    <div className="card flush">
      <div className="card-head">
        <b>Structured execution log</b>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 200 }} aria-label="Event type">
          <option value="">All event types</option>
          {types.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <div className="table-wrap" style={{ maxHeight: 640 }}>
        <table className="table">
          <thead><tr><th>Time</th><th>Type</th><th>Task / trace</th><th>Summary</th></tr></thead>
          <tbody>
            {rows.map((e: any) => (
              <tr key={e.id}>
                <td className="mono tiny nowrap">{new Date(e.ts).toISOString().replace("T", " ").slice(0, 19)}</td>
                <td><span className="badge outline">{e.type}</span></td>
                <td className="mono tiny"><Link to={`/tasks/${e.task_id}`}>{e.task_id.slice(0, 10)}</Link><div className="faint">{trace[e.task_id]?.slice(0, 10) ?? ""}</div></td>
                <td className="small" style={{ maxWidth: 640, wordBreak: "break-word" }}>{e.summary}{e.data?.tool ? <span className="faint"> · {e.data.tool}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pager">Credentials are redacted before events are stored. Correlate with server logs using the trace id.</div>
    </div>
  );
}

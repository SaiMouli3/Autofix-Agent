import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, FileStack, GitBranch, Info, RotateCcw, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FilesBrowser } from "../components/FilesBrowser";
import { Shell } from "../components/Shell";
import { Timeline } from "../components/Timeline";
import { ErrorBox, KV, Loading, Notice, StatusBadge, Tabs, useToast } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, duration, num, usd } from "../lib/format";
import { useSession } from "../lib/session";
import { ActivityEvent, useActivityStream } from "../lib/stream";

export default function TaskDetail() {
  const { taskId = "" } = useParams();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState<"activity" | "result" | "files" | "delegation">((sp.get("tab") as any) || "activity");
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { can } = useSession();
  const task = useQuery({ queryKey: ["task", taskId], queryFn: () => api.get(`/api/tasks/${taskId}`), refetchInterval: (q) => (["completed", "failed", "cancelled", "timed_out"].includes((q.state.data as any)?.status) ? false : 3000) });
  const initial = useQuery({ queryKey: ["task-events", taskId], queryFn: () => api.get(`/api/tasks/${taskId}/events?limit=2000`) });
  const artifacts = useQuery({ queryKey: ["artifacts", taskId], queryFn: () => api.get(`/api/tasks/${taskId}/artifacts`), refetchInterval: 10000 });
  const [live, setLive] = useState<ActivityEvent[]>([]);
  useActivityStream((e) => { setLive((l) => [...l, e]); if (e.type === "status") qc.invalidateQueries({ queryKey: ["task", taskId] }); }, { taskId });
  const events = useMemo(() => {
    const seen = new Set<number>();
    return [...(initial.data ?? []), ...live].filter((e) => !seen.has(e.id) && seen.add(e.id));
  }, [initial.data, live]);
  const cancel = useMutation({ mutationFn: () => api.post(`/api/tasks/${taskId}/cancel`), onSuccess: () => { toast("ok", "Cancellation requested"); qc.invalidateQueries({ queryKey: ["task", taskId] }); }, onError: (e: any) => toast("error", e.message) });
  const retry = useMutation({ mutationFn: () => api.post(`/api/tasks/${taskId}/retry`), onSuccess: (t) => { toast("ok", "Retry queued"); nav(`/tasks/${t.id}`); }, onError: (e: any) => toast("error", e.message) });
  const t = task.data;
  return (
    <Shell crumbs={<span><Link to="/tasks">Tasks</Link> / {taskId.slice(0, 10)}</span>}>
      {task.isLoading && <Loading />}
      <ErrorBox error={task.error} title="Task unavailable" />
      {t && (
        <>
          <div className="page-head">
            <div>
              <div className="row"><h1 style={{ margin: 0 }}>{t.title}</h1><StatusBadge status={t.status} /></div>
              <p className="small">Assigned to <Link to={`/agents/${t.agent_id}`} style={{ color: "var(--accent)" }}>{t.agent_name}</Link> (v{t.agent_version}) · requested by {t.requested_by_name ?? (t.requested_by_agent_id ? "another agent" : "system")} · {dateTime(t.created_at)}</p>
            </div>
            <div className="row">
              {["queued", "running", "waiting_for_approval"].includes(t.status) && can("tasks:cancel") && <button className="btn danger" onClick={() => cancel.mutate()} disabled={t.cancel_requested}><Square /> {t.cancel_requested ? "Cancelling…" : "Cancel"}</button>}
              {["failed", "timed_out", "cancelled"].includes(t.status) && can("tasks:create") && <button className="btn" onClick={() => retry.mutate()}><RotateCcw /> Retry</button>}
            </div>
          </div>
          {t.error && t.status !== "completed" && <div className="mb16"><Notice kind={t.status === "queued" ? "warn" : "error"}><b>{t.error.code}</b>: {t.error.message}{t.status === "queued" && " — a retry is scheduled."}</Notice></div>}
          <div className="split">
            <div>
              <Tabs value={tab} onChange={setTab} tabs={[
                { key: "activity", label: "Live activity", icon: Activity, count: events.length },
                { key: "result", label: "Result", icon: Info },
                { key: "files", label: "Artifacts", icon: FileStack, count: artifacts.data?.length },
                { key: "delegation", label: "Delegation", icon: GitBranch, count: t.children.length },
              ]} />
              {tab === "activity" && <div className="card"><Timeline events={events} /></div>}
              {tab === "result" && (
                <div className="card">
                  <div className="section-title">Instructions</div>
                  <pre className="block">{t.instructions}</pre>
                  <div className="section-title mt16">Result</div>
                  {t.result_summary ? <div className="md">{t.result_summary}</div> : <div className="faint">No result yet.</div>}
                </div>
              )}
              {tab === "files" && (
                <div className="card flush">
                  {t.session_id ? <FilesBrowser sessionId={t.session_id} highlight={(artifacts.data ?? []).map((a: any) => a.path)} /> : <div className="card-body faint">The workspace is created when execution starts.</div>}
                </div>
              )}
              {tab === "delegation" && (
                <div className="card">
                  {t.parent_task_id && <p className="small">This task was delegated by <Link to={`/tasks/${t.parent_task_id}`} style={{ color: "var(--accent)" }}>parent task</Link> (depth {t.delegation_depth}).</p>}
                  {t.children.length === 0 && <div className="faint small">No sub-tasks were delegated.</div>}
                  {t.children.map((c: any) => (
                    <Link key={c.delegation_id} to={`/tasks/${c.child_task_id}`} className="row card hover" style={{ marginBottom: 8, padding: 12 }}>
                      <GitBranch size={16} /><span className="grow small">{c.objective}</span><StatusBadge status={c.status} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="stack">
              <div className="card">
                <div className="card-title">Execution</div>
                <KV items={[
                  ["Status", <StatusBadge key="s" status={t.status} />],
                  ["Started", dateTime(t.started_at)], ["Finished", dateTime(t.finished_at)], ["Duration", duration(t.duration_s)],
                  ["Attempt", `${t.attempt + 1} of ${t.max_retries + 1}`], ["Priority", String(t.priority)],
                  ["Session", t.session_id ? <span key="x" className="mono tiny">{t.session_id.slice(0, 12)}</span> : "—"],
                  ["Trace id", <span key="tr" className="mono tiny">{t.trace_id}</span>],
                ]} />
              </div>
              <div className="card">
                <div className="card-title">Usage</div>
                <KV items={[
                  ["Model", t.usage.model ?? "—"],
                  ["Prompt tokens", num(t.usage.prompt_tokens)], ["Completion tokens", num(t.usage.completion_tokens)],
                  ["Model requests", num(t.usage.requests)], ["Tool calls", num(t.usage.tool_calls)],
                  ["Est. cost", t.usage.cost_usd != null ? usd(t.usage.cost_usd) : "not available"],
                ]} />
                {t.usage.cost_source && <div className="faint tiny mt8">{t.usage.cost_source}</div>}
              </div>
              {t.approvals.length > 0 && (
                <div className="card">
                  <div className="card-title">Approvals</div>
                  {t.approvals.map((a: any) => (
                    <div key={a.id} className="row small" style={{ padding: "4px 0" }}><StatusBadge status={a.status} /><span className="grow ellipsis">{a.summary}</span></div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

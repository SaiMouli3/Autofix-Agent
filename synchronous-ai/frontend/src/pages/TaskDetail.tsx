import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, GitBranch, RotateCcw } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BotMark } from "../components/BotMark";
import { FilesBrowser } from "../components/FilesBrowser";
import { AttachmentList } from "../components/Attachments";
import { Markdown } from "../components/Markdown";
import { Shell } from "../components/Shell";
import { Timeline } from "../components/Timeline";
import { Alert, Dots, Empty, ErrorState, KV, Skeleton, Status, Tabs, useConfirm, useToast } from "../components/ui";
import { api } from "../lib/api";
import { duration, elapsedSince, fullDateTime, num, shortId, usd } from "../lib/format";
import { useSession } from "../lib/session";
import { ACTIVE_TASK_STATES, FAILURE } from "../lib/status";
import { ActivityEvent, useActivityStream } from "../lib/stream";

type Tab = "activity" | "result" | "artifacts" | "approvals" | "delegation";

export default function TaskDetail() {
  const { taskId = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "activity";
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const { can } = useSession();
  const task = useQuery({ queryKey: ["task", taskId], queryFn: ({ signal }) => api.get(`/api/tasks/${taskId}`, signal), refetchInterval: (q) => (ACTIVE_TASK_STATES.includes((q.state.data as any)?.status) ? 3000 : false) });
  const events = useQuery({ queryKey: ["task-events", taskId], queryFn: ({ signal }) => api.get(`/api/tasks/${taskId}/events?limit=2000`, signal), staleTime: Infinity });
  const artifacts = useQuery({ queryKey: ["artifacts", taskId], queryFn: ({ signal }) => api.get(`/api/tasks/${taskId}/artifacts`, signal), refetchInterval: 15000 });
  const agent = useQuery({ queryKey: ["agents", task.data?.agent_id], queryFn: ({ signal }) => api.get(`/api/agents/${task.data.agent_id}`, signal), enabled: !!task.data?.agent_id });
  useActivityStream((e: ActivityEvent) => {
    qc.setQueryData<ActivityEvent[]>(["task-events", taskId], (old) => (old && !old.some((x) => x.id === e.id) ? [...old, e] : old));
    if (e.type === "status" || e.type === "approval") qc.invalidateQueries({ queryKey: ["task", taskId] });
    if (e.type === "artifact") qc.invalidateQueries({ queryKey: ["artifacts", taskId] });
  }, { taskId }, !!task.data && ACTIVE_TASK_STATES.includes(task.data.status));
  const cancel = useMutation({ mutationFn: () => api.post(`/api/tasks/${taskId}/cancel`), onSuccess: () => { toast("ok", "Cancellation requested"); qc.invalidateQueries({ queryKey: ["task", taskId] }); }, onError: (e: any) => toast("error", e.message) });
  const retry = useMutation({ mutationFn: () => api.post(`/api/tasks/${taskId}/retry`), onSuccess: (t) => { toast("ok", "Resubmitted as a new task"); nav(`/tasks/${t.id}`); }, onError: (e: any) => toast("error", e.message) });
  const setTab = (t: Tab) => { const n = new URLSearchParams(sp); n.set("tab", t); n.delete("file"); setSp(n, { replace: true }); };

  if (task.isLoading) return <Shell crumbs={[{ label: "Tasks", to: "/tasks" }, { label: "…" }]}><Skeleton h={60} /><Skeleton h={300} style={{ marginTop: 16 }} /></Shell>;
  if (task.isError) return <Shell crumbs={[{ label: "Tasks", to: "/tasks" }, { label: "Unavailable" }]}><ErrorState error={task.error} what="this task" /></Shell>;
  const t = task.data;
  const active = ACTIVE_TASK_STATES.includes(t.status);
  const f = t.error_category && t.status !== "completed" ? FAILURE[t.error_category] ?? FAILURE.runtime : null;
  return (
    <Shell crumbs={[{ label: "Tasks", to: "/tasks" }, { label: t.title }]}>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 10 }}><h1 className="ellipsis" style={{ maxWidth: 820 }}>{t.title}</h1><Status status={t.status} /></div>
          <p className="row" style={{ gap: 6 }}>
            {agent.data && <BotMark seed={agent.data.id} avatar={agent.data.avatar} size={18} />}
            <Link to={`/agents/${t.agent_id}?task=${t.id}`} style={{ color: "var(--accent)" }}>{t.agent_name}</Link>
            <span>· v{t.agent_version} · requested by {t.requested_by_name ?? (t.requested_by_agent_id ? "another agent" : t.schedule_id ? "a schedule" : "system")} · {fullDateTime(t.created_at)}</span>
          </p>
        </div>
        <div className="row">
          {active && can("tasks:cancel") && <button className="btn danger" disabled={t.cancel_requested} onClick={async () => {
            if (await confirm({ title: "Cancel this execution?", body: "The agent stops at its next step. Files already written stay in the workspace.", confirmLabel: "Cancel execution", danger: true })) cancel.mutate();
          }}><Ban /> {t.cancel_requested ? "Cancelling…" : "Cancel"}</button>}
          {!active && t.status !== "completed" && can("tasks:create") && <button className="btn" onClick={() => retry.mutate()} disabled={retry.isPending}><RotateCcw /> Retry</button>}
          {t.status === "completed" && can("tasks:create") && <button className="btn" onClick={async () => { if (await confirm({ title: "Run this task again?", body: "A new task with the same instructions will be queued for the same agent.", confirmLabel: "Resubmit" })) retry.mutate(); }}><RotateCcw /> Resubmit</button>}
          <Link className="btn dark" to={`/agents/${t.agent_id}?task=${t.id}`}>Open in workspace</Link>
        </div>
      </div>
      {f && (
        <div style={{ marginBottom: 16 }}>
          <Alert kind={t.status === "queued" ? "warn" : t.status === "cancelled" ? "neutral" : "error"}>
            <b>{t.status === "queued" ? "Retry scheduled after a " + f.label.toLowerCase() : f.label}.</b> <span className="mono" style={{ fontSize: 12 }}>{String(t.error?.message ?? "").slice(0, 400)}</span>
            <div className="tiny mt4">{f.next}</div>
          </Alert>
        </div>
      )}
      <div className="split">
        <div style={{ minWidth: 0 }}>
          <Tabs label="Task sections" value={tab} onChange={setTab} tabs={[
            { key: "activity", label: "Activity", count: events.data?.length },
            { key: "result", label: "Instructions & result" },
            { key: "artifacts", label: "Artifacts", count: artifacts.data?.length },
            { key: "approvals", label: "Approvals", count: t.approvals.length },
            { key: "delegation", label: "Delegation", count: t.children.length },
          ]} />
          <div className="panel mt12">
            {tab === "activity" && (
              <div className="panel-body">
                {events.isLoading ? <Skeleton h={200} /> : <Timeline events={events.data ?? []} />}
                {t.status === "running" && <p className="small row mt12" style={{ color: "var(--info)" }}><Dots /> Live — new events appear as they happen</p>}
              </div>
            )}
            {tab === "result" && (
              <div className="panel-body stack">
                <div><div className="section-title">Instructions</div><div className="prose">{t.instructions}</div>
                  {t.attachments?.length > 0 && <><div className="section-title mt12">Attachments</div><AttachmentList items={t.attachments} /></>}</div>
                <div><div className="section-title">Result</div>{t.result_summary ? <Markdown>{t.result_summary}</Markdown> : <p className="muted small">{active ? "The agent is still working." : "No written result."}</p>}</div>
              </div>
            )}
            {tab === "artifacts" && (t.session_id ? <FilesBrowser sessionId={t.session_id} highlight={(artifacts.data ?? []).map((a: any) => a.path)} initial={sp.get("file")} /> : <Empty title="No workspace yet">The workspace is created when execution starts.</Empty>)}
            {tab === "approvals" && (t.approvals.length === 0 ? <Empty title="No approvals were requested" /> : (
              <table className="table">
                <thead><tr><th scope="col">Request</th><th scope="col">Type</th><th scope="col">Outcome</th><th scope="col">Requested</th><th scope="col">Decided</th></tr></thead>
                <tbody>{t.approvals.map((a: any) => (
                  <tr key={a.id}><td className="small">{a.summary}{a.decision_note && <div className="tiny muted">“{a.decision_note}”</div>}</td><td className="small">{a.kind === "integration_call" ? "API call" : "Tool action"}</td>
                    <td><Status status={a.status} /></td><td className="muted nowrap">{fullDateTime(a.requested_at)}</td><td className="muted nowrap">{fullDateTime(a.decided_at)}</td></tr>
                ))}</tbody>
              </table>
            ))}
            {tab === "delegation" && (
              <div className="panel-body">
                {t.parent_task_id && <p className="small" style={{ marginTop: 0 }}>Delegated by <Link to={`/tasks/${t.parent_task_id}`} style={{ color: "var(--accent)" }}>its parent task</Link> at depth {t.delegation_depth}.</p>}
                {t.children.length === 0 ? <p className="muted small">No sub-tasks were delegated.</p> : t.children.map((c: any) => (
                  <Link key={c.delegation_id} to={`/tasks/${c.child_task_id}`} className="list-row" style={{ border: "1px solid var(--border)", borderRadius: 8, marginBottom: 6 }}>
                    <GitBranch size={15} aria-hidden /><span className="grow small">{c.objective}</span><Status status={c.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h2>Execution</h2></div>
            <div className="panel-body">
              <KV items={[
                ["Status", <Status key="s" status={t.status} />],
                ["Started", fullDateTime(t.started_at)],
                ["Finished", fullDateTime(t.finished_at)],
                ["Duration", t.duration_s != null ? duration(t.duration_s) : t.status === "running" ? `${duration(elapsedSince(t.started_at))} so far` : "—"],
                ["Attempt", `${t.attempt + 1} of ${t.max_retries + 1}`],
                ["Priority", String(t.priority)],
                ["Session", t.session_id ? <Link key="ss" className="mono" to={`/agents/${t.agent_id}?session=${t.session_id}`}>{shortId(t.session_id)}</Link> : "—"],
                ["Trace ID", <span key="tr" className="mono">{t.trace_id}</span>],
              ]} />
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Usage</h2></div>
            <div className="panel-body">
              <KV items={[
                ["Model", <span key="m" className="mono">{t.usage.model ?? "—"}</span>],
                ["Input tokens", num(t.usage.prompt_tokens)],
                ["Output tokens", num(t.usage.completion_tokens)],
                ["Model requests", num(t.usage.requests)],
                ["Tool calls", num(t.usage.tool_calls)],
                ["Cost", t.usage.cost_usd != null ? <span key="c">{usd(t.usage.cost_usd)} <span className="tag">estimate</span></span> : "Not available"],
              ]} />
              {t.usage.cost_usd != null && <p className="tiny muted" style={{ marginBottom: 0 }}>Estimated from the provider's published per-token rates; not an invoice amount.</p>}
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}

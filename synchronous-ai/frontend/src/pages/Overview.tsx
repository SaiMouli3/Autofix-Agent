import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Bot, CheckCircle2, FileText, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Alert, Empty, ErrorState, Skeleton, SkeletonRows, Status, Tag } from "../components/ui";
import { api, qs } from "../lib/api";
import { bytes, clock, duration, elapsedSince, timeAgo } from "../lib/format";
import { usePref } from "../lib/prefs";
import { useSession } from "../lib/session";
import { FAILURE } from "../lib/status";

const WINDOWS: Record<string, { label: string; hours: number | null }> = {
  "24h": { label: "Last 24 hours", hours: 24 },
  "7d": { label: "Last 7 days", hours: 24 * 7 },
  "30d": { label: "Last 30 days", hours: 24 * 30 },
  all: { label: "All time", hours: null },
};

function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t); }, [ms]);
}

export default function Overview() {
  const { me, can } = useSession();
  const nav = useNavigate();
  const [win, setWin] = usePref("overview.window", "7d");
  const since = WINDOWS[win]?.hours ? new Date(Date.now() - WINDOWS[win].hours! * 3600_000).toISOString() : undefined;
  const count = (status: string, windowed: boolean) => ({
    queryKey: ["tasks", "count", status, windowed ? since?.slice(0, 13) : "now"],
    queryFn: ({ signal }: any) => api.get(`/api/tasks${qs({ status, page_size: 1, created_after: windowed ? since : undefined })}`, signal).then((r: any) => r.total as number),
    refetchInterval: 15000,
  });
  const running = useQuery(count("running", false));
  const queued = useQuery(count("queued", false));
  const waiting = useQuery({ queryKey: ["approvals-count"], queryFn: ({ signal }) => api.get("/api/approvals?status=pending&page_size=1", signal), refetchInterval: 15000 });
  const completed = useQuery(count("completed", true));
  const failed = useQuery(count("failed,timed_out", true));
  const overview = useQuery({ queryKey: ["overview"], queryFn: ({ signal }) => api.get("/api/overview", signal), refetchInterval: 20000 });
  const active = useQuery({ queryKey: ["tasks", "active-list"], queryFn: ({ signal }) => api.get("/api/tasks?status=running,waiting_for_approval,queued&page_size=8&sort=started", signal), refetchInterval: 8000 });
  const approvals = useQuery({ queryKey: ["approvals", "pending", "overview"], queryFn: ({ signal }) => api.get("/api/approvals?status=pending&page_size=5", signal), refetchInterval: 15000 });
  const failures = useQuery({ queryKey: ["tasks", "failures", since?.slice(0, 13)], queryFn: ({ signal }) => api.get(`/api/tasks${qs({ status: "failed,timed_out", page_size: 5, created_after: since, top_level: true })}`, signal), refetchInterval: 20000 });
  const done = useQuery({ queryKey: ["tasks", "done"], queryFn: ({ signal }) => api.get("/api/tasks?status=completed&page_size=6&sort=finished&top_level=true", signal), refetchInterval: 20000 });
  useTick(1000);

  const metric = (label: string, q: any, to: string, tone = "", hint?: string) => (
    <Link className={`metric ${tone}`} to={to}>
      <div className="label">{label}</div>
      <div className="value">{q.isLoading ? <Skeleton h={26} w={40} /> : q.isError ? "—" : (q.data?.total ?? q.data ?? 0)}</div>
      {hint && <div className="hint">{hint}</div>}
      <ArrowUpRight className="arrow" aria-hidden />
    </Link>
  );
  const winQs = since ? `&since=${win}` : "";
  const noProvider = overview.data && overview.data.providers.length === 0;

  return (
    <Shell crumbs={[{ label: "Overview" }]}>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>What is running, what needs you, and what finished in <b>{me.org.name}</b>.</p>
        </div>
        <div className="row">
          <label className="sr-only" htmlFor="win">Time range for completed and failed counts</label>
          <select id="win" value={win} onChange={(e) => setWin(e.target.value)} style={{ width: 150 }}>
            {Object.entries(WINDOWS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {can("agents:write") && <button className="btn primary" onClick={() => nav("/agents/new")}><Plus /> Create agent</button>}
        </div>
      </div>

      {noProvider && can("providers:write") && (
        <div style={{ marginBottom: 16 }}>
          <Alert kind="warn" actions={<Link className="btn sm" to="/settings">Configure provider</Link>}>
            No model provider is configured. Agents cannot run until an administrator adds and tests one.
          </Alert>
        </div>
      )}

      <section aria-label="Operational summary" className="metrics">
        {metric("Running executions", running, "/tasks?status=running", "", "now")}
        {metric("Queued tasks", queued, "/tasks?status=queued", "", "waiting for a worker")}
        {metric("Awaiting approval", waiting, "/approvals", (waiting.data?.total ?? 0) > 0 ? "attn" : "", "human decision required")}
        {metric("Completed", completed, `/tasks?status=completed${winQs}`, "", WINDOWS[win].label.toLowerCase())}
        {metric("Failed", failed, `/tasks?status=failed,timed_out${winQs}`, (failed.data ?? 0) > 0 ? "bad" : "", WINDOWS[win].label.toLowerCase())}
      </section>

      <div className="split mt16">
        <div className="stack" style={{ gap: 16 }}>
          <section className="panel" aria-labelledby="attn-h">
            <div className="panel-head"><h2 id="attn-h">Needs your attention</h2><Link className="btn xs ghost" to="/approvals">All approvals</Link></div>
            {(approvals.isLoading || failures.isLoading) && <SkeletonRows rows={3} />}
            {approvals.isError && <div className="panel-body"><ErrorState error={approvals.error} onRetry={() => approvals.refetch()} what="approvals" /></div>}
            {approvals.data && failures.data && approvals.data.items.length === 0 && failures.data.items.length === 0 && (
              <Empty icon={CheckCircle2} title="Nothing needs you right now">Approval requests and failed executions appear here.</Empty>
            )}
            {approvals.data?.items.map((a: any) => (
              <Link key={a.id} to="/approvals" className="list-row">
                <ShieldCheck size={16} color="var(--warning)" aria-hidden />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small"><b>{a.agent_name}</b> requests approval · <span className="muted">{a.kind === "integration_call" ? "API call" : "tool action"}</span></div>
                  <div className="small ellipsis">{a.summary}</div>
                </div>
                <span className="tiny muted nowrap">{timeAgo(a.requested_at)}</span>
                <Tag tone="warning">Review</Tag>
              </Link>
            ))}
            {failures.data?.items.map((t: any) => {
              const f = FAILURE[t.error_category ?? "runtime"] ?? FAILURE.runtime;
              return (
                <Link key={t.id} to={`/tasks/${t.id}`} className="list-row">
                  <Status status={t.status} quiet />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="small"><b>{t.agent_name}</b> · <span className="muted">{f.label}</span></div>
                    <div className="small ellipsis">{t.title}</div>
                    <div className="tiny muted ellipsis">{f.next}</div>
                  </div>
                  <span className="tiny muted nowrap">{timeAgo(t.finished_at ?? t.created_at)}</span>
                </Link>
              );
            })}
          </section>

          <section className="panel" aria-labelledby="active-h">
            <div className="panel-head"><h2 id="active-h">Active executions</h2><Link className="btn xs ghost" to="/tasks?status=active">All active</Link></div>
            {active.isLoading && <SkeletonRows rows={3} />}
            {active.isError && <div className="panel-body"><ErrorState error={active.error} onRetry={() => active.refetch()} what="active executions" /></div>}
            {active.data?.items.length === 0 && <Empty icon={Bot} title="No agents are working">Assign a task from an agent's workspace to start an execution.</Empty>}
            {active.data && active.data.items.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Agent</th><th scope="col">Task</th><th scope="col">Status</th><th scope="col">Started</th><th scope="col" className="right">Elapsed</th></tr></thead>
                  <tbody>
                    {active.data.items.map((t: any) => (
                      <tr key={t.id} className="click" onClick={() => nav(`/agents/${t.agent_id}?task=${t.id}`)}>
                        <td className="nowrap"><b className="small">{t.agent_name}</b></td>
                        <td className="title-cell"><Link to={`/agents/${t.agent_id}?task=${t.id}`} className="ellipsis" style={{ display: "block" }}>{t.title}</Link></td>
                        <td><Status status={t.status} /></td>
                        <td className="mono muted nowrap">{t.started_at ? clock(t.started_at) : "—"}</td>
                        <td className="right num nowrap">{t.started_at ? duration(elapsedSince(t.started_at)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="feed-h">
            <div className="panel-head"><h2 id="feed-h">Recent agent activity</h2><span className="sub">persisted execution events, newest first</span></div>
            {overview.isLoading && <SkeletonRows rows={6} />}
            {overview.isError && <div className="panel-body"><ErrorState error={overview.error} onRetry={() => overview.refetch()} what="activity" /></div>}
            {overview.data?.recent_activity.length === 0 && <Empty title="No activity yet">Execution events will be listed here.</Empty>}
            {overview.data && overview.data.recent_activity.length > 0 && (
              <ol style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 420, overflow: "auto" }}>
                {overview.data.recent_activity.map((e: any) => (
                  <li key={e.id}>
                    <Link to={`/tasks/${e.task_id}`} className="list-row" style={{ padding: "7px 16px" }}>
                      <time className="mono muted nowrap" dateTime={e.ts} style={{ width: 64 }}>{clock(e.ts)}</time>
                      <span className="small strong nowrap" style={{ width: 140 }} title={e.agent_name}><span className="ellipsis" style={{ display: "block" }}>{e.agent_name}</span></span>
                      <span className="tag mono hide-sm">{e.type.replace(/_/g, " ")}</span>
                      <span className="small grow ellipsis">{e.summary}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <section className="panel" aria-labelledby="done-h">
            <div className="panel-head"><h2 id="done-h">Recently completed</h2><Link className="btn xs ghost" to="/tasks?status=completed">All</Link></div>
            {done.isLoading && <SkeletonRows rows={4} />}
            {done.data?.items.length === 0 && <Empty title="No completed work yet" />}
            {done.data?.items.map((t: any) => (
              <Link key={t.id} to={`/tasks/${t.id}`} className="list-row">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small ellipsis">{t.title}</div>
                  <div className="tiny muted">{t.agent_name} · {duration(t.duration_s)} · {timeAgo(t.finished_at)}</div>
                </div>
              </Link>
            ))}
          </section>

          <section className="panel" aria-labelledby="art-h">
            <div className="panel-head"><h2 id="art-h">Recent artifacts</h2></div>
            <div className="panel-body" style={{ padding: 8 }}>
              {overview.data?.recent_artifacts.length === 0 && <p className="small muted" style={{ margin: 8 }}>Files agents create are listed here.</p>}
              {overview.data?.recent_artifacts.map((a: any) => (
                <Link key={a.id} to={`/tasks/${a.task_id}?tab=artifacts`} className="file-link">
                  <FileText aria-hidden /><span className="grow ellipsis mono">{a.path}</span>
                  <span className="tiny muted nowrap">{a.agent_name} · {bytes(a.size)}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="panel" aria-labelledby="health-h">
            <div className="panel-head"><h2 id="health-h">Platform health</h2><Link className="btn xs ghost" to="/monitoring">Monitoring</Link></div>
            <div className="panel-body stack tight">
              {overview.isLoading && <Skeleton h={80} />}
              {overview.data && (
                <>
                  <HealthRow ok={overview.data.system.database} label="Database" />
                  <HealthRow ok={overview.data.system.dispatcher_alive} label="Task dispatcher" />
                  <HealthRow ok={overview.data.system.watchdog_alive} label="Execution watchdog" />
                  {overview.data.system.docker_available !== null && <HealthRow ok={overview.data.system.docker_available} label="Sandbox runtime (Docker)" />}
                  {overview.data.providers.map((p: any) => (
                    <HealthRow key={p.id} ok={p.status === "ok"} unknown={p.status === "untested"} label={p.name} detail={p.last_tested_at ? `tested ${timeAgo(p.last_tested_at)}` : "not tested"} />
                  ))}
                  {overview.data.integration_errors.map((i: any) => (
                    <HealthRow key={i.id} ok={false} label={i.name} detail="last check failed" to="/integrations" />
                  ))}
                  <div className="tiny muted mt4">{overview.data.system.active_workers} of {overview.data.system.max_workers} workers busy · {overview.data.system.runtime} runtime</div>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </Shell>
  );
}

function HealthRow({ ok, unknown, label, detail, to }: { ok: boolean; unknown?: boolean; label: string; detail?: string; to?: string }) {
  const body = (
    <div className="row small">
      <Status status={ok ? "connected" : unknown ? "untested" : "error"} quiet />
      <span className="grow ellipsis">{label}</span>
      <span className="tiny muted">{detail ?? (ok ? "operational" : unknown ? "unknown" : "unavailable")}</span>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}


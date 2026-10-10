import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BarChart, DataTable, HBars } from "../components/charts";
import { Shell } from "../components/Shell";
import { Alert, ErrorState, KV, SkeletonRows, Status } from "../components/ui";
import { api } from "../lib/api";
import { duration, num, timeAgo, usd } from "../lib/format";
import { usePref } from "../lib/prefs";
import { integrationState, FAILURE } from "../lib/status";

export default function Monitoring() {
  const [days, setDays] = usePref("monitoring.days", 14);
  const q = useQuery({ queryKey: ["monitoring", days], queryFn: ({ signal }) => api.get(`/api/monitoring?days=${days}`, signal), refetchInterval: 20000 });
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: ({ signal }) => api.get("/api/integrations", signal) });
  const providers = useQuery({ queryKey: ["providers"], queryFn: ({ signal }) => api.get("/api/providers", signal) });
  const d = q.data;
  const totalCost = d ? d.usage_by_model.reduce((s: number, r: any) => s + (r.estimated_cost_usd ?? 0), 0) : 0;
  const unpriced = d ? d.usage_by_model.filter((r: any) => r.estimated_cost_usd === null).length : 0;
  return (
    <Shell crumbs={[{ label: "Monitoring" }]}>
      <div className="page-head">
        <div><h1>Monitoring</h1><p>Execution throughput, failures, queue and capacity, provider and integration health, and model usage — measured from platform records.</p></div>
        <div className="row">
          <label className="sr-only" htmlFor="days">Time range</label>
          <select id="days" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 150 }}>
            {[1, 7, 14, 30, 90].map((n) => <option key={n} value={n}>Last {n} day{n > 1 ? "s" : ""}</option>)}
          </select>
        </div>
      </div>
      {q.isLoading && <div className="panel"><SkeletonRows rows={8} /></div>}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} what="monitoring data" />}
      {d && (
        <div className="stack" style={{ gap: 16 }}>
          <section className="metrics" aria-label="Current state">
            <div className="metric"><div className="label">Running now</div><div className="value">{d.queue.running ?? 0}</div><div className="hint">{d.workers.active_workers} of {d.workers.max_workers} workers busy</div></div>
            <div className="metric"><div className="label">Queue depth</div><div className="value">{d.queue.queued ?? 0}</div><div className="hint">{d.queue.oldest_queued_at ? `oldest ${timeAgo(d.queue.oldest_queued_at)}` : "empty"}</div></div>
            <div className="metric"><div className="label">Awaiting approval</div><div className="value">{d.queue.waiting_for_approval ?? 0}</div><div className="hint">{d.workers.parked_for_approval} parked conversation(s)</div></div>
            <div className="metric"><div className="label">Median duration</div><div className="value">{duration(d.durations.p50_s)}</div><div className="hint">p90 {duration(d.durations.p90_s)} · {d.durations.count} runs</div></div>
            <div className="metric"><div className="label">Estimated model cost</div><div className="value">{usd(totalCost)}</div><div className="hint">{unpriced ? `${unpriced} model(s) without published pricing` : "from published rates"}</div></div>
          </section>

          <div className="grid cols-2">
            <section className="panel">
              <div className="panel-head"><h2>Task outcomes per day</h2><span className="sub">tasks created</span></div>
              <div className="panel-body">
                <BarChart data={d.daily_tasks} xKey="date" yLabel="Tasks" xLabel="Date (UTC)"
                  series={[{ key: "completed", label: "Completed", color: "#27845A" }, { key: "failed", label: "Failed", color: "#C44848" }, { key: "other", label: "Other / in progress", color: "#B9BDB7" }]} />
              </div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Model tokens per day</h2><span className="sub">input + output</span></div>
              <div className="panel-body">
                <BarChart data={d.daily_usage} xKey="date" yLabel="Tokens" xLabel="Date (UTC)" format={(v) => num(v)} series={[{ key: "tokens", label: "Tokens", color: "#4A4F4B" }]} />
              </div>
            </section>
          </div>

          <div className="grid cols-2">
            <section className="panel">
              <div className="panel-head"><h2>Why executions failed</h2><span className="sub">{days} day{days > 1 ? "s" : ""}</span></div>
              <div className="panel-body">
                <HBars unit="tasks" rows={Object.entries(d.error_categories ?? {}).map(([k, v]) => ({ label: FAILURE[k]?.label ?? k, value: v as number })).sort((a, b) => b.value - a.value)} />
                {Object.keys(d.error_codes).length > 0 && <DataTable rows={Object.entries(d.error_codes).map(([code, n]) => ({ code, n }))} cols={[{ key: "code", label: "Error code" }, { key: "n", label: "Tasks" }]} />}
              </div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Recent errors</h2><span className="sub">open a trace to investigate</span></div>
              {d.recent_errors.length === 0 ? <div className="panel-body"><p className="small muted" style={{ margin: 0 }}>No errors in this period.</p></div> : (
                <ol style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 320, overflow: "auto" }}>
                  {d.recent_errors.map((e: any, i: number) => (
                    <li key={i}><Link to={`/tasks/${e.task_id}`} className="list-row" style={{ padding: "7px 16px" }}>
                      <span className="tiny muted nowrap" style={{ width: 60 }}>{timeAgo(e.ts)}</span>
                      <span className="small strong nowrap">{e.agent}</span>
                      <span className="small grow ellipsis">{e.summary}</span>
                    </Link></li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <div className="grid cols-2">
            <section className="panel">
              <div className="panel-head"><h2>Provider health</h2><Link className="btn xs ghost" to="/settings?tab=providers">Providers</Link></div>
              <div className="panel-body stack tight">
                {(providers.data ?? []).length === 0 && <p className="small muted" style={{ margin: 0 }}>No providers configured.</p>}
                {(providers.data ?? []).map((p: any) => (
                  <div key={p.id} className="row small">
                    <Status status={p.status === "ok" ? "connected" : p.status === "error" ? "error" : "untested"} quiet />
                    <span className="grow">{p.name}</span>
                    <span className="tiny muted">{p.status === "error" ? p.last_test_result?.error?.code : p.last_tested_at ? `checked ${timeAgo(p.last_tested_at)}` : "never checked"}</span>
                  </div>
                ))}
                {(d.error_categories?.provider ?? 0) > 0 && <Alert kind="warn">{d.error_categories.provider} task(s) failed with provider errors in this period.</Alert>}
              </div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Integration health</h2><Link className="btn xs ghost" to="/integrations">Integrations</Link></div>
              <div className="panel-body stack tight">
                {(integrations.data ?? []).length === 0 && <p className="small muted" style={{ margin: 0 }}>No integrations configured.</p>}
                {(integrations.data ?? []).map((i: any) => (
                  <div key={i.id} className="row small">
                    <Status status={integrationState(i)} quiet />
                    <span className="grow">{i.name}</span>
                    <span className="tiny muted ellipsis" style={{ maxWidth: 240 }}>{i.health?.checked_at ? `${i.health.ok ? "ok" : i.health.detail} · ${timeAgo(i.health.checked_at)}` : "never checked"}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid cols-2">
            <section className="panel">
              <div className="panel-head"><h2>Usage by agent</h2><span className="sub">tokens</span></div>
              <div className="panel-body">
                <HBars unit="tokens" format={(v) => num(v)} rows={d.usage_by_agent.map((r: any) => ({ label: r.agent, value: r.prompt_tokens + r.completion_tokens })).sort((a: any, b: any) => b.value - a.value)} />
                <DataTable rows={d.usage_by_agent} cols={[{ key: "agent", label: "Agent" }, { key: "tasks", label: "Tasks" }, { key: "llm_requests", label: "Model requests" }, { key: "tool_calls", label: "Tool calls" }, { key: "estimated_cost_usd", label: "Est. cost (USD)", format: (v) => usd(v) }]} />
              </div>
            </section>
            <section className="panel">
              <div className="panel-head"><h2>Usage by model</h2><span className="sub">estimated cost, USD</span></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Model</th><th scope="col" className="right">Input</th><th scope="col" className="right">Output</th><th scope="col" className="right">Requests</th><th scope="col" className="right">Est. cost</th></tr></thead>
                  <tbody>
                    {d.usage_by_model.length === 0 && <tr><td colSpan={5} className="muted small">No model usage in this period.</td></tr>}
                    {d.usage_by_model.map((r: any) => (
                      <tr key={r.model}><td className="mono">{r.model}</td><td className="right num">{num(r.prompt_tokens)}</td><td className="right num">{num(r.completion_tokens)}</td><td className="right num">{num(r.llm_requests)}</td>
                        <td className="right num">{r.estimated_cost_usd === null ? <span className="muted" title="The provider publishes no pricing for this model">n/a</span> : usd(r.estimated_cost_usd)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel-foot tiny muted">{d.cost_note} Actual invoiced amounts come from your provider's billing.</div>
            </section>
          </div>

          <section className="panel">
            <div className="panel-head"><h2>Platform resources</h2><span className="sub">this API process and host, sampled now</span></div>
            <div className="panel-body">
              <KV items={[
                ["Process memory", `${d.resources.process_rss_mb} MB`], ["Process CPU", `${d.resources.process_cpu_percent}%`], ["Threads", String(d.resources.threads)],
                ["Host memory used", `${d.resources.host_memory_percent}%`], ["Host CPU", `${d.resources.host_cpu_percent}% of ${d.resources.cpu_count} cores`],
                ["Dispatcher", d.workers.dispatcher_alive ? "running" : "not responding"], ["Watchdog", d.workers.watchdog_alive ? "running" : "not responding"],
              ]} />
            </div>
          </section>
        </div>
      )}
    </Shell>
  );
}

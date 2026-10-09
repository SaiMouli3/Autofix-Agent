import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { HBars, StackedBars } from "../components/charts";
import { Shell } from "../components/Shell";
import { ErrorBox, KV, Loading, Notice } from "../components/ui";
import { api } from "../lib/api";
import { duration, num, timeAgo, usd } from "../lib/format";

export default function Monitoring() {
  const [days, setDays] = useState(14);
  const q = useQuery({ queryKey: ["monitoring", days], queryFn: () => api.get(`/api/monitoring?days=${days}`), refetchInterval: 15000 });
  const d = q.data;
  return (
    <Shell title="Monitoring & Usage">
      <div className="page-head">
        <div><h1>Monitoring & usage</h1><p>Model usage, estimated cost, execution performance, queue and resource utilization — measured from platform records and the running process.</p></div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 160 }} aria-label="Window">
          {[1, 7, 14, 30, 90].map((n) => <option key={n} value={n}>Last {n} day{n > 1 ? "s" : ""}</option>)}
        </select>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading />}
      {d && (
        <div className="stack" style={{ gap: 16 }}>
          <Notice>{d.cost_note}</Notice>
          <div className="grid cols-2">
            <div className="card"><div className="card-title">Tasks per day</div>
              <StackedBars data={d.daily_tasks} xKey="date" series={[{ key: "completed", label: "Completed", color: "#22c55e" }, { key: "failed", label: "Failed", color: "#f05252" }, { key: "other", label: "Other", color: "#5b8def" }]} /></div>
            <div className="card"><div className="card-title">Tokens per day</div>
              <StackedBars data={d.daily_usage} xKey="date" format={num} series={[{ key: "tokens", label: "Tokens", color: "#F97316" }]} /></div>
          </div>
          <div className="grid cols-3">
            <div className="card"><div className="card-title">Execution time</div>
              <KV items={[["Finished tasks", String(d.durations.count)], ["Median", duration(d.durations.p50_s)], ["90th percentile", duration(d.durations.p90_s)], ["Longest", duration(d.durations.max_s)]]} /></div>
            <div className="card"><div className="card-title">Queue & workers</div>
              <KV items={[["Running", String(d.queue.running ?? 0)], ["Queued", String(d.queue.queued ?? 0)], ["Awaiting approval", String(d.queue.waiting_for_approval ?? 0)],
                ["Oldest queued", d.queue.oldest_queued_at ? timeAgo(d.queue.oldest_queued_at) : "—"], ["Workers busy", `${d.workers.active_workers} / ${d.workers.max_workers}`], ["Parked for approval", String(d.workers.parked_for_approval)]]} /></div>
            <div className="card"><div className="card-title">Resources (API process / host)</div>
              <KV items={[["Process memory", `${d.resources.process_rss_mb} MB`], ["Process CPU", `${d.resources.process_cpu_percent}%`], ["Threads", String(d.resources.threads)],
                ["Host memory", `${d.resources.host_memory_percent}%`], ["Host CPU", `${d.resources.host_cpu_percent}% of ${d.resources.cpu_count} cores`]]} /></div>
          </div>
          <div className="grid cols-2">
            <div className="card"><div className="card-title">Usage by agent <span className="faint small">tokens</span></div>
              <HBars rows={d.usage_by_agent.map((r: any) => ({ label: r.agent, value: r.prompt_tokens + r.completion_tokens }))} format={num} />
              <table className="table mt16"><thead><tr><th>Agent</th><th>Tasks</th><th>Requests</th><th>Tool calls</th><th>Est. cost</th></tr></thead>
                <tbody>{d.usage_by_agent.map((r: any) => <tr key={r.agent}><td className="small">{r.agent}</td><td>{r.tasks}</td><td>{num(r.llm_requests)}</td><td>{num(r.tool_calls)}</td><td>{usd(r.estimated_cost_usd)}</td></tr>)}</tbody></table></div>
            <div className="card"><div className="card-title">Usage by model</div>
              <table className="table"><thead><tr><th>Model</th><th>Prompt</th><th>Completion</th><th>Requests</th><th>Est. cost</th></tr></thead>
                <tbody>{d.usage_by_model.map((r: any) => <tr key={r.model}><td className="small mono">{r.model}</td><td>{num(r.prompt_tokens)}</td><td>{num(r.completion_tokens)}</td><td>{num(r.llm_requests)}</td><td>{usd(r.estimated_cost_usd)}</td></tr>)}</tbody></table>
              <div className="card-title mt24">Failure causes</div>
              <HBars rows={Object.entries(d.error_codes).map(([k, v]) => ({ label: k, value: v as number }))} />
            </div>
          </div>
          <div className="card flush"><div className="card-head"><b>Recent errors</b></div>
            {d.recent_errors.length === 0 ? <div className="card-body faint small">No errors recorded.</div> : (
              <table className="table"><tbody>{d.recent_errors.map((e: any, i: number) => <tr key={i}><td className="faint small nowrap">{timeAgo(e.ts)}</td><td className="small strong nowrap">{e.agent}</td><td className="small">{e.summary}</td></tr>)}</tbody></table>)}
          </div>
        </div>
      )}
    </Shell>
  );
}

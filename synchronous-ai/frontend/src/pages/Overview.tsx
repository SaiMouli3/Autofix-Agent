import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  FileText,
  Hourglass,
  PlayCircle,
  Plus,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Empty, ErrorBox, Loading, Notice } from "../components/ui";
import { api } from "../lib/api";
import { bytes, num, timeAgo, usd } from "../lib/format";
import { useSession } from "../lib/session";
import { AgentDirectory } from "./Agents";

export default function Overview() {
  const { me, can } = useSession();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["overview"], queryFn: () => api.get("/api/overview"), refetchInterval: 15000 });
  const d = q.data;
  return (
    <Shell title="Overview">
      <div className="page-head">
        <div>
          <h1>Good to see you, {me.user.name.split(" ")[0]}</h1>
          <p>Live state of {me.org.name}'s agent workforce. Every figure below is computed from stored platform records.</p>
        </div>
        {can("agents:write") && (
          <button className="btn primary" onClick={() => nav("/agents/new")}><Plus /> Create agent</button>
        )}
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading />}
      {d && (
        <>
          {d.providers.length === 0 && can("providers:write") && (
            <div className="mb16"><Notice kind="warn">No model provider is configured yet. <Link to="/settings" className="strong" style={{ color: "var(--accent)" }}>Add one in Settings</Link> before creating agents.</Notice></div>
          )}
          <div className="grid cols-4">
            <Kpi icon={Bot} label="Agents" value={d.agents.total} hint={`${d.agents.active} active`} />
            <Kpi icon={PlayCircle} label="Running executions" value={d.tasks.running} hint={`${d.system.active_workers}/${d.system.max_workers} workers busy`} accent={d.tasks.running > 0} />
            <Kpi icon={Hourglass} label="Queued tasks" value={d.tasks.queued} hint="waiting for a worker" />
            <Kpi icon={ShieldCheck} label="Awaiting approval" value={d.pending_approvals} hint="human decisions pending" link="/approvals" />
            <Kpi icon={CheckCircle2} label="Completed tasks" value={d.tasks.completed} hint="all time" />
            <Kpi icon={XCircle} label="Failed executions" value={d.tasks.failed} hint="failed or timed out" />
            <Kpi icon={Cpu} label="Tokens (30 days)" value={num(d.usage_30d.prompt_tokens + d.usage_30d.completion_tokens)} hint={`${num(d.usage_30d.llm_requests)} model requests`} />
            <Kpi icon={Database} label="Est. model cost (30 days)" value={d.usage_30d.estimated_cost_usd === null ? "n/a" : usd(d.usage_30d.estimated_cost_usd)}
              hint={d.usage_30d.records_without_pricing ? `${d.usage_30d.records_without_pricing} records without published pricing` : "from provider-published rates"} />
          </div>

          <div className="split mt16">
            <div className="card flush">
              <div className="card-head"><b>Recent agent activity</b><Link to="/tasks" className="btn xs ghost">All tasks</Link></div>
              {d.recent_activity.length === 0 ? (
                <Empty icon={Clock} title="No activity yet">Assign a task to an agent to see live execution events here.</Empty>
              ) : (
                <div className="table-wrap" style={{ maxHeight: 420 }}>
                  <table className="table">
                    <tbody>
                      {d.recent_activity.map((e: any) => (
                        <tr key={e.id} className="click" onClick={() => nav(`/tasks/${e.task_id}`)}>
                          <td className="nowrap faint small" style={{ width: 90 }}>{timeAgo(e.ts)}</td>
                          <td className="nowrap strong small" style={{ width: 160 }}>{e.agent_name}</td>
                          <td><span className="badge outline">{e.type.replace("_", " ")}</span></td>
                          <td className="small ellipsis" style={{ maxWidth: 420 }}>{e.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="stack">
              <div className="card">
                <div className="card-title">System health</div>
                <div className="stack" style={{ gap: 8 }}>
                  <Health ok={d.system.database} label="Database" />
                  <Health ok={d.system.dispatcher_alive} label="Task dispatcher" />
                  <Health ok={d.system.watchdog_alive} label="Execution watchdog" />
                  {d.system.docker_available !== null && <Health ok={d.system.docker_available} label="Docker sandbox runtime" />}
                  {d.providers.map((p: any) => (
                    <Health key={p.id} ok={p.status === "ok"} warn={p.status === "untested"} label={`Provider · ${p.name}`} detail={p.last_tested_at ? `tested ${timeAgo(p.last_tested_at)}` : "not tested"} />
                  ))}
                  <div className="faint tiny">Runtime: {d.system.runtime} · uptime {Math.round(d.system.uptime_s / 60)} min · {d.system.parked_for_approval} parked for approval</div>
                </div>
              </div>
              <div className="card">
                <div className="card-title">Recent outputs</div>
                {d.recent_artifacts.length === 0 && <div className="faint small">Files produced by agents will appear here.</div>}
                {d.recent_artifacts.map((a: any) => (
                  <Link key={a.id} to={`/tasks/${a.task_id}?tab=files`} className="row small" style={{ padding: "5px 0" }}>
                    <FileText size={15} className="faint" /> <span className="grow ellipsis">{a.path}</span>
                    <span className="faint tiny">{a.agent_name} · {bytes(a.size)}</span>
                  </Link>
                ))}
              </div>
              {d.integration_errors.length > 0 && (
                <div className="card">
                  <div className="card-title"><span className="row"><AlertTriangle size={15} color="var(--amber)" /> Integration errors</span></div>
                  {d.integration_errors.map((i: any) => (
                    <Link key={i.id} to="/integrations" className="small" style={{ display: "block", padding: "4px 0" }}>
                      <b>{i.name}</b> <span className="faint">— {i.detail}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <h2 className="section-title mt24">Agent directory</h2>
          <AgentDirectory compact />
        </>
      )}
    </Shell>
  );
}

function Kpi({ icon: Icon, label, value, hint, accent, link }: { icon: any; label: string; value: any; hint?: string; accent?: boolean; link?: string }) {
  const body = (
    <div className={`card kpi ${accent ? "accent" : ""} ${link ? "hover" : ""}`}>
      <div className="label"><Icon /> {label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
  return link ? <Link to={link}>{body}</Link> : body;
}

function Health({ ok, warn, label, detail }: { ok: boolean; warn?: boolean; label: string; detail?: string }) {
  return (
    <div className="row small">
      <span className={`status-dot ${ok ? "completed" : warn ? "waiting_for_approval" : "failed"}`} />
      <span className="grow">{label}</span>
      <span className="faint tiny">{detail ?? (ok ? "operational" : warn ? "attention" : "unavailable")}</span>
    </div>
  );
}

import {
  AlertOctagon,
  Ban,
  BookOpen,
  CircleDot,
  FileOutput,
  GitBranch,
  MessageSquare,
  Plug,
  ShieldAlert,
  Terminal,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { time } from "../lib/format";
import { ActivityEvent } from "../lib/stream";

const ICONS: Record<string, any> = {
  status: CircleDot, tool_call: Wrench, tool_result: Terminal, tool_error: AlertOctagon, tool_rejected: Ban, error: AlertOctagon,
  message: MessageSquare, approval: ShieldAlert, knowledge: BookOpen, delegation: GitBranch, integration: Plug, artifact: FileOutput,
  paused: Ban, progress: CircleDot,
};

export function Timeline({ events, showAgent, agentNames }: { events: ActivityEvent[]; showAgent?: boolean; agentNames?: Record<string, string> }) {
  if (!events.length) return <div className="faint small" style={{ padding: 16 }}>No events yet. Activity streams here live while the agent works.</div>;
  return (
    <div className="timeline">
      {events.map((e) => <Item key={e.id} e={e} showAgent={showAgent} agentName={agentNames?.[e.agent_id]} />)}
    </div>
  );
}

function Item({ e, showAgent, agentName }: { e: ActivityEvent; showAgent?: boolean; agentName?: string }) {
  const [open, setOpen] = useState(e.type === "approval" || e.type === "error");
  const Icon = ICONS[e.type] ?? CircleDot;
  const detail = renderDetail(e);
  return (
    <div className="tl-item">
      <div className="tl-time">{time(e.ts)}</div>
      <div className={`tl-icon ${e.type}`}><Icon /></div>
      <div className="tl-body">
        <div className="tl-summary">
          {showAgent && agentName && <b className="small" style={{ marginRight: 8 }}>{agentName}</b>}
          {e.type === "tool_call" && <span className="badge outline" style={{ marginRight: 6 }}>{e.data.tool}</span>}
          {e.type === "tool_call" && e.data.risk && e.data.risk !== "UNKNOWN" && <span className={`badge risk-${String(e.data.risk).toLowerCase()}`} style={{ marginRight: 6 }}>{String(e.data.risk).toLowerCase()} risk</span>}
          <span>{e.summary}</span>
          {detail && <button className="btn xs ghost" style={{ marginLeft: 6 }} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "hide" : "details"}</button>}
          {e.data?.child_task_id && <Link to={`/tasks/${e.data.child_task_id}`} className="btn xs ghost">open sub-task</Link>}
          {e.type === "approval" && e.data?.status === "waiting_for_approval" && <Link to="/approvals" className="btn xs primary" style={{ marginLeft: 6 }}>Review</Link>}
        </div>
        {open && detail && <div className="tl-detail">{detail}</div>}
      </div>
    </div>
  );
}

function renderDetail(e: ActivityEvent) {
  const d = e.data ?? {};
  if (e.type === "tool_call" && d.args && Object.keys(d.args).length) {
    if (d.args.command && d.tool === "terminal") return <pre className="block">$ {d.args.command}</pre>;
    return <pre className="block">{JSON.stringify(d.args, null, 2)}</pre>;
  }
  if (e.type === "tool_result" && d.output) return <pre className="block">{d.output}</pre>;
  if ((e.type === "tool_error" || e.type === "error") && (d.error || d.detail)) return <pre className="block">{d.error ?? d.detail}</pre>;
  if (e.type === "message" && d.text && d.text.length > 300) return <div className="md small">{d.text}</div>;
  if (e.type === "approval" && d.actions) return <pre className="block">{JSON.stringify(d.actions, null, 2)}</pre>;
  if (e.type === "approval" && d.details) return <pre className="block">{JSON.stringify(d.details, null, 2)}</pre>;
  if (e.type === "knowledge" && d.sources) return <pre className="block">{d.sources.map((s: any) => `${s.source} / ${s.document}  (score ${s.score})`).join("\n") || "no hits"}</pre>;
  if (e.type === "artifact" && d.files) return <pre className="block">{d.files.join("\n")}</pre>;
  if (e.type === "status" && d.error) return <pre className="block">{JSON.stringify(d.error, null, 2)}</pre>;
  return null;
}

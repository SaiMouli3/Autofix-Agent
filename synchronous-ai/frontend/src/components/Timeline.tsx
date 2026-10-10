/** Execution timeline: persisted, redacted runtime events in order. Never shows model reasoning. */
import { Ban, BookOpen, Check, Globe, ChevronDown, ChevronRight, CircleDot, FileOutput, GitBranch, MessageSquare, Pause, Plug, Wrench, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { clock, fullDateTime } from "../lib/format";
import { ActivityEvent } from "../lib/stream";

function describe(e: ActivityEvent): { mark: string; icon: any; label: string } {
  const d = e.data ?? {};
  switch (e.type) {
    case "status": {
      const st = d.status;
      if (st === "completed") return { mark: "ok", icon: Check, label: "Completed" };
      if (st === "failed" || st === "timed_out") return { mark: "bad", icon: X, label: st === "timed_out" ? "Timed out" : "Failed" };
      if (st === "cancelled") return { mark: "", icon: Ban, label: "Cancelled" };
      if (st === "queued") return { mark: "", icon: CircleDot, label: "Queued" };
      return { mark: "", icon: CircleDot, label: "Status" };
    }
    case "tool_call": return { mark: "tool", icon: Wrench, label: d.tool ?? "Tool" };
    case "tool_result": return { mark: d.is_error ? "bad" : "", icon: d.is_error ? X : Check, label: "Result" };
    case "tool_error": case "error": return { mark: "bad", icon: X, label: "Error" };
    case "tool_rejected": return { mark: "bad", icon: Ban, label: "Rejected" };
    case "approval": return { mark: "wait", icon: Pause, label: "Approval" };
    case "message": return { mark: "out", icon: MessageSquare, label: "Response" };
    case "knowledge": return { mark: "tool", icon: BookOpen, label: "Knowledge" };
    case "web": return { mark: "tool", icon: Globe, label: "Web" };
    case "delegation": return { mark: "tool", icon: GitBranch, label: "Delegation" };
    case "integration": return { mark: "tool", icon: Plug, label: "Integration" };
    case "artifact": return { mark: "out", icon: FileOutput, label: "Files" };
    default: return { mark: "", icon: CircleDot, label: e.type };
  }
}

function detail(e: ActivityEvent) {
  const d = e.data ?? {};
  if (e.type === "tool_call" && d.args && Object.keys(d.args).length)
    return d.tool === "terminal" && d.args.command ? <pre className="code">$ {d.args.command}</pre> : <pre className="code">{JSON.stringify(d.args, null, 2)}</pre>;
  if (e.type === "tool_result" && d.output) return <pre className="code">{d.output}</pre>;
  if ((e.type === "tool_error" || e.type === "error") && (d.error || d.detail)) return <pre className="code">{d.error ?? d.detail}</pre>;
  if (e.type === "message" && d.text) return <div className="prose small">{d.text}</div>;
  if (e.type === "approval" && (d.actions || d.details)) return <pre className="code">{JSON.stringify(d.actions ?? d.details, null, 2)}</pre>;
  if (e.type === "web" && d.sources?.length) return <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{d.sources.map((s: any, i: number) => <li key={i}><a href={s.url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)" }}>{s.title || s.url}</a></li>)}</ul>;
  if (e.type === "knowledge" && d.sources?.length) return <pre className="code">{d.sources.map((s: any) => `${s.source} / ${s.document}   score ${s.score}`).join("\n")}</pre>;
  if (e.type === "artifact" && d.files) return <pre className="code">{d.files.join("\n")}</pre>;
  if (e.type === "status" && d.error) return <pre className="code">{d.error.code}: {d.error.message}</pre>;
  return null;
}

export function Timeline({ events, agentNames, compact }: { events: ActivityEvent[]; agentNames?: Record<string, string>; compact?: boolean }) {
  if (!events.length) return <p className="muted small" style={{ margin: 0 }}>No execution events yet. Events appear here as the agent works.</p>;
  return (
    <ol className="tl" aria-label="Execution events">
      {events.map((e) => <Item key={e.id} e={e} agentName={agentNames?.[e.agent_id]} compact={compact} />)}
    </ol>
  );
}

function Item({ e, agentName, compact }: { e: ActivityEvent; agentName?: string; compact?: boolean }) {
  const [open, setOpen] = useState(e.type === "approval" && e.data?.status === "waiting_for_approval");
  const { mark, icon: Icon, label } = describe(e);
  const body = detail(e);
  const risk = e.type === "tool_call" && e.data?.risk && e.data.risk !== "UNKNOWN" ? String(e.data.risk).toLowerCase() : null;
  return (
    <li className="tl-item">
      <time className="tl-time" dateTime={e.ts} title={fullDateTime(e.ts)}>{clock(e.ts)}</time>
      <span className={`tl-mark ${mark}`} aria-hidden><Icon /></span>
      <div className="tl-body">
        <div className="tl-title">
          {agentName && <b className="small">{agentName}</b>}
          <span className="tag mono">{label}</span>
          {risk && <span className={`tag ${risk === "high" ? "danger" : risk === "medium" ? "warning" : ""}`}>{risk} risk</span>}
          <span className="what" style={compact ? { fontSize: 12.5 } : undefined}>{e.summary}</span>
        </div>
        <div className="row mt4" style={{ gap: 10 }}>
          {body && (
            <button className="disclose" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? <ChevronDown /> : <ChevronRight />} {open ? "Hide details" : "Details"}
            </button>
          )}
          {e.data?.child_task_id && <Link className="disclose" to={`/tasks/${e.data.child_task_id}`}>Open sub-task →</Link>}
          {e.type === "approval" && e.data?.status === "waiting_for_approval" && <Link className="disclose" to="/approvals" style={{ color: "var(--warning)" }}>Review approval →</Link>}
        </div>
        {open && body && <div className="tl-detail">{body}</div>}
      </div>
    </li>
  );
}

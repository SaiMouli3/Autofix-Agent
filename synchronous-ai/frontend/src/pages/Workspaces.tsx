import { useQuery } from "@tanstack/react-query";
import { FolderKanban } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { FilesBrowser } from "../components/FilesBrowser";
import { Shell } from "../components/Shell";
import { Empty, ErrorBox, Loading, StatusBadge } from "../components/ui";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";

export default function Workspaces() {
  const [agentId, setAgentId] = useState("");
  const [sel, setSel] = useState("");
  const agents = useQuery({ queryKey: ["agents", "all"], queryFn: () => api.get("/api/agents?page_size=500") });
  const sessions = useQuery({ queryKey: ["sessions", "all", agentId], queryFn: () => api.get(`/api/sessions?page_size=100${agentId ? `&agent_id=${agentId}` : ""}`), refetchInterval: 10000 });
  const list = sessions.data?.items ?? [];
  const current = list.find((s: any) => s.id === sel) ?? list[0];
  return (
    <Shell title="Agent Workspaces">
      <div className="page-head"><div><h1>Agent workspaces</h1><p>Each execution session has its own workspace directory (a sandbox container in Docker mode). Agents cannot read other sessions' files.</p></div></div>
      <div className="filters">
        <select value={agentId} onChange={(e) => { setAgentId(e.target.value); setSel(""); }} aria-label="Agent">
          <option value="">All agents</option>
          {(agents.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <ErrorBox error={sessions.error} />
      {sessions.isLoading && <Loading />}
      {sessions.data && list.length === 0 && <div className="card"><Empty icon={FolderKanban} title="No workspaces yet">Workspaces are created when agents start executing tasks.</Empty></div>}
      {list.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: "340px minmax(0,1fr)", alignItems: "start" }}>
          <div className="card flush" style={{ maxHeight: 640, overflow: "auto" }}>
            {list.map((s: any) => (
              <div key={s.id} className={`file-row ${current?.id === s.id ? "on" : ""}`} onClick={() => setSel(s.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setSel(s.id)}>
                <span className={`status-dot ${s.active ? "running" : s.status === "active" ? "completed" : "disabled"}`} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <div className="small strong ellipsis">{s.title || "Session"}</div>
                  <div className="faint tiny">{s.agent_name} · {s.runtime} · {s.task_count} task(s) · {timeAgo(s.last_active_at)}</div>
                </span>
              </div>
            ))}
          </div>
          {current && (
            <div className="card flush">
              <div className="card-head">
                <div><b>{current.title || "Session"}</b><div className="faint tiny"><Link to={`/agents/${current.agent_id}`}>{current.agent_name}</Link> · {current.runtime} runtime · created {timeAgo(current.created_at)}</div></div>
                <StatusBadge status={current.active ? "running" : current.status === "active" ? "idle" : "disabled"} label={current.active ? "Executing" : current.continuable ? "Continuable" : "Closed"} />
              </div>
              <FilesBrowser sessionId={current.id} />
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

import { useQuery } from "@tanstack/react-query";
import { FolderKanban } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { BotMark } from "../components/BotMark";
import { FilesBrowser } from "../components/FilesBrowser";
import { Shell } from "../components/Shell";
import { Empty, ErrorState, SkeletonRows, Status } from "../components/ui";
import { api, qs } from "../lib/api";
import { timeAgo } from "../lib/format";

/** Per-session agent workspaces. Each execution session has its own directory (a sandbox
 *  container in Docker mode); files are read through the API, never from the host directly. */
export default function Workspaces() {
  const [sp, setSp] = useSearchParams();
  const agentId = sp.get("agent") ?? "";
  const sel = sp.get("session") ?? "";
  const agents = useQuery({ queryKey: ["agents", "all"], queryFn: ({ signal }) => api.get("/api/agents?page_size=500", signal) });
  const sessions = useQuery({
    queryKey: ["sessions", "all", agentId],
    queryFn: ({ signal }) => api.get(`/api/sessions${qs({ page_size: 100, agent_id: agentId })}`, signal),
    refetchInterval: 10000,
  });
  const list: any[] = sessions.data?.items ?? [];
  const current = list.find((s) => s.id === sel) ?? list[0];
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k === "agent") n.delete("session"); setSp(n, { replace: true }); };
  const state = (s: any) => (s.active ? "running" : s.continuable ? "idle" : "disabled");
  return (
    <Shell crumbs={[{ label: "Workspaces" }]}>
      <div className="page-head">
        <div><h1>Workspaces</h1><p>Files agents produced, per execution session. Sessions are isolated from each other; agents cannot read another session's files.</p></div>
        <div>
          <label className="sr-only" htmlFor="ws-agent">Agent</label>
          <select id="ws-agent" value={agentId} onChange={(e) => set("agent", e.target.value)} style={{ width: 220 }}>
            <option value="">All agents</option>
            {(agents.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      {sessions.isLoading && <div className="panel"><SkeletonRows rows={5} /></div>}
      <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} what="workspaces" />
      {sessions.data && list.length === 0 && <div className="panel"><Empty icon={FolderKanban} title="No workspaces yet">A workspace is created when an agent starts its first task.</Empty></div>}
      {list.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: "minmax(240px, 320px) minmax(0, 1fr)", alignItems: "start" }}>
          <nav className="panel" aria-label="Sessions" style={{ maxHeight: 640, overflow: "auto" }}>
            {list.map((s) => (
              <button key={s.id} className={`list-row ${current?.id === s.id ? "sel" : ""}`} aria-current={current?.id === s.id ? "true" : undefined} onClick={() => set("session", s.id)}>
                <BotMark seed={s.agent_id} size={22} state={s.active ? "running" : undefined} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="small strong ellipsis" style={{ display: "block" }}>{s.title || "Untitled session"}</span>
                  <span className="tiny muted">{s.agent_name} · {s.task_count} task{s.task_count === 1 ? "" : "s"} · {timeAgo(s.last_active_at)}</span>
                </span>
              </button>
            ))}
          </nav>
          {current && (
            <section className="panel" aria-label="Workspace files">
              <div className="panel-head">
                <div style={{ minWidth: 0 }}>
                  <h2 className="ellipsis">{current.title || "Untitled session"}</h2>
                  <div className="tiny muted"><Link to={`/agents/${current.agent_id}?session=${current.id}`} style={{ color: "var(--accent)" }}>{current.agent_name}</Link> · {current.runtime} runtime · created {timeAgo(current.created_at)}</div>
                </div>
                <Status status={state(current)} label={current.active ? "Executing" : current.continuable ? "Continuable" : "Closed"} />
              </div>
              <FilesBrowser key={current.id} sessionId={current.id} />
            </section>
          )}
        </div>
      )}
    </Shell>
  );
}

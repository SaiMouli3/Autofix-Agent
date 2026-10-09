import { useQuery } from "@tanstack/react-query";
import { Bot, LayoutGrid, List, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { AgentAvatar, Empty, ErrorBox, Loading, Pager, StatusBadge } from "../components/ui";
import { api, qs } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useSession } from "../lib/session";

export default function Agents() {
  const { can } = useSession();
  const nav = useNavigate();
  return (
    <Shell title="My Agents">
      <div className="page-head">
        <div>
          <h1>Agents</h1>
          <p>Each agent is a persistent, versioned configuration with its own model, tools, knowledge and policies. Tasks run as independent executions.</p>
        </div>
        {can("agents:write") && <button className="btn primary" onClick={() => nav("/agents/new")}><Plus /> Create agent</button>}
      </div>
      <AgentDirectory />
    </Shell>
  );
}

const PAGE = 24;

export function AgentDirectory({ compact }: { compact?: boolean }) {
  const { can } = useSession();
  const nav = useNavigate();
  const [view, setView] = useState<"grid" | "list">(() => (localStorage.getItem("sca.view") as any) || "grid");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [teamId, setTeamId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const params = { q, status, category, team_id: teamId, owner_id: ownerId, sort, page, page_size: PAGE };
  const agents = useQuery({ queryKey: ["agents", params], queryFn: () => api.get(`/api/agents${qs(params)}`), refetchInterval: 10000 });
  const all = useQuery({ queryKey: ["agents", "all-cats"], queryFn: () => api.get("/api/agents?page_size=500") });
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api.get("/api/teams") });
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get("/api/users") });
  const categories = Array.from(new Set((all.data?.items ?? []).map((a: any) => a.category))).sort() as string[];
  const setV = (v: "grid" | "list") => { setView(v); try { localStorage.setItem("sca.view", v); } catch { /* storage unavailable */ } };
  const reset = (fn: (v: any) => void) => (e: any) => { fn(e.target.value); setPage(1); };

  return (
    <div>
      <div className="filters">
        <input placeholder="Search agents…" value={q} onChange={reset(setQ)} aria-label="Search agents" style={{ minWidth: 220 }} />
        <select value={status} onChange={reset(setStatus)} aria-label="Status filter">
          <option value="">All statuses</option>
          {["active", "draft", "disabled", "running", "queued", "waiting_for_approval", "idle", "failed"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <select value={category} onChange={reset(setCategory)} aria-label="Category filter">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={teamId} onChange={reset(setTeamId)} aria-label="Team filter">
          <option value="">All teams</option>
          {(teams.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={ownerId} onChange={reset(setOwnerId)} aria-label="Owner filter">
          <option value="">All owners</option>
          {(users.data ?? []).map((u: any) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="name">Sort: name</option>
          <option value="updated">Sort: recently updated</option>
          <option value="created">Sort: newest</option>
        </select>
        <div className="seg" style={{ marginLeft: "auto" }}>
          <button className={view === "grid" ? "on" : ""} onClick={() => setV("grid")} aria-label="Grid view"><LayoutGrid /></button>
          <button className={view === "list" ? "on" : ""} onClick={() => setV("list")} aria-label="List view"><List /></button>
        </div>
      </div>
      <ErrorBox error={agents.error} />
      {agents.isLoading && <Loading />}
      {agents.data && agents.data.items.length === 0 && (
        <div className="card">
          <Empty icon={Bot} title={q || status || category ? "No agents match these filters" : "Create your first agent"}
            action={can("agents:write") && !q ? <Link className="btn primary" to="/agents/new"><Plus /> Create agent</Link> : undefined}>
            Agents are specialized AI workers. Start from a template such as Research, Sales or Software Engineering.
          </Empty>
        </div>
      )}
      {agents.data && agents.data.items.length > 0 && view === "grid" && (
        <div className="grid cards">
          {agents.data.items.map((a: any) => <AgentCard key={a.id} a={a} />)}
        </div>
      )}
      {agents.data && agents.data.items.length > 0 && view === "list" && (
        <div className="card flush">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Agent</th><th>Category</th><th>Status</th><th>Running</th><th>Completed</th><th>Failed</th><th>Version</th><th>Updated</th></tr></thead>
              <tbody>
                {agents.data.items.map((a: any) => (
                  <tr key={a.id} className="click" onClick={() => nav(`/agents/${a.id}`)}>
                    <td><div className="row"><AgentAvatar avatar={a.avatar} size="sm" /><b>{a.name}</b></div></td>
                    <td>{a.category}</td>
                    <td><StatusBadge status={a.live_status} /></td>
                    <td>{a.task_counts.running ?? 0}</td>
                    <td>{a.task_counts.completed ?? 0}</td>
                    <td>{(a.task_counts.failed ?? 0) + (a.task_counts.timed_out ?? 0)}</td>
                    <td>v{a.current_version}</td>
                    <td className="faint">{timeAgo(a.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {agents.data && agents.data.total > PAGE && !compact && (
        <Pager page={page} pageSize={PAGE} total={agents.data.total} onPage={setPage} />
      )}
      {agents.data && agents.data.total > PAGE && compact && (
        <div className="mt8 right"><Link to="/agents" className="btn sm">View all {agents.data.total} agents</Link></div>
      )}
    </div>
  );
}

function AgentCard({ a }: { a: any }) {
  const c = a.task_counts ?? {};
  return (
    <Link to={`/agents/${a.id}`} className="card hover" style={{ display: "block" }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <AgentAvatar avatar={a.avatar} size="lg" status={a.live_status} />
        <div className="grow">
          <div className="row between">
            <b style={{ fontSize: 15 }} className="ellipsis">{a.name}</b>
            <StatusBadge status={a.live_status} />
          </div>
          <div className="faint small">{a.category} · v{a.current_version}</div>
        </div>
      </div>
      <p className="muted small" style={{ minHeight: 40, margin: "12px 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {a.description || "No description."}
      </p>
      <div className="row small faint" style={{ gap: 14 }}>
        <span><b className="muted">{c.running ?? 0}</b> running</span>
        <span><b className="muted">{c.queued ?? 0}</b> queued</span>
        <span><b className="muted">{c.completed ?? 0}</b> done</span>
        {a.pending_approvals > 0 && <span className="badge waiting_for_approval">{a.pending_approvals} approval</span>}
      </div>
      {a.tags?.length > 0 && <div className="pill-list mt8">{a.tags.map((t: string) => <span key={t} className="badge outline">{t}</span>)}</div>}
    </Link>
  );
}

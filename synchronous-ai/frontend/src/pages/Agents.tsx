import { useQuery } from "@tanstack/react-query";
import { Bot, LayoutGrid, List, Plus } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { BotMark } from "../components/BotMark";
import { Shell } from "../components/Shell";
import { Empty, ErrorState, Pager, SearchField, SkeletonRows, SortHeader, Status } from "../components/ui";
import { api, qs } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useDebounced, usePref } from "../lib/prefs";
import { useSession } from "../lib/session";

const PAGE = 30;

export default function Agents() {
  const { can } = useSession();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [view, setView] = usePref<"table" | "grid">("agents.view", "table");
  const q = sp.get("q") ?? "";
  const status = sp.get("status") ?? "";
  const category = sp.get("category") ?? "";
  const teamId = sp.get("team") ?? "";
  const sort = (sp.get("sort") as any) || "name";
  const page = Number(sp.get("page") ?? 1);
  const dq = useDebounced(q, 250);
  const set = (patch: Record<string, string>) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    if (!("page" in patch)) n.delete("page");
    setSp(n, { replace: true });
  };
  const params = { q: dq, status, category, team_id: teamId, sort, page, page_size: PAGE };
  const agents = useQuery({ queryKey: ["agents", "dir", params], queryFn: ({ signal }) => api.get(`/api/agents${qs(params)}`, signal), refetchInterval: 15000, placeholderData: (p) => p });
  const all = useQuery({ queryKey: ["agents", "nav"], queryFn: ({ signal }) => api.get("/api/agents?page_size=500", signal) });
  const teams = useQuery({ queryKey: ["teams"], queryFn: ({ signal }) => api.get("/api/teams", signal) });
  const categories = Array.from(new Set((all.data?.items ?? []).map((a: any) => a.category))).sort() as string[];
  const items: any[] = agents.data?.items ?? [];
  const teamName = (id: string) => (teams.data ?? []).find((t: any) => t.id === id)?.name;

  return (
    <Shell crumbs={[{ label: "Agents" }]}>
      <div className="page-head">
        <div>
          <h1>Agents</h1>
          <p>Persistent, versioned agent profiles. Each runs tasks independently with its own model, tools, knowledge and policies.</p>
        </div>
        {can("agents:write") && <button className="btn primary" onClick={() => nav("/agents/new")}><Plus /> Create agent</button>}
      </div>
      <div className="filters">
        <SearchField value={q} onChange={(v) => set({ q: v })} placeholder="Search name or description" label="Search agents" />
        <select value={status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Active</option><option value="draft">Draft</option><option value="disabled">Disabled</option>
          <option value="running">Running now</option><option value="waiting_for_approval">Needs approval</option><option value="failed">Last run failed</option>
        </select>
        <select value={category} onChange={(e) => set({ category: e.target.value })} aria-label="Category">
          <option value="">Any category</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={teamId} onChange={(e) => set({ team: e.target.value })} aria-label="Team">
          <option value="">Any team</option>
          {(teams.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="grow" />
        <div className="seg" role="group" aria-label="Layout">
          <button aria-pressed={view === "table"} onClick={() => setView("table")}><List /> Table</button>
          <button aria-pressed={view === "grid"} onClick={() => setView("grid")}><LayoutGrid /> Cards</button>
        </div>
      </div>
      <div className="panel">
        {agents.isLoading && <SkeletonRows rows={6} />}
        {agents.isError && <div className="panel-body"><ErrorState error={agents.error} onRetry={() => agents.refetch()} what="agents" /></div>}
        {agents.data && items.length === 0 && (
          <Empty icon={Bot} title={q || status || category || teamId ? "No agents match these filters" : "No agents yet"}
            action={can("agents:write") && !q ? <Link className="btn primary" to="/agents/new"><Plus /> Create agent</Link> : undefined}>
            {q || status || category ? "Clear filters to see every agent." : "Start from a template such as Research, Sales or Software Engineering."}
          </Empty>
        )}
        {items.length > 0 && view === "table" && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Agent" k="name" sort={sort} order="asc" onSort={() => set({ sort: "name" })} />
                  <th scope="col">Status</th>
                  <th scope="col" className="hide-sm">Category</th>
                  <th scope="col" className="hide-sm">Team</th>
                  <th scope="col" className="right">Running</th>
                  <th scope="col" className="right hide-sm">Completed</th>
                  <th scope="col" className="right hide-sm">Failed</th>
                  <SortHeader label="Updated" k="updated" sort={sort} order="desc" onSort={() => set({ sort: "updated" })} />
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="click" onClick={() => nav(`/agents/${a.id}`)}>
                    <td>
                      <Link to={`/agents/${a.id}`} className="row" onClick={(e) => e.stopPropagation()}>
                        <BotMark seed={a.id} avatar={a.avatar} size={26} state={a.status !== "active" ? a.status : a.live_status} />
                        <span style={{ minWidth: 0 }}>
                          <span className="strong" style={{ display: "block" }}>{a.name}</span>
                          <span className="tiny muted ellipsis" style={{ display: "block", maxWidth: 360 }}>{a.description || "No description"}</span>
                        </span>
                      </Link>
                    </td>
                    <td><Status status={a.status !== "active" ? a.status : a.live_status} /></td>
                    <td className="hide-sm">{a.category}</td>
                    <td className="hide-sm muted">{teamName(a.team_id) ?? "—"}</td>
                    <td className="right num">{a.task_counts.running ?? 0}</td>
                    <td className="right num hide-sm">{a.task_counts.completed ?? 0}</td>
                    <td className="right num hide-sm">{(a.task_counts.failed ?? 0) + (a.task_counts.timed_out ?? 0)}</td>
                    <td className="muted nowrap">{timeAgo(a.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {items.length > 0 && view === "grid" && (
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", padding: 16, gap: 12 }}>
            {items.map((a) => (
              <Link key={a.id} to={`/agents/${a.id}`} className="panel" style={{ padding: 14, display: "block" }}>
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <BotMark seed={a.id} avatar={a.avatar} size={34} state={a.status !== "active" ? a.status : a.live_status} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="strong ellipsis">{a.name}</div>
                    <div className="tiny muted">{a.category} · v{a.current_version}</div>
                  </div>
                  <Status status={a.status !== "active" ? a.status : a.live_status} />
                </div>
                <p className="small muted" style={{ margin: "10px 0", minHeight: 38, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{a.description || "No description."}</p>
                <div className="row tiny muted" style={{ gap: 12 }}>
                  <span className="num">{a.task_counts.running ?? 0} running</span>
                  <span className="num">{a.task_counts.completed ?? 0} completed</span>
                  {a.pending_approvals > 0 && <span className="tag warning">{a.pending_approvals} approval</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
        {agents.data && agents.data.total > PAGE && <Pager page={page} pageSize={PAGE} total={agents.data.total} onPage={(p) => set({ page: String(p) })} />}
      </div>
    </Shell>
  );
}

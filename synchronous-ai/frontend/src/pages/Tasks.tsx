import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ClipboardList } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Empty, ErrorState, Pager, SearchField, SkeletonRows, SortHeader, Status, useConfirm, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { dateTime, duration, fullDateTime } from "../lib/format";
import { useDebounced } from "../lib/prefs";
import { useSession } from "../lib/session";
import { ACTIVE_TASK_STATES, FAILURE } from "../lib/status";

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "running", label: "Running" },
  { key: "queued", label: "Queued" },
  { key: "waiting_for_approval", label: "Needs approval" },
  { key: "completed", label: "Completed" },
  { key: "failed,timed_out", label: "Failed" },
  { key: "cancelled", label: "Cancelled" },
];
const SINCE: Record<string, number> = { "24h": 24, "7d": 168, "30d": 720 };
const PAGE = 25;

export default function Tasks() {
  const { can } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const get = (k: string, d = "") => sp.get(k) ?? d;
  const set = (patch: Record<string, string>) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    if (!("page" in patch)) n.delete("page");
    setSp(n, { replace: true });
  };
  const status = get("status"), agent = get("agent"), since = get("since"), from = get("from"), to = get("to");
  const sort = get("sort", "created"), order = (get("order", "desc") as "asc" | "desc"), page = Number(get("page", "1"));
  const mine = get("mine") === "1";
  const q = useDebounced(get("q"), 250);
  const createdAfter = from ? new Date(from).toISOString() : SINCE[since] ? new Date(Date.now() - SINCE[since] * 3600_000).toISOString() : undefined;
  const createdBefore = to ? new Date(`${to}T23:59:59`).toISOString() : undefined;
  const params = { status, agent_id: agent, q, sort, order, page, page_size: PAGE, top_level: get("sub") !== "1", created_after: createdAfter, created_before: createdBefore, requested_by: mine ? "me" : undefined };
  const tasks = useQuery({ queryKey: ["tasks", "list", params], queryFn: ({ signal }) => api.get(`/api/tasks${qs(params)}`, signal), refetchInterval: 6000, placeholderData: (p) => p });
  const agents = useQuery({ queryKey: ["agents", "nav"], queryFn: ({ signal }) => api.get("/api/agents?page_size=500", signal) });
  const [selected, setSelected] = useState<string[]>([]);
  const items: any[] = tasks.data?.items ?? [];
  const cancellable = items.filter((t) => ACTIVE_TASK_STATES.includes(t.status));
  const sel = selected.filter((id) => cancellable.some((t) => t.id === id));
  const onSort = (k: string) => set({ sort: k, order: sort === k && order === "desc" ? "asc" : "desc" });
  const bulkCancel = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => api.post(`/api/tasks/${id}/cancel`)));
      return { ok: results.filter((r) => r.status === "fulfilled").length, failed: results.filter((r) => r.status === "rejected").length };
    },
    onSuccess: (r) => { setSelected([]); qc.invalidateQueries({ queryKey: ["tasks"] }); toast(r.failed ? "error" : "ok", `${r.ok} cancellation(s) requested${r.failed ? `, ${r.failed} failed` : ""}`); },
  });

  return (
    <Shell crumbs={[{ label: "Tasks" }]}>
      <div className="page-head">
        <div><h1>Tasks</h1><p>Every execution across agents, with its status, timing, requester and outcome.</p></div>
      </div>
      <div className="filters" role="group" aria-label="Status">
        {STATUS_FILTERS.map((f) => <button key={f.key} className="chip-btn" aria-pressed={status === f.key} onClick={() => set({ status: f.key })}>{f.label}</button>)}
      </div>
      <div className="filters">
        <SearchField value={get("q")} onChange={(v) => set({ q: v })} placeholder="Search title or instructions" label="Search tasks" />
        <select value={agent} onChange={(e) => set({ agent: e.target.value })} aria-label="Agent">
          <option value="">All agents</option>
          {(agents.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={from || to ? "custom" : since} onChange={(e) => set(e.target.value === "custom" ? { since: "", from: new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10) } : { since: e.target.value, from: "", to: "" })} aria-label="Created">
          <option value="">Any time</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom range…</option>
        </select>
        {(from || to) && (
          <>
            <input type="date" value={from} onChange={(e) => set({ from: e.target.value })} aria-label="Created from" style={{ minWidth: 0, width: 150 }} />
            <span className="muted small">to</span>
            <input type="date" value={to} onChange={(e) => set({ to: e.target.value })} aria-label="Created to" style={{ minWidth: 0, width: 150 }} />
          </>
        )}
        <label className="check small"><input type="checkbox" checked={mine} onChange={(e) => set({ mine: e.target.checked ? "1" : "" })} /> Requested by me</label>
        <label className="check small"><input type="checkbox" checked={get("sub") === "1"} onChange={(e) => set({ sub: e.target.checked ? "1" : "" })} /> Include delegated sub-tasks</label>
      </div>
      {sel.length > 0 && can("tasks:cancel") && (
        <div className="alert neutral" style={{ marginBottom: 12 }}>
          <span className="grow small"><b>{sel.length}</b> active task(s) selected</span>
          <button className="btn xs" onClick={() => setSelected([])}>Clear</button>
          <button className="btn xs danger" disabled={bulkCancel.isPending} onClick={async () => {
            if (await confirm({ title: `Cancel ${sel.length} task(s)?`, body: "Each execution stops at its next step. Work already done is kept.", confirmLabel: "Cancel tasks", danger: true })) bulkCancel.mutate(sel);
          }}><Ban /> Cancel selected</button>
        </div>
      )}
      <div className="panel">
        {tasks.isLoading && <SkeletonRows rows={8} />}
        {tasks.isError && <div className="panel-body"><ErrorState error={tasks.error} onRetry={() => tasks.refetch()} what="tasks" /></div>}
        {tasks.data && items.length === 0 && <Empty icon={ClipboardList} title="No tasks match">Adjust the filters, or assign a task from an agent's workspace.</Empty>}
        {items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {can("tasks:cancel") && <th scope="col" style={{ width: 32 }}><span className="sr-only">Select</span></th>}
                  <SortHeader label="Task" k="title" sort={sort} order={order} onSort={onSort} />
                  <th scope="col">Agent</th>
                  <SortHeader label="Status" k="status" sort={sort} order={order} onSort={onSort} />
                  <SortHeader label="Priority" k="priority" sort={sort} order={order} onSort={onSort} />
                  <th scope="col" className="hide-sm">Created by</th>
                  <SortHeader label="Created" k="created" sort={sort} order={order} onSort={onSort} />
                  <th scope="col" className="right">Duration</th>
                  <SortHeader label="Completed" k="finished" sort={sort} order={order} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {items.map((t) => {
                  const active = ACTIVE_TASK_STATES.includes(t.status);
                  const f = t.error_category && t.status !== "completed" ? FAILURE[t.error_category] : null;
                  return (
                    <tr key={t.id} className={`click ${selected.includes(t.id) ? "sel" : ""}`} onClick={() => nav(`/tasks/${t.id}`)}>
                      {can("tasks:cancel") && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" disabled={!active} checked={selected.includes(t.id)} aria-label={`Select ${t.title}`} title={active ? undefined : "Only active tasks can be cancelled"}
                            onChange={(e) => setSelected(e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id))} />
                        </td>
                      )}
                      <td className="title-cell">
                        <Link to={`/tasks/${t.id}`} className="strong ellipsis" style={{ display: "block" }} onClick={(e) => e.stopPropagation()}>{t.title}</Link>
                        <span className="tiny muted">{f ? f.label : t.parent_task_id ? "Delegated sub-task" : t.schedule_id ? "Scheduled" : <span className="mono">{t.id.slice(0, 8)}</span>}</span>
                      </td>
                      <td className="nowrap"><Link to={`/agents/${t.agent_id}`} onClick={(e) => e.stopPropagation()}>{t.agent_name}</Link></td>
                      <td><Status status={t.status} /></td>
                      <td className="num">{t.priority}</td>
                      <td className="hide-sm muted nowrap">{t.requested_by_name ?? (t.requested_by_agent_id ? "Agent" : t.schedule_id ? "Schedule" : "—")}</td>
                      <td className="nowrap muted" title={fullDateTime(t.created_at)}>{dateTime(t.created_at)}</td>
                      <td className="right num nowrap">{duration(t.duration_s)}</td>
                      <td className="nowrap muted" title={fullDateTime(t.finished_at)}>{t.finished_at ? dateTime(t.finished_at) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {tasks.data && <Pager page={page} pageSize={PAGE} total={tasks.data.total} onPage={(p) => set({ page: String(p) })} />}
      </div>
    </Shell>
  );
}

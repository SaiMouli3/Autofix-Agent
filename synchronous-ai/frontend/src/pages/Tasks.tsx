import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shell } from "../components/Shell";
import { ErrorBox, Loading, Pager } from "../components/ui";
import { api, qs } from "../lib/api";
import { TaskTable } from "./AgentWorkspace";

export default function Tasks() {
  const nav = useNavigate();
  const [status, setStatus] = useState("");
  const [agentId, setAgentId] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [topLevel, setTopLevel] = useState(true);
  const agents = useQuery({ queryKey: ["agents", "all"], queryFn: () => api.get("/api/agents?page_size=500") });
  const params = { status, agent_id: agentId, q, page, page_size: 30, top_level: topLevel };
  const tasks = useQuery({ queryKey: ["tasks", params], queryFn: () => api.get(`/api/tasks${qs(params)}`), refetchInterval: 5000 });
  return (
    <Shell title="Tasks">
      <div className="page-head">
        <div><h1>Tasks</h1><p>Every execution across all agents, with durable status, timing, usage and outcome.</p></div>
      </div>
      <div className="filters">
        <input placeholder="Search tasks…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search tasks" style={{ minWidth: 240 }} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">All statuses</option>
          {["active", "queued", "running", "waiting_for_approval", "completed", "failed", "timed_out", "cancelled"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <select value={agentId} onChange={(e) => { setAgentId(e.target.value); setPage(1); }} aria-label="Agent">
          <option value="">All agents</option>
          {(agents.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <label className="check small"><input type="checkbox" checked={!topLevel} onChange={(e) => setTopLevel(!e.target.checked)} /> include delegated sub-tasks</label>
      </div>
      <ErrorBox error={tasks.error} />
      <div className="card flush">
        {tasks.isLoading ? <Loading /> : <TaskTable items={tasks.data?.items ?? []} onOpen={(id) => nav(`/tasks/${id}`)} showAgent />}
        {tasks.data && <Pager page={page} pageSize={30} total={tasks.data.total} onPage={setPage} />}
      </div>
    </Shell>
  );
}

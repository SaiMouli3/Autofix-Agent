import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Empty, ErrorBox, Loading, Notice, Pager, StatusBadge, Tabs, useToast } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, timeAgo } from "../lib/format";
import { useSession } from "../lib/session";

export default function Approvals() {
  const { can, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<"pending" | "">("pending");
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ["approvals", tab, page], queryFn: () => api.get(`/api/approvals?status=${tab}&page=${page}&page_size=25`), refetchInterval: 4000 });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: string }) => api.post(`/api/approvals/${id}/decide`, { decision, note: notes[id] ?? "" }),
    onSuccess: (r) => { toast("ok", `${r.decision_note ? "Decision recorded" : r.status === "approved" ? "Approved" : "Rejected"} — ${r.agent_name}`); qc.invalidateQueries({ queryKey: ["approvals"] }); qc.invalidateQueries({ queryKey: ["approvals-count"] }); },
    onError: (e: any) => toast("error", e.message),
  });
  const distinct = me.org.settings?.require_distinct_approver;
  return (
    <Shell title="Approvals">
      <div className="page-head"><div><h1>Approvals</h1><p>Agents pause before sensitive actions until a human decides. Agents can never approve their own actions.{distinct ? " Organization policy requires a different person than the task requester." : ""}</p></div></div>
      <Tabs value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={[{ key: "pending", label: "Pending", count: tab === "pending" ? list.data?.total : undefined }, { key: "", label: "All decisions" }]} />
      {!can("approvals:decide") && <div className="mb16"><Notice>Your role can view approval requests but not decide them.</Notice></div>}
      <ErrorBox error={list.error} />
      {list.isLoading && <Loading />}
      {list.data?.items?.length === 0 && <div className="card"><Empty icon={ShieldCheck} title={tab === "pending" ? "Nothing waiting for approval" : "No approval history"}>Requests appear here when an agent's policy requires human sign-off.</Empty></div>}
      <div className="stack">
        {list.data?.items?.map((a: any) => (
          <div className="card" key={a.id}>
            <div className="row between">
              <div className="row"><StatusBadge status={a.status} /><b>{a.agent_name}</b><span className="faint small">wants to</span><span className="badge outline">{a.kind.replace("_", " ")}</span></div>
              <span className="faint small">{timeAgo(a.requested_at)} · expires {dateTime(a.expires_at)}</span>
            </div>
            <div className="mt8">{a.summary}</div>
            <div className="faint small mt8">Task: <Link to={`/tasks/${a.task_id}`} style={{ color: "var(--accent)" }}>{a.task_title}</Link></div>
            <details className="mt8" open={a.status === "pending"}>
              <summary className="small muted" style={{ cursor: "pointer" }}>Exact action details</summary>
              <pre className="block mt8">{JSON.stringify(a.details, null, 2)}</pre>
            </details>
            {a.status === "pending" && can("approvals:decide") && (
              <div className="row mt16">
                <input placeholder="Decision note (shared with the agent if rejected)" value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                <button className="btn danger" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, decision: "rejected" })}><X /> Reject</button>
                <button className="btn success" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, decision: "approved" })}><Check /> Approve</button>
              </div>
            )}
            {a.status !== "pending" && <div className="faint small mt8">{a.decided_by ? `Decided by ${a.decided_by}` : "Closed"} {a.decided_at ? `· ${dateTime(a.decided_at)}` : ""} {a.decision_note ? `· “${a.decision_note}”` : ""}</div>}
          </div>
        ))}
      </div>
      {list.data && list.data.total > 25 && <Pager page={page} pageSize={25} total={list.data.total} onPage={setPage} />}
    </Shell>
  );
}

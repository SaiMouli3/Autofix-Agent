import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { BotMark } from "../components/BotMark";
import { Shell } from "../components/Shell";
import { Alert, Empty, ErrorState, KV, Pager, SkeletonRows, Status, Tabs, Tag, useConfirm, useToast } from "../components/ui";
import { api } from "../lib/api";
import { fullDateTime, timeAgo } from "../lib/format";
import { useSession } from "../lib/session";

/** Derive what a reviewer needs from the stored request: target, parameters and impact. */
function describe(a: any) {
  const d = a.details ?? {};
  if (a.kind === "integration_call") {
    const destructive = !!d.destructive || d.method === "DELETE";
    const write = d.method && d.method !== "GET";
    return {
      action: `${d.method ?? "CALL"} ${d.integration}.${d.operation}`,
      target: `${d.integration} (business API)`,
      params: d.arguments ?? {},
      impact: destructive ? { tone: "danger", text: "Destructive: deletes or irreversibly changes data in the external system." }
        : write ? { tone: "warning", text: "Writes data to an external system." } : { tone: "", text: "Reads data from an external system." },
      consequential: destructive || write,
    };
  }
  const actions: any[] = d.actions ?? [];
  const tools = Array.from(new Set(actions.map((x) => x.tool)));
  const high = actions.some((x) => String(x.risk).toUpperCase() === "HIGH");
  const exec = tools.some((t) => ["terminal", "browser"].includes(t));
  return {
    action: actions.map((x) => x.summary).join("; ") || a.summary,
    target: tools.length ? `${tools.join(", ")} in the agent's workspace` : "Agent workspace",
    params: actions.length === 1 ? actions[0].args : actions.map((x) => ({ tool: x.tool, ...x.args })),
    impact: high ? { tone: "danger", text: "Assessed as high risk by the runtime's security analyser." }
      : exec ? { tone: "warning", text: "Executes commands in the agent's sandboxed workspace." } : { tone: "", text: "Changes files in the agent's workspace." },
    consequential: high || exec,
    policy: d.policy,
  };
}

export default function Approvals() {
  const { can, me } = useSession();
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ["approvals", tab, page],
    queryFn: ({ signal }) => api.get(`/api/approvals?status=${tab === "pending" ? "pending" : ""}&page=${page}&page_size=20`, signal),
    refetchInterval: tab === "pending" ? 5000 : 30000,
  });
  const distinct = me.org.settings?.require_distinct_approver;
  return (
    <Shell crumbs={[{ label: "Approvals" }]}>
      <div className="page-head">
        <div><h1>Approvals</h1><p>Agents pause before sensitive actions until a person decides. Agents can never approve their own actions; every decision is written to the audit log.</p></div>
      </div>
      {distinct && <div style={{ marginBottom: 12 }}><Alert kind="info">Four-eyes policy is on: you cannot approve actions for tasks you requested yourself.</Alert></div>}
      {!can("approvals:decide") && <div style={{ marginBottom: 12 }}><Alert kind="neutral">Your role can review requests but not decide them.</Alert></div>}
      <Tabs label="Approval views" value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={[{ key: "pending", label: "Pending", count: tab === "pending" ? list.data?.total : null }, { key: "history", label: "Decision history" }]} />
      <div className="stack mt16">
        {list.isLoading && <div className="panel"><SkeletonRows rows={4} /></div>}
        {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} what="approval requests" />}
        {list.data?.items.length === 0 && <div className="panel"><Empty icon={ShieldCheck} title={tab === "pending" ? "Nothing is waiting for approval" : "No decisions yet"}>Requests appear here when an agent's policy requires a human checkpoint.</Empty></div>}
        {list.data?.items.map((a: any) => <ApprovalCard key={a.id} a={a} canDecide={can("approvals:decide")} blockedOwn={!!distinct && a.requested_by === me.user.id} />)}
        {list.data && list.data.total > 20 && <div className="panel"><Pager page={page} pageSize={20} total={list.data.total} onPage={setPage} /></div>}
      </div>
    </Shell>
  );
}

function ApprovalCard({ a, canDecide, blockedOwn }: { a: any; canDecide: boolean; blockedOwn: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [note, setNote] = useState("");
  const info = describe(a);
  const decide = useMutation({
    mutationFn: (decision: string) => api.post(`/api/approvals/${a.id}/decide`, { decision, note }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["approvals-count"] });
      toast("ok", r.status === "approved" ? `Approved. ${r.agent_name} will continue.` : `Rejected. ${r.agent_name} was told not to proceed.`);
    },
    onError: (e: any) => toast("error", e.status === 409 ? "Someone already decided this request, or it expired." : e.message),
  });
  const approve = async () => {
    if (info.consequential && !(await confirm({ title: "Approve this action?", confirmLabel: "Approve", danger: info.impact.tone === "danger",
      body: <><p style={{ margin: "0 0 8px" }}><b>{info.action}</b></p><p style={{ margin: 0 }}>{info.impact.text}</p></> }))) return;
    decide.mutate("approved");
  };
  const pending = a.status === "pending";
  return (
    <article className="panel" aria-label={`Approval request from ${a.agent_name}`}>
      <div className="panel-head">
        <div className="row" style={{ minWidth: 0 }}>
          <BotMark seed={a.agent_id} size={24} state={pending ? "waiting_for_approval" : undefined} />
          <div style={{ minWidth: 0 }}>
            <div className="small"><b>{a.agent_name}</b> requests {a.kind === "integration_call" ? "an API call" : "a tool action"}</div>
            <div className="tiny muted">Task: <Link to={`/tasks/${a.task_id}`} style={{ color: "var(--accent)" }}>{a.task_title}</Link></div>
          </div>
        </div>
        <Status status={a.status} />
      </div>
      <div className="panel-body">
        <div className="grid cols-2" style={{ gap: 16 }}>
          <KV items={[
            ["Requested action", <span key="a" className="strong">{info.action}</span>],
            ["Target system", info.target],
            ["Reason", a.task_title ? `Part of the task “${a.task_title}”` : a.summary],
            ["Potential impact", <span key="i" className="row" style={{ gap: 6 }}><Tag tone={info.impact.tone || undefined}>{info.impact.tone === "danger" ? "High" : info.impact.tone === "warning" ? "Medium" : "Low"}</Tag>{info.impact.text}</span>],
            ["Requested", <span key="r" title={fullDateTime(a.requested_at)}>{timeAgo(a.requested_at)}</span>],
            ["Expires", a.expires_at ? fullDateTime(a.expires_at) : "—"],
          ]} />
          <div>
            <div className="section-title">Parameters</div>
            <pre className="code" style={{ maxHeight: 220 }}>{JSON.stringify(info.params ?? {}, null, 2)}</pre>
          </div>
        </div>
        {!pending && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            {a.status === "expired" ? "Expired without a decision." : `${a.status === "approved" ? "Approved" : "Rejected"} by ${a.decided_by ?? "—"} · ${fullDateTime(a.decided_at)}`}{a.decision_note ? ` · “${a.decision_note}”` : ""}
          </p>
        )}
      </div>
      {pending && canDecide && (
        <div className="panel-foot row">
          <label className="sr-only" htmlFor={`note-${a.id}`}>Decision note</label>
          <input id={`note-${a.id}`} placeholder="Note for the record (sent to the agent if rejected)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          {blockedOwn ? <span className="tiny muted nowrap">Another approver must decide (four-eyes policy)</span> : (
            <>
              <button className="btn danger" disabled={decide.isPending} onClick={() => decide.mutate("rejected")}><X /> Reject</button>
              <button className="btn dark" disabled={decide.isPending} onClick={approve}><Check /> Approve</button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

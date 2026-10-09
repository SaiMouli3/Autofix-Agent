import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Shell } from "../components/Shell";
import { ErrorBox, Loading, Notice, Pager } from "../components/ui";
import { api, qs } from "../lib/api";
import { dateTime } from "../lib/format";

export default function Audit() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["audit", action, page], queryFn: () => api.get(`/api/audit${qs({ action, page, page_size: 50 })}`) });
  const verify = useMutation({ mutationFn: () => api.get("/api/audit/verify") });
  return (
    <Shell title="Audit Logs">
      <div className="page-head">
        <div><h1>Audit log</h1><p>Append-only, hash-chained record of administrative actions, permission changes, tool and integration invocations, approvals and execution outcomes. Secrets are redacted.</p></div>
        <button className="btn" onClick={() => verify.mutate()}><ShieldCheck /> Verify integrity</button>
      </div>
      {verify.data && <div className="mb16"><Notice kind={verify.data.valid ? "ok" : "error"}>{verify.data.valid ? `Hash chain intact across ${verify.data.checked} events.` : `Chain broken at event ${verify.data.broken_at} — records may have been altered.`}</Notice></div>}
      <div className="filters">
        <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action">
          <option value="">All actions</option>
          {["auth", "agent", "task", "approval", "integration", "provider", "knowledge", "schedule", "user", "team", "org", "delegation"].map((a) => <option key={a} value={a}>{a}.*</option>)}
        </select>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading && <Loading />}
      {q.data && (
        <div className="card flush">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th><th>Hash</th></tr></thead>
              <tbody>{q.data.items.map((e: any) => (
                <tr key={e.id}>
                  <td className="faint small nowrap">{dateTime(e.ts)}</td>
                  <td className="small">{e.actor_name || e.actor_type}<div className="faint tiny">{e.actor_type}{e.ip ? ` · ${e.ip}` : ""}</div></td>
                  <td><span className="badge outline">{e.action}</span></td>
                  <td className="mono tiny">{e.target_type}{e.target_id ? `:${e.target_id.slice(0, 10)}` : ""}</td>
                  <td className="mono tiny" style={{ maxWidth: 420, wordBreak: "break-word" }}>{JSON.stringify(e.details).slice(0, 240)}</td>
                  <td className="mono tiny faint">{e.hash}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pager page={page} pageSize={50} total={q.data.total} onPage={setPage} />
        </div>
      )}
    </Shell>
  );
}

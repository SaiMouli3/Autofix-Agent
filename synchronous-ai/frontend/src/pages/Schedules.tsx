import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Copy, Play, Plus, Trash2, Webhook } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Empty, ErrorBox, Loading, Modal, Notice, useToast } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, timeAgo } from "../lib/format";
import { useSession } from "../lib/session";

export default function Schedules() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["schedules"], queryFn: () => api.get("/api/schedules"), refetchInterval: 15000 });
  const [modal, setModal] = useState(false);
  const [secret, setSecret] = useState<any>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["schedules"] });
  const toggle = useMutation({ mutationFn: (s: any) => api.put(`/api/schedules/${s.id}`, { enabled: !s.enabled }), onSuccess: refresh, onError: (e: any) => toast("error", e.message) });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/api/schedules/${id}`), onSuccess: () => { refresh(); toast("ok", "Schedule deleted"); } });
  const run = useMutation({ mutationFn: (id: string) => api.post(`/api/schedules/${id}/run`), onSuccess: () => { toast("ok", "Task queued"); refresh(); }, onError: (e: any) => toast("error", e.message) });
  return (
    <Shell title="Workflows & Schedules">
      <div className="page-head">
        <div><h1>Workflows & schedules</h1><p>Run agents on a one-time or recurring schedule, or trigger them from authenticated webhooks. Agents run only when triggered — they do not operate continuously.</p></div>
        {can("schedules:write") && <button className="btn primary" onClick={() => setModal(true)}><Plus /> New schedule</button>}
      </div>
      <ErrorBox error={list.error} />
      {list.isLoading && <Loading />}
      {list.data?.length === 0 && <div className="card"><Empty icon={CalendarClock} title="No schedules">Create a recurring report, a nightly check or a webhook-triggered triage workflow.</Empty></div>}
      {(list.data?.length ?? 0) > 0 && (
        <div className="card flush">
          <table className="table">
            <thead><tr><th>Schedule</th><th>Agent</th><th>Trigger</th><th>Next run</th><th>Last run</th><th>Recent runs</th><th>Enabled</th><th /></tr></thead>
            <tbody>
              {list.data.map((s: any) => (
                <tr key={s.id}>
                  <td><b className="small">{s.name}</b><div className="faint tiny ellipsis" style={{ maxWidth: 280 }}>{s.instructions}</div></td>
                  <td className="small"><Link to={`/agents/${s.agent_id}`}>{s.agent_name}</Link></td>
                  <td className="small">
                    {s.kind === "cron" && <><span className="mono">{s.cron}</span><div className="faint tiny">{s.timezone} · missed: {s.missed_policy.replace("_", " ")}</div></>}
                    {s.kind === "once" && <>once · {dateTime(s.run_at)}</>}
                    {s.kind === "webhook" && <span className="row"><Webhook size={14} /> <span className="mono tiny">POST {s.webhook_url}</span></span>}
                  </td>
                  <td className="small">{s.next_run_at ? dateTime(s.next_run_at) : <span className="faint">{s.kind === "webhook" ? "on event" : "—"}</span>}</td>
                  <td className="small faint">{timeAgo(s.last_run_at)}</td>
                  <td>{s.recent_runs.slice(0, 5).map((r: any) => <Link key={r.task_id} to={`/tasks/${r.task_id}`} title={r.status} style={{ marginRight: 3 }}><span className={`status-dot ${r.status}`} /></Link>)}</td>
                  <td><input type="checkbox" checked={s.enabled} disabled={!can("schedules:write")} onChange={() => toggle.mutate(s)} aria-label="enabled" /></td>
                  <td className="nowrap">
                    {can("tasks:create") && <button className="btn xs ghost" title="Run now" onClick={() => run.mutate(s.id)}><Play /></button>}
                    {can("schedules:write") && <button className="btn xs ghost" title="Delete" onClick={() => confirm(`Delete schedule "${s.name}"?`) && del.mutate(s.id)}><Trash2 /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {modal && <NewSchedule onClose={() => setModal(false)} onCreated={(s) => { setModal(false); refresh(); if (s.webhook_secret) setSecret(s); }} />}
      {secret && (
        <Modal title="Webhook created" onClose={() => setSecret(null)} footer={<button className="btn primary" onClick={() => setSecret(null)}>I stored the secret</button>}>
          <div className="stack">
            <Notice kind="warn">This signing secret is shown only once. Store it in the calling system's secret manager.</Notice>
            <label className="field">Endpoint<input readOnly value={`${window.location.origin}${secret.webhook_url}`} /></label>
            <label className="field">Signing secret<div className="row"><input readOnly value={secret.webhook_secret} className="mono" />
              <button className="btn" onClick={() => navigator.clipboard.writeText(secret.webhook_secret)}><Copy /></button></div></label>
            <pre className="block">{`ts=$(date +%s); body='{"event":"ticket.created"}'
sig=$(printf "%s.%s" "$ts" "$body" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)
curl -X POST ${window.location.origin}${secret.webhook_url} \\
  -H "X-SCA-Timestamp: $ts" -H "X-SCA-Event-Id: evt-123" \\
  -H "X-SCA-Signature: sha256=$sig" -H "content-type: application/json" -d "$body"`}</pre>
          </div>
        </Modal>
      )}
    </Shell>
  );
}

function NewSchedule({ onClose, onCreated }: { onClose: () => void; onCreated: (s: any) => void }) {
  const agents = useQuery({ queryKey: ["agents", "all"], queryFn: () => api.get("/api/agents?page_size=500&status=active") });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [f, setF] = useState({ agent_id: "", name: "", instructions: "", kind: "cron", cron: "0 9 * * 1-5", timezone: tz, run_at: "", missed_policy: "run_once" });
  const m = useMutation({
    mutationFn: () => api.post("/api/schedules", { ...f, run_at: f.kind === "once" && f.run_at ? new Date(f.run_at).toISOString() : null }),
    onSuccess: onCreated,
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <Modal title="New schedule" onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!f.agent_id || !f.name || !f.instructions || m.isPending} onClick={() => m.mutate()}>Create schedule</button></>}>
      <div className="form-grid">
        <label className="field">Agent<select value={f.agent_id} onChange={(e) => set({ agent_id: e.target.value })}>
          <option value="">Select an agent…</option>{(agents.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="field">Name<input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Weekly pipeline report" /></label>
        <label className="field full">Task instructions<textarea value={f.instructions} onChange={(e) => set({ instructions: e.target.value })} /></label>
        <label className="field">Trigger<select value={f.kind} onChange={(e) => set({ kind: e.target.value })}>
          <option value="cron">Recurring (cron)</option><option value="once">One time</option><option value="webhook">Authenticated webhook</option></select></label>
        {f.kind === "cron" && <>
          <label className="field">Cron expression<input className="mono" value={f.cron} onChange={(e) => set({ cron: e.target.value })} /><span className="help">minute hour day month weekday — e.g. “0 9 * * 1-5” is 09:00 on weekdays.</span></label>
          <label className="field">Time zone<input value={f.timezone} onChange={(e) => set({ timezone: e.target.value })} /></label>
          <label className="field">Missed runs<select value={f.missed_policy} onChange={(e) => set({ missed_policy: e.target.value })}><option value="run_once">Run once when back online</option><option value="skip">Skip</option></select></label>
        </>}
        {f.kind === "once" && <label className="field">Run at<input type="datetime-local" value={f.run_at} onChange={(e) => set({ run_at: e.target.value })} /></label>}
        {f.kind === "webhook" && <div className="full"><Notice>A signing secret will be generated. Callers must sign requests with HMAC-SHA256; duplicate event ids are ignored. The payload is passed to the agent as untrusted data.</Notice></div>}
      </div>
      <div className="mt16"><ErrorBox error={m.error} /></div>
    </Modal>
  );
}


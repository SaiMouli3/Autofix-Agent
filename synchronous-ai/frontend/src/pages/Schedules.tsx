import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Copy, MoreHorizontal, Play, Plus, Webhook } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BotMark } from "../components/BotMark";
import { Shell } from "../components/Shell";
import { Alert, Dialog, Empty, ErrorState, InlineError, Menu, SkeletonRows, Status, Tag, useConfirm, useToast } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, fullDateTime, timeAgo } from "../lib/format";
import { useSession } from "../lib/session";
import { statusOf } from "../lib/status";

/** Workflows are triggers that start agent tasks: recurring (cron), one-time, or signed webhooks.
 *  Agents run only when triggered; there is no continuously-running agent loop. */
export default function Workflows() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const list = useQuery({ queryKey: ["schedules"], queryFn: ({ signal }) => api.get("/api/schedules", signal), refetchInterval: 15000 });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<any>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["schedules"] });
  const toggle = useMutation({ mutationFn: (s: any) => api.put(`/api/schedules/${s.id}`, { enabled: !s.enabled }), onSuccess: (r) => { refresh(); toast("ok", r.enabled ? `${r.name} enabled` : `${r.name} paused`); }, onError: (e: any) => toast("error", e.message) });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/api/schedules/${id}`), onSuccess: () => { refresh(); toast("ok", "Workflow deleted"); }, onError: (e: any) => toast("error", e.message) });
  const run = useMutation({ mutationFn: (id: string) => api.post(`/api/schedules/${id}/run`), onSuccess: (r) => { refresh(); toast("ok", "Task queued"); nav(`/tasks/${r.task_id}`); }, onError: (e: any) => toast("error", e.message) });
  const items: any[] = list.data ?? [];
  return (
    <Shell crumbs={[{ label: "Workflows" }]}>
      <div className="page-head">
        <div><h1>Workflows</h1><p>Start agent tasks on a recurring schedule, at a set time, or from signed webhooks. Every run is an ordinary task with full trace and approvals.</p></div>
        {can("schedules:write") && <button className="btn primary" onClick={() => setCreating(true)}><Plus /> New workflow</button>}
      </div>
      {list.isLoading && <div className="panel"><SkeletonRows rows={4} /></div>}
      <ErrorState error={list.error} onRetry={() => list.refetch()} what="workflows" />
      {list.data && items.length === 0 && (
        <div className="panel"><Empty icon={CalendarClock} title="No workflows yet" action={can("schedules:write") ? <button className="btn" onClick={() => setCreating(true)}><Plus /> New workflow</button> : undefined}>
          Create a weekday report, a nightly check, or a webhook-triggered triage flow.</Empty></div>
      )}
      {items.length > 0 && (
        <section className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Workflow</th><th scope="col">Agent</th><th scope="col">Trigger</th><th scope="col">Next run</th><th scope="col">Recent runs</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{items.map((s) => (
                <tr key={s.id}>
                  <td style={{ maxWidth: 320 }}><b className="small">{s.name}</b><div className="tiny muted ellipsis">{s.instructions}</div></td>
                  <td><Link to={`/agents/${s.agent_id}`} className="row small" style={{ gap: 6 }}><BotMark seed={s.agent_id} size={18} />{s.agent_name}</Link></td>
                  <td className="small">
                    {s.kind === "cron" && <><Tag mono>{s.cron}</Tag><div className="tiny muted">{s.timezone} · missed runs: {s.missed_policy === "skip" ? "skip" : "run once"}</div></>}
                    {s.kind === "once" && <>Once · {dateTime(s.run_at)}</>}
                    {s.kind === "webhook" && <span className="row" style={{ gap: 6 }}><Webhook size={14} aria-hidden /> Signed webhook</span>}
                  </td>
                  <td className="small nowrap">{!s.enabled ? <span className="muted">Paused</span> : s.next_run_at ? <span title={fullDateTime(s.next_run_at)}>{dateTime(s.next_run_at)}</span> : <span className="muted">{s.kind === "webhook" ? "On event" : "—"}</span>}
                    {s.last_run_at && <div className="tiny muted">last {timeAgo(s.last_run_at)}</div>}</td>
                  <td>
                    {s.recent_runs.length === 0 ? <span className="tiny muted">None</span> : (
                      <div className="row" style={{ gap: 3 }}>{s.recent_runs.slice(0, 6).map((r: any) => (
                        <Link key={r.task_id} to={`/tasks/${r.task_id}`} data-tip={`${statusOf(r.status).label} · ${timeAgo(r.created_at)}`} aria-label={`Run ${statusOf(r.status).label}`}>
                          <span className={`run-pip ${statusOf(r.status).tone}`} />
                        </Link>
                      ))}</div>
                    )}
                  </td>
                  <td><Status status={s.enabled ? "active" : "disabled"} label={s.enabled ? "Enabled" : "Paused"} /></td>
                  <td className="right">
                    <Menu label={`Actions for ${s.name}`} trigger={(p) => <button className="btn xs ghost icon" {...p} aria-label={`Actions for ${s.name}`}><MoreHorizontal /></button>} items={[
                      ...(can("tasks:create") ? [{ label: "Run now", icon: Play, onSelect: () => run.mutate(s.id) }] : []),
                      ...(can("schedules:write") ? [
                        { label: s.enabled ? "Pause" : "Enable", onSelect: () => toggle.mutate(s) },
                        { separator: true, label: "" },
                        { label: "Delete", danger: true, onSelect: async () => { if (await confirm({ title: `Delete “${s.name}”?`, body: s.kind === "webhook" ? "Callers using this webhook URL will start receiving 404 responses. Past runs and their tasks are kept." : "No further runs will start. Past runs and their tasks are kept.", confirmLabel: "Delete workflow", danger: true })) del.mutate(s.id); } },
                      ] : []),
                    ]} />
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
      {creating && <NewWorkflow onClose={() => setCreating(false)} onCreated={(s) => { setCreating(false); refresh(); if (s.webhook_secret) setSecret(s); else toast("ok", `${s.name} created`); }} />}
      {secret && <WebhookSecret s={secret} onClose={() => setSecret(null)} />}
    </Shell>
  );
}

function WebhookSecret({ s, onClose }: { s: any; onClose: () => void }) {
  const toast = useToast();
  const url = `${window.location.origin}${s.webhook_url}`;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast("ok", "Copied"), () => toast("error", "Copy failed — select and copy manually"));
  return (
    <Dialog title="Webhook created" description={s.name} onClose={onClose} footer={<button className="btn dark" onClick={onClose}>I stored the secret</button>}>
      <div className="stack">
        <Alert kind="warn">This signing secret is shown once. Store it in the calling system's secret manager — it cannot be retrieved later.</Alert>
        <label className="field">Endpoint<div className="row"><input readOnly value={url} className="mono" /><button className="btn icon" aria-label="Copy endpoint" onClick={() => copy(url)}><Copy /></button></div></label>
        <label className="field">Signing secret<div className="row"><input readOnly value={s.webhook_secret} className="mono" onFocus={(e) => e.target.select()} /><button className="btn icon" aria-label="Copy secret" onClick={() => copy(s.webhook_secret)}><Copy /></button></div></label>
        <div>
          <div className="section-title">Signing a request</div>
          <pre className="code">{`ts=$(date +%s); body='{"event":"ticket.created"}'
sig=$(printf "%s.%s" "$ts" "$body" | openssl dgst -sha256 -hmac "$SECRET" | cut -d' ' -f2)
curl -X POST ${url} \\
  -H "X-SCA-Timestamp: $ts" -H "X-SCA-Event-Id: evt-123" \\
  -H "X-SCA-Signature: sha256=$sig" -H "content-type: application/json" -d "$body"`}</pre>
        </div>
      </div>
    </Dialog>
  );
}

const CRON_PRESETS = [
  { label: "Weekdays 09:00", cron: "0 9 * * 1-5" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Daily 06:00", cron: "0 6 * * *" },
  { label: "Mondays 08:00", cron: "0 8 * * 1" },
];

function NewWorkflow({ onClose, onCreated }: { onClose: () => void; onCreated: (s: any) => void }) {
  const agents = useQuery({ queryKey: ["agents", "active-all"], queryFn: ({ signal }) => api.get("/api/agents?page_size=500&status=active", signal) });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [f, setF] = useState({ agent_id: "", name: "", instructions: "", kind: "cron", cron: "0 9 * * 1-5", timezone: tz, run_at: "", missed_policy: "run_once" });
  const [touched, setTouched] = useState(false);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const errs: Record<string, string> = {};
  if (!f.agent_id) errs.agent_id = "Choose the agent that runs this workflow.";
  if (f.name.trim().length < 2) errs.name = "Give the workflow a name.";
  if (f.instructions.trim().length < 5) errs.instructions = "Describe the task the agent should perform.";
  if (f.kind === "cron" && f.cron.trim().split(/\s+/).length !== 5) errs.cron = "A cron expression has five fields.";
  if (f.kind === "once" && !f.run_at) errs.run_at = "Pick a date and time.";
  const valid = Object.keys(errs).length === 0;
  const m = useMutation({
    mutationFn: () => api.post("/api/schedules", { ...f, run_at: f.kind === "once" && f.run_at ? new Date(f.run_at).toISOString() : null }),
    onSuccess: onCreated,
  });
  const err = (k: string) => touched && errs[k] ? <span className="err">{errs[k]}</span> : null;
  return (
    <Dialog title="New workflow" size="wide" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" disabled={m.isPending} onClick={() => { setTouched(true); if (valid) m.mutate(); }}>{m.isPending ? "Creating…" : "Create workflow"}</button></>}>
      <div className="form-grid">
        <label className="field"><span className="req">Agent</span><select value={f.agent_id} aria-invalid={touched && !!errs.agent_id} onChange={(e) => set({ agent_id: e.target.value })}>
          <option value="">Select an agent…</option>{(agents.data?.items ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>{err("agent_id")}
          {agents.data && agents.data.items.length === 0 && <span className="help">No active agents. <Link to="/agents/new">Create one</Link> first.</span>}</label>
        <label className="field"><span className="req">Name</span><input value={f.name} aria-invalid={touched && !!errs.name} onChange={(e) => set({ name: e.target.value })} placeholder="Weekly pipeline report" />{err("name")}</label>
        <label className="field full"><span className="req">Task instructions</span><textarea rows={4} value={f.instructions} aria-invalid={touched && !!errs.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Summarise last week's closed deals and post the report as a markdown file." />{err("instructions")}</label>
        <fieldset className="field full" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small strong" style={{ marginBottom: 6 }}>Trigger</legend>
          <div className="seg" role="radiogroup" aria-label="Trigger">
            {[["cron", "Recurring"], ["once", "One time"], ["webhook", "Webhook"]].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={f.kind === k} onClick={() => set({ kind: k })}>{l}</button>
            ))}
          </div>
        </fieldset>
        {f.kind === "cron" && <>
          <label className="field"><span className="req">Cron expression</span><input className="mono" value={f.cron} aria-invalid={touched && !!errs.cron} onChange={(e) => set({ cron: e.target.value })} />
            <span className="help">minute hour day month weekday</span>{err("cron")}
            <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>{CRON_PRESETS.map((p) => <button type="button" key={p.cron} className="chip-btn" aria-pressed={f.cron === p.cron} onClick={() => set({ cron: p.cron })}>{p.label}</button>)}</div></label>
          <label className="field">Time zone<input value={f.timezone} onChange={(e) => set({ timezone: e.target.value })} /><span className="help">IANA name, e.g. Europe/London</span></label>
          <label className="field">If a run is missed<select value={f.missed_policy} onChange={(e) => set({ missed_policy: e.target.value })}><option value="run_once">Run once when the platform is back</option><option value="skip">Skip it</option></select></label>
        </>}
        {f.kind === "once" && <label className="field"><span className="req">Run at</span><input type="datetime-local" value={f.run_at} aria-invalid={touched && !!errs.run_at} onChange={(e) => set({ run_at: e.target.value })} /><span className="help">Your local time ({tz})</span>{err("run_at")}</label>}
        {f.kind === "webhook" && <div className="full"><Alert kind="info">A signing secret is generated and shown once. Callers sign requests with HMAC-SHA256; replayed event ids are ignored, and the payload reaches the agent as untrusted data.</Alert></div>}
      </div>
      <div className="mt12"><InlineError error={m.error} /></div>
    </Dialog>
  );
}

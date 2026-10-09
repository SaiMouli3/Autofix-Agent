import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Plus, ShieldCheck, UserPlus, X, XCircle } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BRAND } from "../brand";
import { Shell } from "../components/Shell";
import { SignInAppsSection } from "../components/SignInApps";
import { Alert, Dialog, Empty, ErrorState, InlineError, KV, Pager, SkeletonRows, Status, Tabs, Tag, useConfirm, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { fullDateTime, timeAgo } from "../lib/format";
import { useSession } from "../lib/session";
import { providerState } from "../lib/status";

type Tab = "providers" | "signin" | "organization" | "team" | "audit" | "account";

export default function SettingsPage() {
  const { can } = useSession();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "providers";
  const tabs: { key: Tab; label: string }[] = [
    { key: "providers", label: "Model providers" },
    { key: "signin", label: "Sign-in apps" },
    { key: "organization", label: "Organization" },
    { key: "team", label: "Team & roles" },
    ...(can("audit:read") ? [{ key: "audit" as Tab, label: "Audit log" }] : []),
    { key: "account", label: "Account" },
  ];
  return (
    <Shell crumbs={[{ label: "Settings" }, { label: tabs.find((t) => t.key === tab)?.label ?? "" }]}>
      <div className="page-head"><div><h1>Settings</h1><p>Model providers, organization policy, people and access, and the audit trail.</p></div></div>
      <Tabs label="Settings sections" value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} tabs={tabs} />
      <div className="mt16">
        {tab === "providers" && <Providers />}
        {tab === "signin" && <SignInAppsSection />}
        {tab === "organization" && <Organization />}
        {tab === "team" && <Team />}
        {tab === "audit" && can("audit:read") && <Audit />}
        {tab === "account" && <Account />}
      </div>
    </Shell>
  );
}

// ------------------------------------------------------------------ providers

function Providers() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["providers"], queryFn: ({ signal }) => api.get("/api/providers", signal) });
  const [adding, setAdding] = useState(false);
  const [keyFor, setKeyFor] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const test = useMutation({
    mutationFn: (id: string) => api.post(`/api/providers/${id}/test`, {}),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["providers"] }); toast(r.result.ok ? "ok" : "error", r.result.ok ? `${r.provider.name}: connection verified with a live request` : r.result.error?.message ?? "Connection test failed"); },
    onError: (e: any) => toast("error", e.message),
  });
  return (
    <div className="stack">
      <div className="row between wrap">
        <p className="small muted" style={{ margin: 0, maxWidth: 720 }}>API keys are encrypted at rest and decrypted only inside the backend while an agent runs. They are never returned to the browser or written to logs. A provider counts as connected only after a live connection test succeeds.</p>
        {can("providers:write") && <button className="btn primary" onClick={() => setAdding(true)}><Plus /> Add provider</button>}
      </div>
      {list.isLoading && <div className="panel"><SkeletonRows rows={3} /></div>}
      <ErrorState error={list.error} onRetry={() => list.refetch()} what="providers" />
      {list.data?.length === 0 && <div className="panel"><Empty title="No model providers">Add an OpenAI-compatible provider such as Experiential Labs to let agents run.</Empty></div>}
      {list.data?.map((p: any) => {
        const r = p.last_test_result ?? {};
        return (
          <section className="panel" key={p.id} aria-label={p.name}>
            <div className="panel-head">
              <div><h2>{p.name}</h2><div className="tiny muted">{p.kind_label} · <span className="mono">{p.base_url}</span></div></div>
              <div className="row">
                <Status status={providerState(p)} />
                {can("providers:test") && <button className="btn sm" disabled={test.isPending && test.variables === p.id} onClick={() => test.mutate(p.id)}>{test.isPending && test.variables === p.id ? "Testing…" : "Test connection"}</button>}
                {can("providers:write") && <button className="btn sm" onClick={() => setKeyFor(p)}><KeyRound /> {p.has_credential ? "Rotate key" : "Set key"}</button>}
                {can("providers:write") && <button className="btn sm ghost" onClick={() => setEditing(p)}>Edit</button>}
              </div>
            </div>
            <div className="panel-body grid cols-2">
              <KV items={[
                ["Default model", <span key="m" className="mono">{p.default_model || "—"}</span>],
                ["Embedding model", p.embedding_model ? <span key="e" className="mono">{p.embedding_model}</span> : "None — keyword retrieval only"],
                ["Credential", p.has_credential ? <span key="c">Stored · <span className="mono">{p.credential_fingerprint}</span> · updated {timeAgo(p.credential_updated_at)}</span> : <span key="c" style={{ color: "var(--warning)" }}>Missing</span>],
                ["Model catalog", p.model_count ? `${p.model_count} models` : "Loaded on first successful test"],
              ]} />
              <div>
                <div className="section-title">Last connection test {p.last_tested_at && <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>· {fullDateTime(p.last_tested_at)}</span>}</div>
                {!r.checks && !r.error && <p className="small muted" style={{ margin: 0 }}>Never tested.</p>}
                <div className="stack tight">
                  {(r.checks ?? []).map((c: any) => <div key={c.name} className="row small">{c.ok ? <CheckCircle2 size={14} color="var(--success)" /> : <XCircle size={14} color="var(--danger)" />}<b>{c.name.replace(/_/g, " ")}</b><span className="muted">{c.detail}</span></div>)}
                </div>
                {r.error && <div className="mt8"><Alert kind="error"><b className="mono" style={{ fontSize: 12 }}>{r.error.code}</b> {r.error.message}</Alert></div>}
                {r.latency_ms != null && <p className="tiny muted" style={{ marginBottom: 0 }}>{r.latency_ms} ms · model <span className="mono">{r.model}</span></p>}
              </div>
            </div>
          </section>
        );
      })}
      {adding && <ProviderDialog onClose={() => setAdding(false)} />}
      {editing && <ProviderDialog provider={editing} onClose={() => setEditing(null)} />}
      {keyFor && <KeyDialog p={keyFor} onClose={() => setKeyFor(null)} />}
    </div>
  );
}

function ProviderDialog({ provider, onClose }: { provider?: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const kinds = useQuery({ queryKey: ["provider-kinds"], queryFn: ({ signal }) => api.get("/api/providers/kinds", signal) });
  const models = useQuery({ queryKey: ["models", provider?.id], queryFn: ({ signal }) => api.get(`/api/providers/${provider.id}/models`, signal), enabled: !!provider?.has_credential, retry: false });
  const [f, setF] = useState(provider
    ? { name: provider.name, kind: provider.kind, base_url: provider.base_url, default_model: provider.default_model, embedding_model: provider.embedding_model, api_key: "" }
    : { name: "Experiential Labs", kind: "experiential_labs", base_url: "https://api.experientiallabs.ai/v1", default_model: "", embedding_model: "text-embedding-3-small", api_key: "" });
  const m = useMutation({
    mutationFn: () => (provider
      ? api.put(`/api/providers/${provider.id}`, { name: f.name, base_url: kinds.data?.[f.kind]?.base_url_editable ? f.base_url : undefined, default_model: f.default_model, embedding_model: f.embedding_model })
      : api.post("/api/providers", f)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["providers"] }); toast("ok", provider ? "Provider updated. Run a connection test to verify it." : "Provider saved. Run a connection test to verify it."); onClose(); },
  });
  const kind = kinds.data?.[f.kind];
  return (
    <Dialog title={provider ? `Edit ${provider.name}` : "Add model provider"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" disabled={!f.name || m.isPending} onClick={() => m.mutate()}>Save</button></>}>
      <div className="form-grid">
        <label className="field">Provider type
          <select value={f.kind} disabled={!!provider} onChange={(e) => { const k = kinds.data?.[e.target.value]; setF({ ...f, kind: e.target.value, name: provider ? f.name : k?.label ?? f.name, base_url: k?.default_base_url ?? "" }); }}>
            {Object.entries(kinds.data ?? {}).map(([k, v]: any) => <option key={k} value={k}>{v.label}</option>)}
          </select></label>
        <label className="field"><span className="req">Display name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field full">Base URL<input value={f.base_url} disabled={kind && !kind.base_url_editable} onChange={(e) => setF({ ...f, base_url: e.target.value })} /></label>
        <label className="field">Default model
          {models.data?.models?.length ? <select value={f.default_model} onChange={(e) => setF({ ...f, default_model: e.target.value })}><option value="">Select…</option>{models.data.models.map((x: any) => <option key={x.id}>{x.id}</option>)}</select>
            : <input value={f.default_model} onChange={(e) => setF({ ...f, default_model: e.target.value })} placeholder="e.g. claude-sonnet-5.5" />}</label>
        <label className="field">Embedding model<input value={f.embedding_model} onChange={(e) => setF({ ...f, embedding_model: e.target.value })} placeholder="Optional" /></label>
        {!provider && <label className="field full">API key<input type="password" autoComplete="off" value={f.api_key} onChange={(e) => setF({ ...f, api_key: e.target.value })} /><span className="help">Encrypted before storage. It cannot be viewed again — only rotated.</span></label>}
      </div>
      <InlineError error={m.error} />
    </Dialog>
  );
}

function KeyDialog({ p, onClose }: { p: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [k, setK] = useState("");
  const m = useMutation({ mutationFn: () => api.post(`/api/providers/${p.id}/credential`, { api_key: k }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["providers"] }); toast("ok", "Key stored encrypted. Run a connection test."); onClose(); } });
  return (
    <Dialog size="narrow" title={`${p.has_credential ? "Rotate" : "Set"} API key`} description={p.name} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" disabled={k.length < 8 || m.isPending} onClick={() => m.mutate()}>Save key</button></>}>
      <label className="field">API key<input type="password" autoComplete="off" value={k} onChange={(e) => setK(e.target.value)} /></label>
      <InlineError error={m.error} />
    </Dialog>
  );
}

// ------------------------------------------------------------------ organization

function Organization() {
  const { me, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [distinct, setDistinct] = useState(!!me.org.settings?.require_distinct_approver);
  const save = useMutation({ mutationFn: () => api.put("/api/org/settings", { require_distinct_approver: distinct }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); toast("ok", "Organization policy saved"); }, onError: (e: any) => toast("error", e.message) });
  return (
    <div className="grid cols-2">
      <section className="panel">
        <div className="panel-head"><h2>Organization</h2></div>
        <div className="panel-body">
          <KV items={[["Name", me.org.name], ["Identifier", <span key="s" className="mono">{me.org.slug}</span>], ["Environment", me.env],
            ["Agent runtime", me.runtime === "docker" ? "Docker sandbox per execution" : "Local process (development only — not an isolation boundary)"]]} />
          {me.runtime !== "docker" && <div className="mt12"><Alert kind="warn">Production deployments should use the Docker sandbox runtime (see docs/DEPLOYMENT.md).</Alert></div>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Approval policy</h2></div>
        <div className="panel-body stack">
          <label className="check"><input type="checkbox" checked={distinct} disabled={!can("settings:write")} onChange={(e) => setDistinct(e.target.checked)} />
            <span><b>Four-eyes approvals.</b> Require someone other than the person who requested a task to approve its sensitive actions.</span></label>
          {can("settings:write") && <div><button className="btn dark" disabled={distinct === !!me.org.settings?.require_distinct_approver || save.isPending} onClick={() => save.mutate()}>Save policy</button></div>}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ team

function Team() {
  const { can, me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const users = useQuery({ queryKey: ["users"], queryFn: ({ signal }) => api.get("/api/users", signal) });
  const teams = useQuery({ queryKey: ["teams"], queryFn: ({ signal }) => api.get("/api/teams", signal) });
  const roles = useQuery({ queryKey: ["roles"], queryFn: ({ signal }) => api.get("/api/roles", signal) });
  const [invite, setInvite] = useState(false);
  const [newTeam, setNewTeam] = useState(false);
  const [temp, setTemp] = useState<any>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["users"] }); qc.invalidateQueries({ queryKey: ["teams"] }); };
  const setRole = useMutation({ mutationFn: ({ id, role }: any) => api.put(`/api/users/${id}/role`, { role }), onSuccess: () => { refresh(); toast("ok", "Role updated. It applies to the user's next request."); }, onError: (e: any) => toast("error", e.message) });
  const setActive = useMutation({ mutationFn: ({ id, is_active }: any) => api.put(`/api/users/${id}/active`, { is_active }), onSuccess: (_, v: any) => { refresh(); toast("ok", v.is_active ? "User reactivated" : "User deactivated and signed out"); }, onError: (e: any) => toast("error", e.message) });
  const addMember = useMutation({ mutationFn: ({ team, user }: any) => api.post(`/api/teams/${team}/members`, { user_id: user }), onSuccess: refresh });
  const rmMember = useMutation({ mutationFn: ({ team, user }: any) => api.del(`/api/teams/${team}/members/${user}`), onSuccess: refresh });
  const roleHelp: Record<string, string> = {
    org_admin: "Everything, including providers, users and policy", agent_admin: "Agents, integrations, knowledge, approvals",
    operator: "Run and cancel tasks, manage schedules", approver: "Decide approvals; read-only otherwise", viewer: "Read-only",
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="panel">
        <div className="panel-head"><h2>People</h2>{can("users:write") && <button className="btn sm primary" onClick={() => setInvite(true)}><UserPlus /> Add person</button>}</div>
        {users.isLoading ? <SkeletonRows rows={3} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last sign-in</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{(users.data ?? []).map((u: any) => (
                <tr key={u.user_id}>
                  <td><b className="small">{u.name}</b>{u.user_id === me.user.id && <Tag>you</Tag>}<div className="tiny muted">{u.email}</div></td>
                  <td>{can("users:write") ? (
                    <select value={u.role} style={{ width: 230 }} aria-label={`Role for ${u.name}`} onChange={async (e) => {
                      const role = e.target.value;
                      if (await confirm({ title: `Change ${u.name}'s role?`, body: <>{u.role_label} → <b>{roles.data?.find((r: any) => r.key === role)?.label}</b>: {roleHelp[role]}.</>, confirmLabel: "Change role" })) setRole.mutate({ id: u.user_id, role });
                    }}>{(roles.data ?? []).map((r: any) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
                  ) : <span className="small">{u.role_label}</span>}<div className="tiny muted">{roleHelp[u.role]}</div></td>
                  <td><Status status={u.is_active ? "active" : "disabled"} label={u.is_active ? "Active" : "Deactivated"} /></td>
                  <td className="muted nowrap">{u.last_login_at ? timeAgo(u.last_login_at) : "Never"}</td>
                  <td className="right">{can("users:write") && u.user_id !== me.user.id && (
                    <button className={`btn xs ${u.is_active ? "danger" : ""}`} onClick={async () => {
                      if (!u.is_active || await confirm({ title: `Deactivate ${u.name}?`, body: "They are signed out everywhere and cannot sign in until reactivated. Their agents and history are kept.", confirmLabel: "Deactivate", danger: true }))
                        setActive.mutate({ id: u.user_id, is_active: !u.is_active });
                    }}>{u.is_active ? "Deactivate" : "Reactivate"}</button>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Teams</h2>{can("teams:write") && <button className="btn sm" onClick={() => setNewTeam(true)}><Plus /> New team</button>}</div>
        {(teams.data ?? []).length === 0 ? <Empty title="No teams">Teams group people and own agents, and can be used to filter the agent list.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Team</th><th scope="col">Members</th>{can("teams:write") && <th scope="col">Add member</th>}</tr></thead>
              <tbody>{teams.data.map((t: any) => (
                <tr key={t.id}>
                  <td><b className="small">{t.name}</b><div className="tiny muted">{t.description}</div></td>
                  <td><div className="row wrap" style={{ gap: 4 }}>{t.members.length === 0 && <span className="muted small">None</span>}{t.members.map((m: any) => (
                    <span key={m.id} className="tag">{m.name}{can("teams:write") && <button aria-label={`Remove ${m.name} from ${t.name}`} onClick={() => rmMember.mutate({ team: t.id, user: m.id })} style={{ border: 0, background: "none", cursor: "pointer", padding: 0, display: "grid", color: "inherit" }}><X size={11} /></button>}</span>
                  ))}</div></td>
                  {can("teams:write") && <td><select value="" onChange={(e) => e.target.value && addMember.mutate({ team: t.id, user: e.target.value })} aria-label={`Add member to ${t.name}`} style={{ width: 200 }}>
                    <option value="">Add…</option>{(users.data ?? []).filter((u: any) => !t.members.some((m: any) => m.id === u.user_id)).map((u: any) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}
                  </select></td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
      {invite && <InviteDialog roles={roles.data ?? []} help={roleHelp} onClose={() => setInvite(false)} onDone={(r) => { setInvite(false); refresh(); if (r.temporary_password) setTemp(r); else toast("ok", `${r.name} added`); }} />}
      {newTeam && <TeamDialog onClose={() => setNewTeam(false)} onDone={() => { setNewTeam(false); refresh(); }} />}
      {temp && (
        <Dialog size="narrow" title={`${temp.name} was added`} onClose={() => setTemp(null)} footer={<button className="btn dark" onClick={() => setTemp(null)}>Done</button>}>
          <Alert kind="warn">Share this one-time password through a secure channel. It won't be shown again, and they must change it after signing in.</Alert>
          <input readOnly className="mono mt12" value={temp.temporary_password} aria-label="Temporary password" onFocus={(e) => e.target.select()} />
        </Dialog>
      )}
    </div>
  );
}

function InviteDialog({ roles, help, onClose, onDone }: { roles: any[]; help: Record<string, string>; onClose: () => void; onDone: (r: any) => void }) {
  const [f, setF] = useState({ email: "", name: "", role: "operator", password: "" });
  const m = useMutation({ mutationFn: () => api.post("/api/users", { ...f, password: f.password || null }), onSuccess: onDone });
  return (
    <Dialog title="Add a person" description="They join this organization with the role you choose." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" disabled={!f.email || !f.name || m.isPending} onClick={() => m.mutate()}>Add person</button></>}>
      <div className="form-grid">
        <label className="field"><span className="req">Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span className="req">Email</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="field full">Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select><span className="help">{help[f.role]}</span></label>
        <label className="field full">Initial password<input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><span className="help">Leave blank to generate a one-time password they must change.</span></label>
      </div>
      <InlineError error={m.error} />
    </Dialog>
  );
}

function TeamDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", description: "" });
  const m = useMutation({ mutationFn: () => api.post("/api/teams", f), onSuccess: onDone });
  return (
    <Dialog size="narrow" title="New team" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" disabled={f.name.trim().length < 2 || m.isPending} onClick={() => m.mutate()}>Create team</button></>}>
      <div className="stack">
        <label className="field"><span className="req">Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Description<textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <InlineError error={m.error} />
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ audit

function Audit() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["audit", action, page], queryFn: ({ signal }) => api.get(`/api/audit${qs({ action, page, page_size: 50 })}`, signal), placeholderData: (p) => p });
  const verify = useMutation({ mutationFn: () => api.get("/api/audit/verify") });
  return (
    <div className="stack">
      <div className="row between wrap">
        <div className="filters" style={{ margin: 0 }}>
          <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action type">
            <option value="">All actions</option>
            {["auth", "agent", "task", "approval", "integration", "provider", "knowledge", "schedule", "user", "team", "org", "delegation", "artifact"].map((a) => <option key={a} value={a}>{a}.*</option>)}
          </select>
        </div>
        <button className="btn" onClick={() => verify.mutate()} disabled={verify.isPending}><ShieldCheck /> {verify.isPending ? "Verifying…" : "Verify integrity"}</button>
      </div>
      {verify.data && <Alert kind={verify.data.valid ? "ok" : "error"}>{verify.data.valid ? `The hash chain is intact across ${verify.data.checked} events.` : `The chain breaks at event ${verify.data.broken_at}: records may have been altered.`}</Alert>}
      <InlineError error={verify.error} />
      <section className="panel">
        {q.isLoading && <SkeletonRows rows={8} />}
        <ErrorState error={q.error} what="the audit log" />
        {q.data && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Details</th></tr></thead>
                <tbody>{q.data.items.map((e: any) => (
                  <tr key={e.id}>
                    <td className="mono muted nowrap" style={{ fontSize: 11.5 }}>{fullDateTime(e.ts)}</td>
                    <td className="small">{e.actor_name || e.actor_type}<div className="tiny muted">{e.actor_type}{e.ip ? ` · ${e.ip}` : ""}</div></td>
                    <td><Tag mono>{e.action}</Tag></td>
                    <td className="mono tiny">{e.target_type}{e.target_id ? ` ${e.target_id.slice(0, 8)}` : ""}</td>
                    <td className="mono tiny" style={{ maxWidth: 440, wordBreak: "break-word" }}>{JSON.stringify(e.details).slice(0, 220)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <Pager page={page} pageSize={50} total={q.data.total} onPage={setPage} />
          </>
        )}
      </section>
      <p className="tiny muted">Append-only and hash-chained per organization. Secrets are redacted before events are recorded.</p>
    </div>
  );
}

// ------------------------------------------------------------------ account

function Account() {
  const { me } = useSession();
  const toast = useToast();
  const [f, setF] = useState({ current_password: "", new_password: "", confirm: "" });
  const mismatch = f.confirm.length > 0 && f.new_password !== f.confirm;
  const m = useMutation({ mutationFn: () => api.post("/api/auth/change-password", { current_password: f.current_password, new_password: f.new_password }), onSuccess: () => { setF({ current_password: "", new_password: "", confirm: "" }); toast("ok", "Password changed. Your other sessions were signed out."); } });
  return (
    <div className="grid cols-2">
      <section className="panel">
        <div className="panel-head"><h2>Profile</h2></div>
        <div className="panel-body"><KV items={[["Name", me.user.name], ["Email", me.user.email], ["Role", me.role_label], ["Organization", me.org.name]]} /></div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Password</h2></div>
        <form className="panel-body stack" onSubmit={(e) => { e.preventDefault(); if (!mismatch) m.mutate(); }}>
          {me.user.must_change_password && <Alert kind="warn">You're using a temporary password. Choose a new one now.</Alert>}
          <label className="field">Current password<input type="password" autoComplete="current-password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></label>
          <label className="field">New password<input type="password" autoComplete="new-password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /><span className="help">12+ characters mixing upper/lowercase, digits or symbols.</span></label>
          <label className="field">Confirm new password<input type="password" autoComplete="new-password" value={f.confirm} aria-invalid={mismatch} onChange={(e) => setF({ ...f, confirm: e.target.value })} />{mismatch && <span className="err">Passwords don't match.</span>}</label>
          <InlineError error={m.error} />
          <div><button className="btn dark" disabled={!f.current_password || !f.new_password || mismatch || m.isPending}>Update password</button></div>
        </form>
      </section>
      <p className="tiny faint" style={{ gridColumn: "1 / -1" }}>{BRAND.legal}</p>
    </div>
  );
}

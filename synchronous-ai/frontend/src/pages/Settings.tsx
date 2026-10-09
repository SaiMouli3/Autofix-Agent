import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Cpu, KeyRound, Plus, XCircle } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BRAND } from "../brand";
import { Shell } from "../components/Shell";
import { ErrorBox, KV, Loading, Modal, Notice, StatusBadge, Tabs, useToast } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, timeAgo } from "../lib/format";
import { useSession } from "../lib/session";

export default function SettingsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as any) || "providers";
  return (
    <Shell title="Settings">
      <div className="page-head"><div><h1>Settings</h1><p>Model providers, organization policies and your account.</p></div></div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ key: "providers", label: "Model providers" }, { key: "org", label: "Organization" }, { key: "account", label: "Account" }, { key: "about", label: "About" }]} />
      {tab === "providers" && <Providers />}
      {tab === "org" && <OrgSettings />}
      {tab === "account" && <Account />}
      {tab === "about" && <About />}
    </Shell>
  );
}

function Providers() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["providers"], queryFn: () => api.get("/api/providers") });
  const [modal, setModal] = useState(false);
  const [keyFor, setKeyFor] = useState<any>(null);
  const [results, setResults] = useState<Record<string, any>>({});
  const test = useMutation({
    mutationFn: (id: string) => api.post(`/api/providers/${id}/test`, {}),
    onSuccess: (r) => { setResults((x) => ({ ...x, [r.provider.id]: r.result })); qc.invalidateQueries({ queryKey: ["providers"] }); toast(r.result.ok ? "ok" : "error", r.result.ok ? "Connection verified" : r.result.error?.message ?? "Test failed"); },
    onError: (e: any) => toast("error", e.message),
  });
  if (list.isLoading) return <Loading />;
  return (
    <div className="stack">
      <div className="row between">
        <Notice>API keys are encrypted at rest and only decrypted inside the backend when an agent runs. They are never returned to the browser, written to logs or exposed to agent tools.</Notice>
        {can("providers:write") && <button className="btn primary" onClick={() => setModal(true)}><Plus /> Add provider</button>}
      </div>
      <ErrorBox error={list.error} />
      {(list.data ?? []).map((p: any) => {
        const r = results[p.id] ?? p.last_test_result;
        return (
          <div className="card" key={p.id}>
            <div className="row between">
              <div className="row"><Cpu size={20} color="var(--accent)" /><div><div className="row"><b>{p.name}</b><StatusBadge status={p.status} /></div><div className="faint small">{p.kind_label} · {p.base_url}</div></div></div>
              <div className="row">
                {can("providers:test") && <button className="btn sm" disabled={test.isPending} onClick={() => test.mutate(p.id)}>{test.isPending && test.variables === p.id ? "Testing…" : "Test connection"}</button>}
                {can("providers:write") && <button className="btn sm" onClick={() => setKeyFor(p)}><KeyRound /> {p.has_credential ? "Rotate key" : "Set key"}</button>}
              </div>
            </div>
            <div className="grid cols-2 mt16">
              <KV items={[["Default model", p.default_model || "—"], ["Embedding model", p.embedding_model || "none (lexical retrieval)"], ["Credential", p.has_credential ? `configured · fingerprint ${p.credential_fingerprint}` : "missing"], ["Models available", p.model_count ? String(p.model_count) : "run a test to load the catalog"]]} />
              <div>
                <div className="section-title">Last connection test {p.last_tested_at && <span className="faint">· {timeAgo(p.last_tested_at)}</span>}</div>
                {!r?.checks && !r?.error && <div className="faint small">Not tested yet. Integration is not considered working until a test succeeds.</div>}
                {r?.checks?.map((c: any) => <div key={c.name} className="row small">{c.ok ? <CheckCircle2 size={15} color="var(--green)" /> : <XCircle size={15} color="var(--red)" />}<b>{c.name}</b><span className="faint">{c.detail}</span></div>)}
                {r?.error && <div className="error-text small mt8">{r.error.code}: {r.error.message}</div>}
                {r?.latency_ms != null && <div className="faint tiny mt8">{r.latency_ms} ms total · model {r.model}</div>}
              </div>
            </div>
            {can("providers:write") && <ProviderEdit p={p} />}
          </div>
        );
      })}
      {list.data?.length === 0 && <div className="card faint">No providers configured yet.</div>}
      {modal && <NewProvider onClose={() => setModal(false)} />}
      {keyFor && <SetKey p={keyFor} onClose={() => setKeyFor(null)} />}
    </div>
  );
}

function ProviderEdit({ p }: { p: any }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ default_model: p.default_model, embedding_model: p.embedding_model, base_url: p.base_url });
  const models = useQuery({ queryKey: ["models", p.id], queryFn: () => api.get(`/api/providers/${p.id}/models`), enabled: open && p.has_credential, retry: false });
  const save = useMutation({ mutationFn: () => api.put(`/api/providers/${p.id}`, f), onSuccess: () => { qc.invalidateQueries({ queryKey: ["providers"] }); setOpen(false); toast("ok", "Provider updated — re-test to verify"); }, onError: (e: any) => toast("error", e.message) });
  if (!open) return <button className="btn xs ghost mt8" onClick={() => setOpen(true)}>Edit configuration</button>;
  return (
    <div className="form-grid mt16">
      <label className="field">Default model
        {models.data?.models?.length ? <select value={f.default_model} onChange={(e) => setF({ ...f, default_model: e.target.value })}>{models.data.models.map((m: any) => <option key={m.id}>{m.id}</option>)}</select>
          : <input value={f.default_model} onChange={(e) => setF({ ...f, default_model: e.target.value })} />}</label>
      <label className="field">Embedding model<input value={f.embedding_model} onChange={(e) => setF({ ...f, embedding_model: e.target.value })} placeholder="e.g. text-embedding-3-small" /></label>
      <label className="field full">Base URL<input value={f.base_url} onChange={(e) => setF({ ...f, base_url: e.target.value })} /></label>
      <div className="row full"><button className="btn primary sm" onClick={() => save.mutate()}>Save</button><button className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button></div>
    </div>
  );
}

function NewProvider({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const kinds = useQuery({ queryKey: ["provider-kinds"], queryFn: () => api.get("/api/providers/kinds") });
  const [f, setF] = useState({ name: "Experiential Labs", kind: "experiential_labs", base_url: "https://api.experientiallabs.ai/v1", default_model: "", embedding_model: "text-embedding-3-small", api_key: "" });
  const m = useMutation({ mutationFn: () => api.post("/api/providers", f), onSuccess: () => { qc.invalidateQueries({ queryKey: ["providers"] }); onClose(); } });
  const kind = kinds.data?.[f.kind];
  return (
    <Modal title="Add model provider" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!f.name || m.isPending} onClick={() => m.mutate()}>Save provider</button></>}>
      <div className="form-grid">
        <label className="field">Provider type<select value={f.kind} onChange={(e) => { const k = kinds.data?.[e.target.value]; setF({ ...f, kind: e.target.value, name: k?.label ?? f.name, base_url: k?.default_base_url ?? "" }); }}>
          {Object.entries(kinds.data ?? {}).map(([k, v]: any) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        <label className="field">Display name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field full">Base URL<input value={f.base_url} disabled={kind && !kind.base_url_editable} onChange={(e) => setF({ ...f, base_url: e.target.value })} /></label>
        <label className="field">Default model<input value={f.default_model} onChange={(e) => setF({ ...f, default_model: e.target.value })} placeholder="choose after testing" /></label>
        <label className="field">Embedding model<input value={f.embedding_model} onChange={(e) => setF({ ...f, embedding_model: e.target.value })} /></label>
        <label className="field full">API key<input type="password" autoComplete="off" value={f.api_key} onChange={(e) => setF({ ...f, api_key: e.target.value })} /><span className="help">Encrypted before storage. It cannot be viewed again — only rotated.</span></label>
      </div>
      <div className="mt16"><ErrorBox error={m.error} /></div>
    </Modal>
  );
}

function SetKey({ p, onClose }: { p: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [k, setK] = useState("");
  const m = useMutation({ mutationFn: () => api.post(`/api/providers/${p.id}/credential`, { api_key: k }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["providers"] }); onClose(); } });
  return (
    <Modal title={`${p.has_credential ? "Rotate" : "Set"} API key — ${p.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={k.length < 8} onClick={() => m.mutate()}>Save key</button></>}>
      <input type="password" autoComplete="off" value={k} onChange={(e) => setK(e.target.value)} placeholder="Paste the new key" aria-label="API key" />
      <div className="mt16"><ErrorBox error={m.error} /></div>
    </Modal>
  );
}

function OrgSettings() {
  const { me, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [distinct, setDistinct] = useState(!!me.org.settings?.require_distinct_approver);
  const save = useMutation({ mutationFn: () => api.put("/api/org/settings", { require_distinct_approver: distinct }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); toast("ok", "Settings saved"); }, onError: (e: any) => toast("error", e.message) });
  return (
    <div className="card">
      <KV items={[["Organization", me.org.name], ["Slug", me.org.slug], ["Environment", me.env], ["Agent runtime", me.runtime === "docker" ? "Docker sandbox (OpenHands agent-server per execution)" : "Local process (development; not an isolation boundary)"]]} />
      <div className="section-title mt24">Approval policy</div>
      <label className="check"><input type="checkbox" checked={distinct} disabled={!can("settings:write")} onChange={(e) => setDistinct(e.target.checked)} />
        <span>Require a different person than the task requester to approve sensitive actions (four-eyes principle).</span></label>
      {can("settings:write") && <button className="btn primary mt16" onClick={() => save.mutate()}>Save</button>}
    </div>
  );
}

function Account() {
  const { me } = useSession();
  const toast = useToast();
  const [f, setF] = useState({ current_password: "", new_password: "" });
  const m = useMutation({ mutationFn: () => api.post("/api/auth/change-password", f), onSuccess: () => { setF({ current_password: "", new_password: "" }); toast("ok", "Password changed. Other sessions were signed out."); } });
  return (
    <div className="grid cols-2">
      <div className="card">
        <div className="card-title">Profile</div>
        <KV items={[["Name", me.user.name], ["Email", me.user.email], ["Role", me.role_label], ["Permissions", <span key="p" className="small faint">{me.permissions.join(", ")}</span>]]} />
      </div>
      <div className="card">
        <div className="card-title">Change password</div>
        {me.user.must_change_password && <div className="mb16"><Notice kind="warn">You are using a temporary password. Please change it now.</Notice></div>}
        <div className="stack">
          <label className="field">Current password<input type="password" autoComplete="current-password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></label>
          <label className="field">New password<input type="password" autoComplete="new-password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /><span className="help">12+ characters, mixing upper/lowercase, digits or symbols.</span></label>
          <ErrorBox error={m.error} />
          <button className="btn primary" disabled={!f.current_password || !f.new_password} onClick={() => m.mutate()}>Update password</button>
        </div>
      </div>
    </div>
  );
}

function About() {
  return (
    <div className="card">
      <div className="row"><img src={BRAND.logo} alt="" width={40} /><div><b>{BRAND.name}</b><div className="faint small">{BRAND.tagline}</div></div></div>
      <p className="muted mt16">{BRAND.legal}</p>
      <p className="muted small">Agent execution uses the OpenHands Software Agent SDK (openhands-sdk, openhands-tools, openhands-workspace — MIT License, © OpenHands contributors). See NOTICE and THIRD_PARTY_LICENSES in the repository.</p>
      <p className="faint small">Build {dateTime(new Date().toISOString())}</p>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, CheckCircle2, ExternalLink, FileJson, KeyRound, Plug, Plus, Power, ShieldCheck, Trash2, Wand2, X, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { SignInAppForm, useSignInApps } from "../components/SignInApps";
import { Shell } from "../components/Shell";
import { Alert, Dialog, Empty, ErrorState, InlineError, KV, SearchField, SkeletonRows, Status, Tabs, Tag, useConfirm, useToast } from "../components/ui";
import { api } from "../lib/api";
import { fullDateTime, timeAgo } from "../lib/format";
import { useSession } from "../lib/session";
import { integrationState, providerState } from "../lib/status";

const CATEGORIES: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "providers", label: "AI model providers" },
  { key: "mcp", label: "MCP servers" },
  { key: "business_api", label: "Business APIs" },
  { key: "developer_tools", label: "Developer tools" },
  { key: "database", label: "Databases" },
  { key: "communication", label: "Communication" },
  { key: "documents", label: "Document systems" },
  { key: "other", label: "Other" },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
const AUTH_LABEL: Record<string, string> = { none: "None", bearer: "Bearer token", api_key_header: "API key (header)", api_key_query: "API key (query)", basic: "Basic auth", oauth2: "OAuth 2.0 sign-in (PKCE)" };

export default function Integrations() {
  const { can } = useSession();
  const [sp, setSp] = useSearchParams();
  const cat = sp.get("cat") ?? "";
  const sel = sp.get("id") ?? "";
  const [q, setQ] = useState("");
  const [modal, setModal] = useState<"" | "new" | "import" | "connectors">("");
  const [proposal, setProposal] = useState<any>(null);
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: ({ signal }) => api.get("/api/integrations", signal), refetchInterval: 30000 });
  const providers = useQuery({ queryKey: ["providers"], queryFn: ({ signal }) => api.get("/api/providers", signal), refetchInterval: 30000 });
  const rows = useMemo(() => {
    const ints = (integrations.data ?? []).map((i: any) => ({ kind: "integration", id: i.id, name: i.name, desc: i.description, cat: i.type === "mcp" ? "mcp" : i.category, state: integrationState(i),
      auth: i.oauth ? (i.oauth.connected ? "OAuth · connected" : "OAuth · not connected") : i.type === "mcp" ? (i.has_credential ? `${i.config.auth_header} header` : "None") : AUTH_LABEL[i.config?.auth?.type ?? "none"],
      agents: i.permitted_agents.length, ops: i.type === "http" ? (i.config.operations ?? []).filter((o: any) => o.enabled).length : i.health?.tools?.length ?? null,
      last: i.last_success_at, error: i.health?.ok === false ? i.health.detail : null, raw: i }));
    const provs = (providers.data ?? []).map((p: any) => ({ kind: "provider", id: p.id, name: p.name, desc: `${p.kind_label} · ${p.base_url}`, cat: "providers", state: providerState(p),
      auth: p.has_credential ? "API key (stored encrypted)" : "No key", agents: null, ops: p.model_count || null, last: p.status === "ok" ? p.last_tested_at : null,
      error: p.status === "error" ? p.last_test_result?.error?.message : null, raw: p }));
    return [...provs, ...ints];
  }, [integrations.data, providers.data]);
  const counts = (k: string) => (k ? rows.filter((r) => r.cat === k).length : rows.length);
  const visible = rows.filter((r) => (!cat || r.cat === cat) && (!q || `${r.name} ${r.desc}`.toLowerCase().includes(q.toLowerCase())));
  const current = rows.find((r) => r.id === sel);
  const toast = useToast();
  const qc = useQueryClient();
  const oauthError = sp.get("oauth_error");
  const oauthHandled = useRef(false);
  useEffect(() => {
    // Returning from a vendor sign-in (/api/oauth/callback redirects here). The ref keeps the toast
    // single when React StrictMode runs effects twice in development.
    if (sp.get("oauth") === "connected" && !oauthHandled.current) {
      oauthHandled.current = true;
      toast("ok", "Connected. The platform now holds an encrypted, auto-refreshing token. Checking the connection…");
      const id = sp.get("id");
      // Verify the new token right away so the status reads Connected without another click.
      if (id && can("integrations:write")) api.post(`/api/integrations/${id}/test`).catch(() => undefined).finally(() => qc.invalidateQueries({ queryKey: ["integrations"] }));
      qc.invalidateQueries({ queryKey: ["integrations"] });
      const n = new URLSearchParams(sp); n.delete("oauth"); setSp(n, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (id: string) => { const n = new URLSearchParams(sp); n.set("id", id); setSp(n, { replace: true }); };
  const close = () => { const n = new URLSearchParams(sp); n.delete("id"); setSp(n, { replace: true }); };

  return (
    <Shell crumbs={[{ label: "Integrations" }]}>
      <div className="page-head">
        <div><h1>Integrations</h1><p>Model providers, MCP servers and business APIs. Credentials stay on the server; agents only reach operations an administrator enabled for them.</p></div>
        {can("integrations:write") && (
          <div className="row">
            <button className="btn" onClick={() => setModal("import")}><Wand2 /> Import from docs</button>
            <button className="btn" onClick={() => { setProposal(null); setModal("new"); }}><Plus /> Custom integration</button>
            <button className="btn primary" onClick={() => setModal("connectors")}><Blocks /> Browse connectors</button>
          </div>
        )}
      </div>
      {oauthError && (
        <div style={{ marginBottom: 12 }}><Alert kind="error" actions={<button className="btn sm" onClick={() => { const n = new URLSearchParams(sp); n.delete("oauth_error"); setSp(n, { replace: true }); }}>Dismiss</button>}>
          <b>Sign-in was not completed.</b> {oauthError}
        </Alert></div>
      )}
      <div className="filters" role="group" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button key={c.key} className="chip-btn" aria-pressed={cat === c.key} onClick={() => { const n = new URLSearchParams(sp); c.key ? n.set("cat", c.key) : n.delete("cat"); setSp(n, { replace: true }); }}>
            {c.label} <span className="c">{counts(c.key)}</span>
          </button>
        ))}
      </div>
      <div className="filters"><SearchField value={q} onChange={setQ} placeholder="Search integrations" label="Search integrations" /></div>
      <div className={current ? "split" : ""} style={current ? { gridTemplateColumns: "minmax(0, 1fr) minmax(380px, 460px)" } : undefined}>
        <div className="panel">
          {(integrations.isLoading || providers.isLoading) && <SkeletonRows rows={5} />}
          {integrations.isError && <div className="panel-body"><ErrorState error={integrations.error} onRetry={() => integrations.refetch()} what="integrations" /></div>}
          {integrations.data && providers.data && visible.length === 0 && (
            <Empty icon={Plug} title={rows.length ? "Nothing in this category" : "No integrations yet"}
              action={can("integrations:write") && !rows.length ? <button className="btn primary" onClick={() => setModal("connectors")}><Blocks /> Browse connectors</button> : undefined}>
              Start from a prebuilt connector (Shopify, Meta Ads, WhatsApp), register any HTTP API from an OpenAPI document or plain documentation, or connect an MCP server.
            </Empty>
          )}
          {visible.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Name</th><th scope="col">Status</th><th scope="col" className="hide-sm">Authentication</th><th scope="col" className="right hide-sm">Agents</th><th scope="col" className="right hide-sm">Operations</th><th scope="col">Last success</th></tr></thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.id} className={`click ${r.id === sel ? "sel" : ""}`} onClick={() => open(r.id)}>
                      <td className="title-cell">
                        <span className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                        <BrandLogo connectorKey={r.raw?.connector_key} name={r.name} vendor={r.kind === "provider" ? r.raw?.kind_label : r.name} size={28} />
                        <span style={{ minWidth: 0 }}>
                        <button className="disclose strong" style={{ color: "var(--ink)", fontSize: 13 }} onClick={(e) => { e.stopPropagation(); open(r.id); }}>{r.name}</button>
                        <div className="tiny muted ellipsis">{CAT_LABEL[r.cat]}{r.error ? ` · ${r.error}` : r.desc ? ` · ${r.desc}` : ""}</div>
                        </span>
                        </span>
                      </td>
                      <td><Status status={r.state} /></td>
                      <td className="small hide-sm">{r.auth}</td>
                      <td className="right num hide-sm">{r.agents ?? "—"}</td>
                      <td className="right num hide-sm">{r.ops ?? "—"}</td>
                      <td className="muted nowrap">{r.last ? timeAgo(r.last) : "Never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {current?.kind === "integration" && <IntegrationDetail key={current.id} id={current.id} onClose={close} />}
        {current?.kind === "provider" && <ProviderDetail key={current.id} p={current.raw} onClose={close} />}
      </div>
      {modal === "new" && <IntegrationForm initial={proposal} onClose={() => setModal("")} onCreated={(id) => { setModal(""); open(id); }} />}
      {modal === "connectors" && <ConnectorGallery onClose={() => setModal("")} onCreated={(id) => { setModal(""); open(id); }}
        onImport={() => setModal("import")} onCustom={() => { setProposal(null); setModal("new"); }} />}
      {modal === "import" && <ImportDialog onClose={() => setModal("")} onProposal={(p) => { setProposal(p); setModal("new"); }} />}
    </Shell>
  );
}

// ------------------------------------------------------------------ provider detail (read-mostly; full editing in Settings)

function ProviderDetail({ p, onClose }: { p: any; onClose: () => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const test = useMutation({
    mutationFn: () => api.post(`/api/providers/${p.id}/test`, {}),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["providers"] }); toast(r.result.ok ? "ok" : "error", r.result.ok ? "Connection verified with a live request" : r.result.error?.message ?? "Connection test failed"); },
    onError: (e: any) => toast("error", e.message),
  });
  const r = p.last_test_result;
  return (
    <aside className="panel" aria-label={`${p.name} details`}>
      <div className="panel-head"><div><h2>{p.name}</h2><div className="tiny muted">AI model provider · {p.kind_label}</div></div><button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X /></button></div>
      <div className="panel-body stack">
        <Status status={providerState(p)} />
        <KV items={[["Endpoint", <span key="e" className="mono">{p.base_url}</span>], ["Authentication", p.has_credential ? `API key · ${p.credential_fingerprint}` : "No key stored"], ["Default model", <span key="m" className="mono">{p.default_model || "—"}</span>], ["Embeddings", p.embedding_model || "Not configured"], ["Last check", p.last_tested_at ? fullDateTime(p.last_tested_at) : "Never"]]} />
        {r?.checks && <div className="stack tight">{r.checks.map((c: any) => <div key={c.name} className="row small">{c.ok ? <CheckCircle2 size={14} color="var(--success)" /> : <XCircle size={14} color="var(--danger)" />}<b>{c.name.replace(/_/g, " ")}</b><span className="muted">{c.detail}</span></div>)}</div>}
        {r?.error && <Alert kind="error">{r.error.message}</Alert>}
        <div className="row">
          {can("providers:test") && <button className="btn sm dark" onClick={() => test.mutate()} disabled={test.isPending}>{test.isPending ? "Testing…" : "Test connection"}</button>}
          <Link className="btn sm" to="/settings?tab=providers">Manage in Settings</Link>
        </div>
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ integration detail

function IntegrationDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["integration", id], queryFn: ({ signal }) => api.get(`/api/integrations/${id}`, signal) });
  const [tab, setTab] = useState<"ops" | "checks" | "audit">("ops");
  const [cred, setCred] = useState("");
  const [perm, setPerm] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["integration", id] }); qc.invalidateQueries({ queryKey: ["integrations"] }); };
  const act = (fn: () => Promise<any>, ok: string) => ({ mutationFn: fn, onSuccess: () => { refresh(); toast("ok", ok); }, onError: (e: any) => toast("error", e.message) });
  const test = useMutation({ mutationFn: () => api.post(`/api/integrations/${id}/test`), onSuccess: (r) => { refresh(); toast(r.result.ok ? "ok" : "error", r.result.detail ?? "Test finished"); }, onError: (e: any) => toast("error", e.message) });
  const activate = useMutation(act(() => api.post(`/api/integrations/${id}/activate`), "Integration approved and activated"));
  const disable = useMutation(act(() => api.post(`/api/integrations/${id}/disable`), "Integration disabled"));
  const saveCred = useMutation(act(() => api.post(`/api/integrations/${id}/credential`, { credential: cred }), "Credential stored encrypted"));
  const saveOps = useMutation({ mutationFn: (ops: any[]) => api.put(`/api/integrations/${id}`, { config: { ...q.data.config, operations: ops } }), onSuccess: (r) => { refresh(); toast("ok", r.status === "proposed" ? "Saved. The change needs re-approval before agents can use it." : "Operations updated"); }, onError: (e: any) => toast("error", e.message) });
  const setCat = useMutation(act((cat?: any) => api.put(`/api/integrations/${id}`, { category: cat }), "Category updated"));
  const remove = useMutation({ mutationFn: () => api.del(`/api/integrations/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["integrations"] }); toast("ok", "Integration removed"); onClose(); }, onError: (e: any) => toast("error", e.message) });
  if (q.isLoading) return <aside className="panel"><SkeletonRows rows={6} /></aside>;
  if (q.error) return <aside className="panel panel-body"><ErrorState error={q.error} what="this integration" /></aside>;
  const i = q.data;
  const state = integrationState(i);
  const ops = i.config.operations ?? [];
  const write = can("integrations:write");
  const failing = (i.validation ?? []).filter((c: any) => !c.ok);
  const needsCred = i.oauth ? true : i.type === "http" ? (i.config.auth?.type ?? "none") !== "none" : false;
  return (
    <aside className="panel" aria-label={`${i.name} details`}>
      <div className="panel-head">
        <BrandLogo connectorKey={i.connector_key} name={i.name} size={32} />
        <div className="grow" style={{ minWidth: 0 }}><h2 className="ellipsis">{i.name}</h2><div className="tiny muted">{i.type === "mcp" ? "MCP server" : "HTTP API"} · {i.description || "No description"}</div></div>
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      <div className="panel-body stack">
        <div className="row between wrap">
          <Status status={state} />
          {write && (
            <div className="row">
              <button className="btn sm" onClick={() => test.mutate()} disabled={test.isPending}>{test.isPending ? "Testing…" : "Test connection"}</button>
              {i.status !== "active"
                ? <button className="btn sm dark" disabled={activate.isPending} onClick={async () => {
                  if (await confirm({ title: `Approve and activate ${i.name}?`, body: `Agents granted access can call ${i.type === "http" ? `${ops.filter((o: any) => o.enabled).length} enabled operation(s)` : "this server's tools"}. Write operations still require per-call approval.`, confirmLabel: "Activate" })) activate.mutate();
                }}><ShieldCheck /> Approve & activate</button>
                : <button className="btn sm" onClick={async () => { if (await confirm({ title: `Disable ${i.name}?`, body: "Agents lose access immediately. Configuration and audit history are kept.", confirmLabel: "Disable", danger: true })) disable.mutate(); }}><Power /> Disable</button>}
            </div>
          )}
        </div>
        {state === "needs_signin" && <Alert kind="warn">Not signed in yet. {i.oauth.client_configured ? "Click Connect below to sign in with the provider." : "Enter the OAuth client ID and secret from the provider's developer console below, then click Connect."}</Alert>}
        {state === "misconfigured" && <Alert kind="warn">{needsCred && !i.has_credential ? "A credential is required before this integration can connect." : "The configuration has validation errors (see Checks)."}</Alert>}
        {state !== "needs_signin" && i.health?.checked_at && !i.health.ok && <Alert kind="error">Last check {timeAgo(i.health.checked_at)}: {i.health.detail}</Alert>}
        <KV items={[
          ["Endpoint", <span key="e" className="mono">{i.type === "http" ? i.config.base_url : i.config.url || i.config.command}</span>],
          ["Authentication", i.oauth ? AUTH_LABEL.oauth2 : i.type === "http" ? AUTH_LABEL[i.config.auth?.type ?? "none"] : i.has_credential ? `${i.config.auth_header} header` : "None"],
          ...(i.oauth ? [] : [["Credential", i.has_credential ? <span key="c">Stored encrypted · <span className="mono">{i.credential_fingerprint}</span></span> : needsCred ? <span key="c" style={{ color: "var(--warning)" }}>Missing</span> : "Not required"] as [string, any]]),
          ["Category", write && i.type === "http" ? (
            <select key="cat" value={i.category} onChange={(e) => (setCat.mutate as any)(e.target.value)} style={{ height: 26, fontSize: 12.5 }} aria-label="Category">
              {CATEGORIES.filter((c) => !["", "providers", "mcp"].includes(c.key)).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>) : CAT_LABEL[i.type === "mcp" ? "mcp" : i.category]],
          ["Permitted agents", <span key="pa">{i.permitted_agents.map((a: any) => a.name).join(", ") || "None"} {write && can("agents:write") && <button className="disclose" onClick={() => setPerm(true)}>Edit</button>}</span>],
          ["Last success", i.last_success_at ? fullDateTime(i.last_success_at) : "Never"],
          ["Approved by", i.approved_by ? "an administrator" : "Not yet approved"],
        ]} />
        {i.oauth && <OAuthPanel i={i} write={write} onChanged={refresh} />}
        {write && !i.oauth && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (cred) { saveCred.mutate(); setCred(""); } }}>
            <label className="sr-only" htmlFor="cred">{i.has_credential ? "Rotate credential" : "Credential"}</label>
            <input id="cred" type="password" autoComplete="off" placeholder={i.has_credential ? "Rotate credential" : "Paste credential"} value={cred} onChange={(e) => setCred(e.target.value)} />
            <button className="btn sm" disabled={!cred}><KeyRound /> Save</button>
          </form>
        )}
        <Tabs label="Integration sections" value={tab} onChange={setTab} tabs={[{ key: "ops", label: i.type === "http" ? "Operations" : "Tools", count: ops.length || i.health?.tools?.length }, { key: "checks", label: "Checks", count: failing.length || null }, { key: "audit", label: "Audit", count: i.audit?.length }]} />
        {tab === "ops" && i.type === "http" && (ops.length === 0 ? <p className="small muted">No operations defined.</p> : (
          <table className="table">
            <thead><tr><th scope="col">Operation</th><th scope="col">Enabled</th><th scope="col">Approval</th></tr></thead>
            <tbody>{ops.map((o: any) => (
              <tr key={o.name}>
                <td><div className="row" style={{ gap: 6 }}><Tag tone={!opWrites(o) ? "" : o.destructive ? "danger" : "warning"} mono>{o.graphql ? `GraphQL ${o.graphql}` : o.method}</Tag><b className="small">{o.name}</b></div>
                  <div className="tiny muted mono ellipsis" style={{ maxWidth: 220 }}>{o.path}</div></td>
                <td><input type="checkbox" checked={o.enabled} disabled={!write} aria-label={`Enable ${o.name}`} onChange={async () => {
                  if (!o.enabled && opWrites(o) && !(await confirm({ title: `Enable ${o.graphql ? "GraphQL mutation" : o.method} ${o.name}?`, body: "This operation can change data in the external system. Each call will still wait for human approval.", confirmLabel: "Enable" }))) return;
                  saveOps.mutate(ops.map((x: any) => (x.name === o.name ? { ...x, enabled: !x.enabled } : x)));
                }} /></td>
                <td>{o.destructive ? <Tag tone="danger">always</Tag> : <input type="checkbox" checked={o.requires_approval} disabled={!write} aria-label={`Require approval for ${o.name}`} onChange={() => saveOps.mutate(ops.map((x: any) => (x.name === o.name ? { ...x, requires_approval: !x.requires_approval } : x)))} />}</td>
              </tr>
            ))}</tbody>
          </table>
        ))}
        {tab === "ops" && i.type === "mcp" && (i.health?.tools?.length ? <div className="row wrap" style={{ gap: 4 }}>{i.health.tools.map((t: string) => <Tag key={t} mono>{t}</Tag>)}</div> : <p className="small muted">Run a connection test to list this server's tools.</p>)}
        {tab === "checks" && <div className="stack tight">{(i.validation ?? []).map((c: any) => (
          <div key={c.check} className="row small" style={{ alignItems: "flex-start" }}>{c.ok ? <CheckCircle2 size={14} color="var(--success)" /> : <XCircle size={14} color={c.severity === "warning" ? "var(--warning)" : "var(--danger)"} />}<span><b className="mono" style={{ fontSize: 12 }}>{c.check}</b> <span className="muted">{c.detail}</span></span></div>
        ))}</div>}
        {tab === "audit" && ((i.audit ?? []).length === 0 ? <p className="small muted">No audit events yet.</p> : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>{i.audit.map((e: any) => (
            <li key={e.id} className="row small" style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
              <span className="mono muted nowrap" style={{ fontSize: 11 }}>{fullDateTime(e.ts)}</span><Tag mono>{e.action}</Tag><span className="muted">{e.actor_type}</span>
            </li>))}</ol>
        ))}
        {write && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
            <button className="btn sm danger" disabled={remove.isPending} onClick={async () => {
              if (i.permitted_agents.length) { toast("error", "Revoke agent access before removing this integration."); setPerm(true); return; }
              if (await confirm({ title: `Remove ${i.name}?`, body: "The configuration and its stored credential are deleted. Audit history is kept. This cannot be undone.", confirmLabel: "Remove integration", danger: true, requireText: i.name })) remove.mutate();
            }}><Trash2 /> Remove integration</button>
          </div>
        )}
      </div>
      {perm && <PermissionsDialog integration={i} onClose={() => setPerm(false)} onSaved={refresh} />}
    </aside>
  );
}

function PermissionsDialog({ integration, onClose, onSaved }: { integration: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const agents = useQuery({ queryKey: ["agents", "nav"], queryFn: ({ signal }) => api.get("/api/agents?page_size=500", signal) });
  const [ids, setIds] = useState<string[]>(integration.permitted_agents.map((a: any) => a.id));
  const save = useMutation({
    mutationFn: () => api.put(`/api/integrations/${integration.id}/agents`, { agent_ids: ids }),
    onSuccess: () => { onSaved(); toast("ok", "Agent access updated. Changed agents received a new configuration version."); onClose(); },
  });
  return (
    <Dialog title={`Agents permitted to use ${integration.name}`} description="Each change creates a new configuration version for that agent. Running tasks keep their current access." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" disabled={save.isPending} onClick={() => save.mutate()}>Save access</button></>}>
      <div className="tool-list">
        {(agents.data?.items ?? []).map((a: any) => (
          <label key={a.id} className="choice" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={ids.includes(a.id)} onChange={(e) => setIds(e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id))} style={{ marginTop: 2 }} />
            <span className="grow"><b className="small">{a.name}</b><span className="tiny muted" style={{ display: "block" }}>{a.category}</span></span>
          </label>
        ))}
      </div>
      {integration.status !== "active" && <div className="mt12"><Alert kind="warn">The integration isn't active yet; agents get access once it is approved.</Alert></div>}
      <InlineError error={save.error} />
    </Dialog>
  );
}

// ------------------------------------------------------------------ create / import

function IntegrationForm({ initial, onClose, onCreated }: { initial?: any; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<"http" | "mcp">(initial?.type ?? "http");
  const [name, setName] = useState(initial?.name?.toLowerCase().replace(/[^a-z0-9 _.-]/g, "").slice(0, 60) ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState("business_api");
  const [credential, setCredential] = useState("");
  const [base, setBase] = useState(initial?.config?.base_url ?? "");
  const [auth, setAuth] = useState(initial?.config?.auth ?? { type: "bearer" });
  const [health, setHealth] = useState(initial?.config?.health_check_path ?? "");
  const [opsText, setOpsText] = useState(JSON.stringify(initial?.config?.operations ?? [
    { name: "get_customer", description: "Fetch a customer by id", method: "GET", path: "/customers/{id}", params_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  ], null, 2));
  const [mcp, setMcp] = useState({ transport: "http", url: "", auth_header: "Authorization", auth_scheme: "Bearer" });
  const [err, setErr] = useState<any>(null);
  const create = useMutation({
    mutationFn: async () => {
      let config: any;
      if (type === "http") {
        let operations;
        try { operations = JSON.parse(opsText); } catch { throw new Error("Operations must be valid JSON (an array)."); }
        config = { base_url: base, auth, health_check_path: health, operations };
      } else config = mcp;
      return api.post("/api/integrations", { name, description, type, category, config, credential: credential || null });
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["integrations"] }); onCreated(r.id); },
    onError: setErr,
  });
  return (
    <Dialog size="wide" title={initial ? "Review proposed integration" : "Add integration"} onClose={onClose}
      description="New integrations start as “awaiting review”. Test and approve them before any agent can use them."
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" disabled={!name || create.isPending || (type === "http" ? !base : !mcp.url)} onClick={() => create.mutate()}>Save for review</button></>}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="form-grid">
          <label className="field"><span className="req">Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="crm" /></label>
          <label className="field">Type
            <select value={type} onChange={(e) => setType(e.target.value as any)} disabled={!!initial}><option value="http">HTTP API</option><option value="mcp">MCP server</option></select>
          </label>
          {type === "http" && <label className="field">Category<select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.filter((c) => !["", "providers", "mcp"].includes(c.key)).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>}
          <label className="field"><span>Description</span><input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        </div>
        {type === "http" ? (
          <>
            <div className="form-grid">
              <label className="field full"><span className="req">Base URL</span><input value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://api.example.com" /><span className="help">Private, loopback and cloud-metadata addresses are blocked unless allow-listed by an administrator.</span></label>
              <label className="field">Authentication
                <select value={auth.type} onChange={(e) => setAuth({ ...auth, type: e.target.value })}>{Object.entries(AUTH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              {auth.type === "api_key_header" && <label className="field">Header name<input value={auth.header_name ?? "X-API-Key"} onChange={(e) => setAuth({ ...auth, header_name: e.target.value })} /></label>}
              {auth.type === "api_key_query" && <label className="field">Query parameter<input value={auth.query_name ?? "api_key"} onChange={(e) => setAuth({ ...auth, query_name: e.target.value })} /></label>}
              {auth.type === "basic" && <label className="field">Username<input value={auth.username ?? ""} onChange={(e) => setAuth({ ...auth, username: e.target.value })} /></label>}
              <label className="field">Health-check path<input value={health} onChange={(e) => setHealth(e.target.value)} placeholder="/health" /></label>
            </div>
            <label className="field">Operations (JSON)
              <textarea className="mono" rows={12} value={opsText} onChange={(e) => setOpsText(e.target.value)} spellCheck={false} style={{ fontSize: 12 }} />
              <span className="help">Each operation: name, description, method, path (with {"{params}"}), params_schema. DELETE is always treated as destructive; write operations need approval when enabled.</span>
            </label>
          </>
        ) : (
          <div className="form-grid">
            <label className="field">Transport<select value={mcp.transport} onChange={(e) => setMcp({ ...mcp, transport: e.target.value })}><option value="http">Streamable HTTP</option><option value="sse">Server-sent events</option></select></label>
            <label className="field"><span className="req">Server URL</span><input value={mcp.url} onChange={(e) => setMcp({ ...mcp, url: e.target.value })} placeholder="https://mcp.example.com/mcp" /></label>
            <label className="field">Auth header<input value={mcp.auth_header} onChange={(e) => setMcp({ ...mcp, auth_header: e.target.value })} /></label>
            <label className="field">Auth scheme<input value={mcp.auth_scheme} onChange={(e) => setMcp({ ...mcp, auth_scheme: e.target.value })} placeholder="Bearer, or blank for a raw value" /></label>
          </div>
        )}
        <label className="field">Credential<input type="password" autoComplete="off" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="Optional now; can be added later" />
          <span className="help">Encrypted at rest and never shown again. It is injected server-side; agents never see it.</span></label>
        <InlineError error={err} />
      </div>
    </Dialog>
  );
}

function ImportDialog({ onClose, onProposal }: { onClose: () => void; onProposal: (p: any) => void }) {
  const [mode, setMode] = useState<"openapi" | "describe">("openapi");
  const [spec, setSpec] = useState("");
  const [goal, setGoal] = useState("");
  const [docs, setDocs] = useState("");
  const [result, setResult] = useState<any>(null);
  const gen = useMutation({
    mutationFn: () => (mode === "openapi" ? api.post("/api/integrations/import/openapi", { spec }) : api.post("/api/integrations/import/describe", { description: goal, documentation: docs })),
    onSuccess: setResult,
  });
  return (
    <Dialog size="wide" title="Generate an integration from documentation" onClose={onClose}
      description="The platform proposes operations and checks; you review everything before it is saved. Credentials are never extracted."
      footer={result
        ? <><button className="btn" onClick={() => setResult(null)}>Back</button><button className="btn dark" onClick={() => onProposal(result.proposal)}>Review & edit proposal</button></>
        : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" disabled={gen.isPending || (mode === "openapi" ? spec.length < 10 : !goal || docs.length < 20)} onClick={() => gen.mutate()}>{gen.isPending ? "Analyzing…" : "Generate proposal"}</button></>}>
      {!result ? (
        <div className="stack">
          <div className="seg" role="group" aria-label="Source">
            <button aria-pressed={mode === "openapi"} onClick={() => setMode("openapi")}><FileJson /> OpenAPI / Swagger</button>
            <button aria-pressed={mode === "describe"} onClick={() => setMode("describe")}><Wand2 /> Plain documentation</button>
          </div>
          {mode === "openapi" ? (
            <label className="field">Specification (JSON or YAML)<textarea className="mono" rows={14} value={spec} onChange={(e) => setSpec(e.target.value)} spellCheck={false} style={{ fontSize: 12 }} /></label>
          ) : (
            <>
              <label className="field">What should the integration do?<input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Let support agents look up orders and shipment status" /></label>
              <label className="field">Documentation<textarea rows={12} value={docs} onChange={(e) => setDocs(e.target.value)} placeholder="Paste the relevant API reference" />
                <span className="help">A configured model drafts the operations. The output is validated against the schema; write operations start disabled.</span></label>
            </>
          )}
          <InlineError error={gen.error} />
        </div>
      ) : (
        <div className="stack">
          <KV items={[["Name", result.proposal.name], ["Base URL", <span key="b" className="mono">{result.proposal.config.base_url || "—"}</span>], ["Authentication", AUTH_LABEL[result.proposal.config.auth?.type ?? "none"]], ["Operations", `${result.proposal.config.operations.length} (${result.proposal.config.operations.filter((o: any) => o.enabled).length} read-only enabled)`]]} />
          <div className="section-title">Generated checks</div>
          <div className="stack tight">{result.validation.map((c: any) => (
            <div key={c.check} className="row small">{c.ok ? <CheckCircle2 size={14} color="var(--success)" /> : <XCircle size={14} color={c.severity === "warning" ? "var(--warning)" : "var(--danger)"} />}<b className="mono" style={{ fontSize: 12 }}>{c.check}</b><span className="muted">{c.detail}</span></div>
          ))}</div>
          <Alert kind="info">{result.note}</Alert>
        </div>
      )}
    </Dialog>
  );
}

/** Whether an operation can change data in the external system (GraphQL queries are read-only). */
function opWrites(o: any) {
  return o.graphql ? o.graphql !== "query" : o.method !== "GET";
}

// ------------------------------------------------------------------ prebuilt connectors

function ConnectorGallery({ onClose, onCreated, onImport, onCustom }: { onClose: () => void; onCreated: (id: string) => void; onImport: () => void; onCustom: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({ queryKey: ["connectors"], queryFn: ({ signal }) => api.get("/api/integrations/connectors", signal) });
  const [pick, setPick] = useState<any>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [credential, setCredential] = useState("");
  const [client, setClient] = useState({ client_id: "", client_secret: "" });
  const [touched, setTouched] = useState(false);
  const errors: Record<string, string> = {};
  for (const p of pick?.params ?? []) {
    const v = (values[p.key] ?? p.default ?? "").trim();
    if (!v) errors[p.key] = `${p.label} is required.`;
  }
  const { can } = useSession();
  const apps = useSignInApps();
  const app = pick?.oauth_provider ? (apps.data ?? []).find((a: any) => a.provider === pick.oauth_provider) : null;
  const [ownClient, setOwnClient] = useState(false);
  const oneClick = pick?.auth === "oauth2" && !!pick.oauth_ready && !ownClient;
  const create = useMutation({
    mutationFn: () => api.post(`/api/integrations/connectors/${pick.key}`, {
      params: Object.fromEntries((pick.params ?? []).map((p: any) => [p.key, (values[p.key] ?? p.default ?? "").trim()])),
      credential: credential || null,
      oauth_client: pick.auth === "oauth2" && client.client_id.trim() ? { client_id: client.client_id.trim(), client_secret: client.client_secret.trim() || null } : null,
    }),
    onSuccess: async (i) => {
      qc.invalidateQueries({ queryKey: ["integrations"] });
      if (i.oauth?.client_configured) {
        // One click: go straight to the provider's sign-in page; the callback brings the user back connected.
        try {
          const r = await api.post(`/api/integrations/${i.id}/oauth/start`);
          window.location.assign(r.authorize_url);
          return;
        } catch (e: any) {
          toast("error", e.message);
          onCreated(i.id);
          return;
        }
      }
      toast("ok", i.oauth ? `${i.name} added. Next: Connect (sign in with ${pick.vendor}), test, then activate.` : `${i.name} added as proposed. Run a connection test, review its operations, then activate it.`);
      onCreated(i.id);
    },
  });
  const choose = (c: any) => { setPick(c); setValues({}); setCredential(""); setClient({ client_id: "", client_secret: "" }); setOwnClient(false); setTouched(false); create.reset(); };
  if (!pick) {
    return <ConnectorBrowser items={list.data} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
      onPick={choose} onClose={onClose} onImport={onImport} onCustom={onCustom} />;
  }
  return (
    <Dialog size="wide" title={`Connect ${pick.name}`} description={pick.summary} onClose={onClose}
      footer={<><button className="btn" onClick={() => setPick(null)}>Back</button>
        <button className="btn dark" disabled={create.isPending} onClick={() => { setTouched(true); if (!Object.keys(errors).length) create.mutate(); }}>
          {create.isPending ? (oneClick ? "Redirecting…" : "Adding…") : oneClick ? `Connect ${pick.vendor}` : "Add as proposed"}</button></>}>
      <div className="stack">
        <div className="row" style={{ gap: 10 }}><BrandLogo connectorKey={pick.key} name={pick.name} vendor={pick.vendor} size={40} />
          <div><b>{pick.name}</b><div className="tiny muted">{pick.vendor} · {pick.type === "mcp" ? "MCP server" : "API"}{pick.auth === "oauth2" ? " · one-click sign-in" : ""}</div></div></div>
        {pick.notes && <Alert kind="info">{pick.notes}</Alert>}
        {(pick.params ?? []).length > 0 && (
          <div className="form-grid">
            {pick.params.map((p: any) => (
              <label key={p.key} className="field"><span className="req">{p.label}</span>
                <input value={values[p.key] ?? p.default ?? ""} aria-invalid={touched && !!errors[p.key]} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} autoComplete="off" />
                {touched && errors[p.key] ? <span className="err">{errors[p.key]}</span> : p.help && <span className="help">{p.help}</span>}
              </label>
            ))}
          </div>
        )}
        {oneClick && (
          <Alert kind="info">Click <b>Connect {pick.vendor}</b> to sign in on {pick.vendor}'s own page. You come back here connected; no
            token or client ID to copy. Scopes requested: <span className="mono">{pick.oauth_client?.scopes}</span>.{" "}
            <button className="disclose" onClick={() => setOwnClient(true)}>Use a different OAuth client</button></Alert>
        )}
        {pick.auth === "oauth2" && !pick.oauth_ready && app && (can("settings:write")
          ? <div className="stack tight"><div className="section-title">Set up {app.name} sign-in once for your organization</div>
              <SignInAppForm app={app} onSaved={() => list.refetch().then((r) => setPick((r.data ?? []).find((c: any) => c.key === pick.key) ?? pick))} /></div>
          : <Alert kind="warn">{app.name} sign-in isn't set up for your organization yet. Ask an administrator to add it once in
              Settings → Sign-in apps; then you can connect with one click.</Alert>)}
        {pick.auth === "oauth2" && pick.oauth_client && (ownClient || (!pick.oauth_ready && !app)) && (
          <div className="stack tight">
            <div className="section-title">Sign-in with {pick.vendor} (OAuth 2.0 + PKCE)</div>
            <p className="small muted" style={{ margin: 0 }}>{pick.oauth_client.help}</p>
            <KV items={[["Callback URL", <CopyText key="cb" value={pick.oauth_redirect_uri} />], ["OAuth scopes", <span key="sc" className="mono small">{pick.oauth_client.scopes}</span>]]} />
            <div className="form-grid">
              <label className="field">Client ID<input value={client.client_id} onChange={(e) => setClient({ ...client, client_id: e.target.value })} autoComplete="off" /></label>
              <label className="field">Client secret<input type="password" value={client.client_secret} onChange={(e) => setClient({ ...client, client_secret: e.target.value })} autoComplete="off" /><span className="help">Stored encrypted. You can also add these later.</span></label>
            </div>
          </div>
        )}
        {pick.credential && (
          <label className="field">{pick.credential.label}
            <input type="password" autoComplete="off" value={credential} onChange={(e) => setCredential(e.target.value)} />
            <span className="help">{pick.credential.help} Stored encrypted; agents never see it. You can also add it later.</span>
          </label>
        )}
        {pick.operations && (
          <div>
            <div className="section-title">Operations</div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">Operation</th><th scope="col">Access</th><th scope="col">Initially</th></tr></thead>
                <tbody>{pick.operations.map((o: any) => (
                  <tr key={o.name}>
                    <td><b className="small mono">{o.name}</b><div className="tiny muted">{o.description}</div></td>
                    <td className="nowrap">{o.read_only ? <Tag>Read</Tag> : <Tag tone="warning">Change · approval</Tag>}</td>
                    <td className="small nowrap">{o.enabled ? "Enabled" : "Disabled"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
        <p className="tiny muted" style={{ margin: 0 }}><a href={pick.docs_url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)" }}>{pick.vendor} documentation <ExternalLink size={11} style={{ verticalAlign: -1 }} /></a></p>
        <InlineError error={create.error} />
      </div>
    </Dialog>
  );
}

function CopyText({ value }: { value: string }) {
  const toast = useToast();
  return (
    <span className="row" style={{ gap: 6, minWidth: 0 }}>
      <span className="mono small ellipsis" title={value}>{value}</span>
      <button type="button" className="btn xs ghost" onClick={() => navigator.clipboard.writeText(value).then(() => toast("ok", "Copied"), () => toast("error", "Copy failed; select the text instead"))}>Copy</button>
    </span>
  );
}

/** OAuth connection state and actions. Tokens never reach the browser: Connect sends the user to
 *  the vendor, whose redirect lands on the backend callback, which stores the tokens encrypted. */
function OAuthPanel({ i, write, onChanged }: { i: any; write: boolean; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const o = i.oauth;
  const [editing, setEditing] = useState(!o.client_configured);
  const [client, setClient] = useState({ client_id: "", client_secret: "" });
  const saveClient = useMutation({ mutationFn: () => api.put(`/api/integrations/${i.id}/oauth/client`, { client_id: client.client_id.trim(), client_secret: client.client_secret.trim() || null }),
    onSuccess: () => { setEditing(false); setClient({ client_id: "", client_secret: "" }); onChanged(); toast("ok", "Client credentials stored encrypted"); }, onError: (e: any) => toast("error", e.message) });
  const start = useMutation({ mutationFn: () => api.post(`/api/integrations/${i.id}/oauth/start`), onSuccess: (r) => window.location.assign(r.authorize_url) });
  const disconnect = useMutation({ mutationFn: () => api.post(`/api/integrations/${i.id}/oauth/disconnect`), onSuccess: (r) => { onChanged(); toast("ok", r.vendor_revoked ? "Disconnected and the provider revoked the token" : "Disconnected. The provider did not confirm revocation; revoke the app's access there if needed."); }, onError: (e: any) => toast("error", e.message) });
  return (
    <section className="panel" style={{ padding: 12, background: "var(--surface-2)" }} aria-label="Sign-in">
      <div className="row between wrap">
        <div className="row" style={{ gap: 8 }}>
          {o.connected && !o.needs_reauthorization ? <Status status="connected" label="Signed in" /> : o.needs_reauthorization ? <Status status="error" label="Sign-in expired" /> : <Status status="disconnected" label="Not signed in" />}
        </div>
        {write && (
          <div className="row">
            {o.connected && <button className="btn sm ghost" disabled={disconnect.isPending} onClick={async () => { if (await confirm({ title: `Disconnect ${i.name}?`, body: "The stored tokens are revoked (when the provider supports it) and deleted. Agents lose access until someone connects again. Client credentials are kept.", confirmLabel: "Disconnect", danger: true })) disconnect.mutate(); }}>Disconnect</button>}
            <button className="btn sm dark" disabled={!o.client_configured || start.isPending} onClick={() => start.mutate()} title={!o.client_configured ? "Add the client credentials first" : undefined}>
              {start.isPending ? "Redirecting…" : o.connected ? "Reconnect" : `Connect ${i.name}`}
            </button>
          </div>
        )}
      </div>
      {start.error && !start.isPending && <div className="mt8"><Alert kind="error">{(start.error as any).message}</Alert></div>}
      <div className="mt8">
        <KV items={[
          ["Callback URL", <CopyText key="cb" value={o.redirect_uri} />],
          ["Client", o.client_configured ? <span key="c" className="small"><span className="mono">{o.client_id_hint}</span>{o.client_source !== "integration" && <span className="muted"> · organization sign-in app</span>} {write && <button className="disclose" onClick={() => setEditing(!editing)}>{o.client_source === "integration" ? "Change" : "Use a different client"}</button>}</span> : <span key="c" style={{ color: "var(--warning)" }}>Not set up: an administrator adds the sign-in app in Settings → Sign-in apps</span>],
          ...(o.connected ? [
            ["Authorized", o.authorized_at ? fullDateTime(o.authorized_at) : "—"],
            ["Scopes", <span key="s" className="mono small">{o.scope || "as configured"}</span>],
            ...(o.instance_url ? [["Account host", <span key="h" className="mono small">{o.instance_url}</span>]] : []),
            ["Token", o.expires_at ? `expires ${fullDateTime(o.expires_at)} · refreshed automatically` : o.has_refresh_token ? "refreshed automatically when rejected" : "no refresh token: reconnect when it expires"],
          ] as [string, any][] : []),
        ]} />
      </div>
      {write && editing && (
        <form className="stack tight mt8" onSubmit={(e) => { e.preventDefault(); if (client.client_id.trim()) saveClient.mutate(); }}>
          <div className="form-grid">
            <label className="field">Client ID<input value={client.client_id} onChange={(e) => setClient({ ...client, client_id: e.target.value })} autoComplete="off" /></label>
            <label className="field">Client secret<input type="password" value={client.client_secret} onChange={(e) => setClient({ ...client, client_secret: e.target.value })} autoComplete="off" /></label>
          </div>
          {o.connected && <span className="tiny" style={{ color: "var(--warning)" }}>Changing the client disconnects the current sign-in.</span>}
          <div><button className="btn sm" disabled={!client.client_id.trim() || saveClient.isPending}><KeyRound /> Save client</button></div>
        </form>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ connector browser

function ConnectorCard({ c, onPick, reason }: { c: any; onPick: (c: any) => void; reason?: string | null }) {
  const reads = c.operations?.filter((o: any) => o.read_only).length ?? 0;
  const changes = c.operations ? c.operations.length - reads : 0;
  const added = c.connected?.length ?? 0;
  return (
    <button type="button" className="conn-card" disabled={!c.available} onClick={() => onPick(c)}
      aria-label={`${c.name} by ${c.vendor}${added ? ", already added" : ""}`}>
      <span className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <BrandLogo connectorKey={c.key} name={c.name} vendor={c.vendor} />
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="row between" style={{ gap: 6 }}>
            <b className="small ellipsis">{c.name}</b>
            {added > 0 && <Tag tone="success">{c.connected.some((x: any) => x.status === "active" || x.signed_in) ? "Connected" : "Added"}</Tag>}
          </span>
          <span className="tiny muted">{c.vendor} · {c.type === "mcp" ? "MCP server" : "API"}{c.auth === "oauth2" ? " · one-click sign-in" : ""}</span>
        </span>
      </span>
      <span className="small muted conn-summary">{c.summary}</span>
      {reason && <span className="tiny conn-reason">{reason}</span>}
      <span className="tiny faint">
        {!c.available ? <span style={{ color: "var(--warning)" }}>{c.unavailable_reason}</span>
          : c.operations ? `${reads} read${changes ? ` · ${changes} change with approval` : " · read-only"}` : "Tools listed after connecting"}
      </span>
    </button>
  );
}

function ConnectorBrowser({ items, loading, error, onRetry, onPick, onClose, onImport, onCustom }: {
  items?: any[]; loading: boolean; error: any; onRetry: () => void; onPick: (c: any) => void; onClose: () => void; onImport: () => void; onCustom: () => void;
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const all = items ?? [];
  const groups = Array.from(new Map(all.map((c) => [c.group, c.group_label])).entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const ql = q.trim().toLowerCase();
  const filtered = all.filter((c) => (!group || c.group === group) && (!ql || `${c.name} ${c.vendor} ${c.summary} ${c.group_label}`.toLowerCase().includes(ql)));
  const browsing = !ql && !group;
  const suggested = all.filter((c) => c.suggested_rank != null).sort((a, b) => a.suggested_rank - b.suggested_rank);
  const popular = [...all].filter((c) => c.suggested_rank == null && c.available).sort((a, b) => b.popularity - a.popularity).slice(0, 6);
  const byName = (a: any, b: any) => a.name.localeCompare(b.name);
  return (
    <Dialog size="xl" title="Connect an app" description="Prebuilt, reviewed connectors. Each is added as a proposed integration and only goes live after a successful connection test and an administrator's approval." onClose={onClose}
      footer={<div className="row between grow wrap" style={{ gap: 8 }}>
        <span className="tiny muted">Don't see your app?</span>
        <span className="row"><button className="btn sm" onClick={onImport}><Wand2 /> Import from API docs</button><button className="btn sm" onClick={onCustom}><Plus /> Custom integration</button></span>
      </div>}>
      <div className="stack">
        <div className="row wrap" style={{ gap: 8 }}>
          <div className="grow" style={{ minWidth: 220 }}><SearchField value={q} onChange={setQ} placeholder="Search apps, e.g. Gmail, CRM, tickets" label="Search connectors" /></div>
        </div>
        <div className="row wrap" role="group" aria-label="Connector category" style={{ gap: 6 }}>
          <button className="chip-btn" aria-pressed={!group} onClick={() => setGroup("")}>All <span className="c">{all.length}</span></button>
          {groups.map(([key, label]) => (
            <button key={key} className="chip-btn" aria-pressed={group === key} onClick={() => setGroup(group === key ? "" : key)}>
              {label} <span className="c">{all.filter((c) => c.group === key).length}</span>
            </button>
          ))}
        </div>
        {loading && <SkeletonRows rows={4} />}
        <ErrorState error={error} onRetry={onRetry} what="connectors" />
        {browsing && suggested.length > 0 && (
          <section aria-labelledby="sugg-h">
            <h3 id="sugg-h" className="section-title">Suggested for your agents</h3>
            <div className="conn-grid">{suggested.map((c) => <ConnectorCard key={c.key} c={c} onPick={onPick} reason={c.suggested_reason} />)}</div>
          </section>
        )}
        {browsing && popular.length > 0 && (
          <section aria-labelledby="pop-h">
            <h3 id="pop-h" className="section-title">Popular</h3>
            <div className="conn-grid">{popular.map((c) => <ConnectorCard key={c.key} c={c} onPick={onPick} />)}</div>
          </section>
        )}
        {browsing ? groups.map(([key, label]) => (
          <section key={key} aria-labelledby={`g-${key}`}>
            <h3 id={`g-${key}`} className="section-title">{label}</h3>
            <div className="conn-grid">{all.filter((c) => c.group === key).sort(byName).map((c) => <ConnectorCard key={c.key} c={c} onPick={onPick} />)}</div>
          </section>
        )) : (
          <section aria-label="Results">
            {filtered.length === 0
              ? <Empty title="No connector matches">Try another name, or add it from its API documentation or as a custom integration.</Empty>
              : <div className="conn-grid">{filtered.sort((a, b) => b.popularity - a.popularity).map((c) => <ConnectorCard key={c.key} c={c} onPick={onPick} reason={c.suggested_reason} />)}</div>}
          </section>
        )}
      </div>
    </Dialog>
  );
}

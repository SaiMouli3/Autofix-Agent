import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileJson, KeyRound, Plug, Plus, Power, Sparkles, Wand2, XCircle } from "lucide-react";
import { useState } from "react";
import { Shell } from "../components/Shell";
import { Empty, ErrorBox, KV, Loading, Modal, Notice, StatusBadge, Tabs, useToast } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, timeAgo } from "../lib/format";
import { useSession } from "../lib/session";

export default function Integrations() {
  const { can } = useSession();
  const list = useQuery({ queryKey: ["integrations"], queryFn: () => api.get("/api/integrations") });
  const [sel, setSel] = useState<string>("");
  const [modal, setModal] = useState<"" | "new" | "import">("");
  const items = list.data ?? [];
  const current = items.find((i: any) => i.id === sel) ?? items[0];
  return (
    <Shell title="Integrations">
      <div className="page-head">
        <div><h1>API & MCP integration center</h1><p>Connect business systems through a governed gateway. Credentials stay server-side; agents only see permitted operations, and write operations require approval.</p></div>
        {can("integrations:write") && (
          <div className="row">
            <button className="btn" onClick={() => setModal("import")}><Wand2 /> Import from docs</button>
            <button className="btn primary" onClick={() => setModal("new")}><Plus /> New integration</button>
          </div>
        )}
      </div>
      <ErrorBox error={list.error} />
      {list.isLoading && <Loading />}
      {list.data && items.length === 0 && (
        <div className="card"><Empty icon={Plug} title="No integrations yet" action={can("integrations:write") ? <button className="btn primary" onClick={() => setModal("import")}><Wand2 /> Import an OpenAPI spec</button> : undefined}>
          Register an HTTP API (manually, from an OpenAPI specification or from plain documentation) or an MCP server.</Empty></div>
      )}
      {items.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: "320px minmax(0,1fr)", alignItems: "start" }}>
          <div className="stack" style={{ gap: 8 }}>
            {items.map((i: any) => (
              <button key={i.id} className={`template ${current?.id === i.id ? "on" : ""}`} onClick={() => setSel(i.id)}>
                <Plug size={18} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <div className="row between"><b className="small ellipsis">{i.name}</b><StatusBadge status={i.status} /></div>
                  <div className="faint tiny">{i.type.toUpperCase()} · {i.permitted_agents.length} agent(s) · {i.health?.checked_at ? (i.health.ok ? "healthy" : "check failed") : "not tested"}</div>
                </span>
              </button>
            ))}
          </div>
          {current && <Detail key={current.id} id={current.id} />}
        </div>
      )}
      {modal === "new" && <NewIntegration onClose={() => setModal("")} onCreated={(id) => { setSel(id); setModal(""); }} />}
      {modal === "import" && <ImportIntegration onClose={() => setModal("")} onCreated={(id) => { setSel(id); setModal(""); }} />}
    </Shell>
  );
}

function Detail({ id }: { id: string }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["integration", id], queryFn: () => api.get(`/api/integrations/${id}`) });
  const [tab, setTab] = useState<"ops" | "health" | "audit">("ops");
  const [cred, setCred] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["integration", id] }); qc.invalidateQueries({ queryKey: ["integrations"] }); };
  const mut = (fn: () => Promise<any>, msg: string) => ({ mutationFn: fn, onSuccess: () => { refresh(); toast("ok", msg); }, onError: (e: any) => toast("error", e.message) });
  const test = useMutation({ mutationFn: () => api.post(`/api/integrations/${id}/test`), onSuccess: (r) => { refresh(); toast(r.result.ok ? "ok" : "error", r.result.detail); }, onError: (e: any) => toast("error", e.message) });
  const activate = useMutation(mut(() => api.post(`/api/integrations/${id}/activate`), "Integration activated"));
  const disable = useMutation(mut(() => api.post(`/api/integrations/${id}/disable`), "Integration disabled"));
  const saveCred = useMutation(mut(() => api.post(`/api/integrations/${id}/credential`, { credential: cred }), "Credential stored (encrypted)"));
  const saveOps = useMutation(mut((ops?: any) => api.put(`/api/integrations/${id}`, { config: { ...q.data.config, operations: ops } }), "Operations updated — re-activation required if it was active"));
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const i = q.data;
  const ops = i.config.operations ?? [];
  const toggleOp = (name: string, key: "enabled" | "requires_approval") =>
    (saveOps.mutate as any)(ops.map((o: any) => (o.name === name ? { ...o, [key]: !o[key] } : o)));
  const errors = (i.validation ?? []).filter((c: any) => !c.ok);
  return (
    <div className="card">
      <div className="row between">
        <div><div className="row"><h2 style={{ margin: 0, fontSize: 18 }}>{i.name}</h2><StatusBadge status={i.status} /></div>
          <div className="faint small">{i.description || "No description."}</div></div>
        {can("integrations:write") && (
          <div className="row">
            <button className="btn sm" onClick={() => test.mutate()} disabled={test.isPending}>{test.isPending ? "Testing…" : "Test connection"}</button>
            {i.status !== "active" ? <button className="btn sm primary" onClick={() => activate.mutate()}><CheckCircle2 /> Approve & activate</button>
              : <button className="btn sm ghost" onClick={() => disable.mutate()}><Power /> Disable</button>}
          </div>
        )}
      </div>
      <div className="grid cols-2 mt16">
        <KV items={[["Type", i.type.toUpperCase()], ["Endpoint", i.type === "http" ? i.config.base_url : (i.config.url || i.config.command)],
          ["Authentication", i.type === "http" ? i.config.auth?.type : (i.has_credential ? `${i.config.auth_header} header` : "none")],
          ["Credential", i.has_credential ? `stored · ${i.credential_fingerprint}` : "not set"]]} />
        <KV items={[["Permitted agents", i.permitted_agents.map((a: any) => a.name).join(", ") || "none"], ["Last success", i.last_success_at ? timeAgo(i.last_success_at) : "never"],
          ["Health", i.health?.checked_at ? `${i.health.ok ? "OK" : "failing"} · ${i.health.detail}` : "not tested"], ["Updated", dateTime(i.updated_at)]]} />
      </div>
      {can("integrations:write") && (
        <div className="row mt16">
          <input type="password" placeholder={i.has_credential ? "Rotate credential…" : "Paste API credential (stored encrypted, never shown again)"} value={cred} onChange={(e) => setCred(e.target.value)} autoComplete="off" />
          <button className="btn" disabled={!cred} onClick={() => { saveCred.mutate(); setCred(""); }}><KeyRound /> Save credential</button>
        </div>
      )}
      {errors.length > 0 && <div className="mt16"><Notice kind="warn">Validation: {errors.map((e: any) => `${e.check} — ${e.detail}`).join(" · ")}</Notice></div>}
      <div className="mt16"><Tabs value={tab} onChange={setTab} tabs={[{ key: "ops", label: i.type === "http" ? "Operations" : "Tools", count: ops.length || i.health?.tools?.length }, { key: "health", label: "Validation" }, { key: "audit", label: "Audit history", count: i.audit?.length }]} /></div>
      {tab === "ops" && i.type === "http" && (
        <table className="table">
          <thead><tr><th>Operation</th><th>Method</th><th>Path</th><th>Enabled</th><th>Requires approval</th></tr></thead>
          <tbody>
            {ops.map((o: any) => (
              <tr key={o.name}>
                <td><b className="small">{o.name}</b><div className="faint tiny">{o.description}</div></td>
                <td><span className={`badge ${o.method === "GET" ? "outline" : o.destructive ? "risk-high" : "risk-medium"}`}>{o.method}</span></td>
                <td className="mono tiny">{o.path}</td>
                <td><input type="checkbox" checked={o.enabled} disabled={!can("integrations:write")} onChange={() => toggleOp(o.name, "enabled")} aria-label={`enable ${o.name}`} /></td>
                <td><input type="checkbox" checked={o.requires_approval || o.destructive} disabled={!can("integrations:write") || o.destructive} onChange={() => toggleOp(o.name, "requires_approval")} aria-label={`approval ${o.name}`} />{o.destructive && <span className="faint tiny"> destructive</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === "ops" && i.type === "mcp" && (
        <div className="small">{i.health?.tools?.length ? <div className="pill-list">{i.health.tools.map((t: string) => <span key={t} className="badge outline">{t}</span>)}</div> : <span className="faint">Run “Test connection” to list the server's tools.</span>}</div>
      )}
      {tab === "health" && (
        <div className="stack" style={{ gap: 6 }}>
          {(i.validation ?? []).map((c: any) => (
            <div key={c.check} className="row small">{c.ok ? <CheckCircle2 size={15} color="var(--green)" /> : <XCircle size={15} color="var(--red)" />}<b>{c.check}</b><span className="faint">{c.detail}</span></div>
          ))}
        </div>
      )}
      {tab === "audit" && (
        <table className="table"><tbody>
          {(i.audit ?? []).map((e: any) => (
            <tr key={e.id}><td className="faint tiny nowrap">{dateTime(e.ts)}</td><td><span className="badge outline">{e.action}</span></td><td className="small">{e.actor_type}</td><td className="mono tiny">{JSON.stringify(e.details).slice(0, 160)}</td></tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}

function NewIntegration({ onClose, onCreated, initial }: { onClose: () => void; onCreated: (id: string) => void; initial?: any }) {
  const qc = useQueryClient();
  const [type, setType] = useState<"http" | "mcp">(initial?.type ?? "http");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [credential, setCredential] = useState("");
  const [cfgText, setCfgText] = useState(JSON.stringify(initial?.config ?? {
    base_url: "https://api.example.com",
    auth: { type: "bearer" },
    health_check_path: "/health",
    operations: [{ name: "get_customer", description: "Fetch a customer by id", method: "GET", path: "/customers/{id}", params_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } }],
  }, null, 2));
  const [mcp, setMcp] = useState({ transport: "http", url: "", auth_header: "Authorization", auth_scheme: "Bearer" });
  const [err, setErr] = useState<any>(null);
  const create = useMutation({
    mutationFn: async () => {
      let config: any;
      if (type === "http") {
        try { config = JSON.parse(cfgText); } catch { throw new Error("Configuration is not valid JSON"); }
      } else config = mcp;
      return api.post("/api/integrations", { name, description, type, config, credential: credential || null });
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["integrations"] }); onCreated(r.id); },
    onError: setErr,
  });
  return (
    <Modal title={initial ? "Review proposed integration" : "New integration"} onClose={onClose} wide footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!name || create.isPending} onClick={() => create.mutate()}>Save as proposed</button></>}>
      <div className="stack">
        <Notice>New integrations start in <b>proposed</b> state. An administrator must test, review and activate them before any agent can use them.</Notice>
        <div className="form-grid">
          <label className="field">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="crm" /></label>
          <label className="field">Type<select value={type} onChange={(e) => setType(e.target.value as any)} disabled={!!initial}><option value="http">HTTP API</option><option value="mcp">MCP server</option></select></label>
          <label className="field full">Description<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          {type === "http" ? (
            <label className="field full">Configuration (JSON)
              <textarea className="mono" rows={14} value={cfgText} onChange={(e) => setCfgText(e.target.value)} spellCheck={false} />
              <span className="help">base_url, auth.type (none · bearer · api_key_header · api_key_query · basic), operations[] with method, path and params_schema. Never put credentials here.</span>
            </label>
          ) : (
            <>
              <label className="field">Transport<select value={mcp.transport} onChange={(e) => setMcp({ ...mcp, transport: e.target.value })}><option value="http">Streamable HTTP</option><option value="sse">SSE</option></select></label>
              <label className="field">Server URL<input value={mcp.url} onChange={(e) => setMcp({ ...mcp, url: e.target.value })} placeholder="https://mcp.example.com/mcp" /></label>
              <label className="field">Auth header<input value={mcp.auth_header} onChange={(e) => setMcp({ ...mcp, auth_header: e.target.value })} /></label>
              <label className="field">Auth scheme<input value={mcp.auth_scheme} onChange={(e) => setMcp({ ...mcp, auth_scheme: e.target.value })} placeholder="Bearer (blank for raw value)" /></label>
            </>
          )}
          <label className="field full">Credential (optional)<input type="password" autoComplete="off" value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="Stored encrypted; never returned by the API" /></label>
        </div>
        <ErrorBox error={err} title="Could not save" />
      </div>
    </Modal>
  );
}

function ImportIntegration({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [mode, setMode] = useState<"openapi" | "describe">("openapi");
  const [spec, setSpec] = useState("");
  const [goal, setGoal] = useState("");
  const [docs, setDocs] = useState("");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const gen = useMutation({
    mutationFn: () => (mode === "openapi" ? api.post("/api/integrations/import/openapi", { spec }) : api.post("/api/integrations/import/describe", { description: goal, documentation: docs })),
    onSuccess: (r) => { setResult(r); setErr(null); },
    onError: setErr,
  });
  if (result) return <NewIntegration onClose={onClose} onCreated={onCreated} initial={result.proposal} />;
  return (
    <Modal title="Generate an integration from documentation" onClose={onClose} wide footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={gen.isPending || (mode === "openapi" ? spec.length < 10 : !goal || docs.length < 20)} onClick={() => gen.mutate()}>
        {mode === "openapi" ? <FileJson /> : <Sparkles />} {gen.isPending ? "Analyzing…" : "Generate proposal"}</button></>}>
      <div className="stack">
        <div className="seg">
          <button className={mode === "openapi" ? "on" : ""} onClick={() => setMode("openapi")}><FileJson /> OpenAPI / Swagger</button>
          <button className={mode === "describe" ? "on" : ""} onClick={() => setMode("describe")}><Sparkles /> Natural language + docs</button>
        </div>
        {mode === "openapi" ? (
          <label className="field">OpenAPI specification (JSON or YAML)<textarea className="mono" rows={14} value={spec} onChange={(e) => setSpec(e.target.value)} spellCheck={false} /></label>
        ) : (
          <>
            <label className="field">What should this integration do?<input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Let support agents look up orders and shipment status" /></label>
            <label className="field">API documentation<textarea rows={12} value={docs} onChange={(e) => setDocs(e.target.value)} placeholder="Paste the relevant API reference…" />
              <span className="help">A model drafts operations from this text. The output is schema-validated; credentials are never extracted; write operations start disabled.</span></label>
          </>
        )}
        <ErrorBox error={err} title="Could not generate a proposal" />
      </div>
    </Modal>
  );
}

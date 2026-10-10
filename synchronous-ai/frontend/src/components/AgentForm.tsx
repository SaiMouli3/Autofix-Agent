/** Agent configuration sections shared by the creation wizard and the agent settings page. */
import { useQuery } from "@tanstack/react-query";
import { Check, Lock } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { WebSearchPermission } from "./WebSearch";
import { api } from "../lib/api";
import { usd } from "../lib/format";
import { providerState } from "../lib/status";
import { AGENT_COLORS, BotMark, FACE_COUNT } from "./BotMark";
import { Alert, KV, ListInput, SearchField, Status, Tag, useConfirm } from "./ui";

export interface Identity { name: string; description: string; category: string; avatar: { icon: string; color: string }; team_id: string | null; tags: string[] }

export interface Config {
  role: string; instructions: string; objective: string; responsibilities: string[]; expected_outputs: string;
  operating_rules: string[]; constraints: string[]; escalation_conditions: string[]; completion_criteria: string;
  model: { provider_id: string; model: string; timeout_s: number; max_output_tokens: number | null; temperature: number | null; top_p: number | null; fallback_model: string | null };
  tools: string[]; integrations: string[]; knowledge_sources: string[];
  policy: {
    max_concurrent_tasks: number; task_timeout_s: number; max_retries: number; max_iterations: number; max_tool_calls: number;
    approval_mode: "never" | "risky" | "always"; network_access: boolean; budget_usd_per_task: number | null; budget_usd_monthly: number | null;
    cpu_limit: number; memory_mb: number; delegation: { allowed_agent_ids: string[]; max_depth: number; child_timeout_s: number };
  };
}

export type Errors = Record<string, string>;

export const emptyIdentity = (): Identity => ({ name: "", description: "", category: "General", avatar: { icon: "face-0", color: AGENT_COLORS[0] }, team_id: null, tags: [] });

export const defaultConfig = (providerId = "", model = ""): Config => ({
  role: "", instructions: "", objective: "", responsibilities: [], expected_outputs: "", operating_rules: [], constraints: [],
  escalation_conditions: [], completion_criteria: "",
  model: { provider_id: providerId, model, timeout_s: 180, max_output_tokens: null, temperature: null, top_p: null, fallback_model: null },
  tools: ["file_editor", "task_tracker"], integrations: [], knowledge_sources: [],
  policy: {
    max_concurrent_tasks: 2, task_timeout_s: 1800, max_retries: 1, max_iterations: 80, max_tool_calls: 150, approval_mode: "risky",
    network_access: true, budget_usd_per_task: null, budget_usd_monthly: null, cpu_limit: 1, memory_mb: 2048,
    delegation: { allowed_agent_ids: [], max_depth: 2, child_timeout_s: 900 },
  },
});

/** Client-side validation mirrors the server's schema; the server remains authoritative. */
export function validateIdentity(i: Identity): Errors {
  const e: Errors = {};
  if (i.name.trim().length < 2) e.name = "Enter at least 2 characters.";
  else if (!/^[A-Za-z0-9][A-Za-z0-9 _.\-]*$/.test(i.name.trim())) e.name = "Use letters, numbers, spaces, dashes, dots or underscores.";
  if (!i.category.trim()) e.category = "Choose a category.";
  return e;
}
export function validateInstructions(c: Config): Errors {
  const e: Errors = {};
  if (!c.role.trim() && !c.instructions.trim() && !c.objective.trim()) e.objective = "Describe at least the role, objective or instructions so the agent knows its job.";
  return e;
}
export function validateModel(c: Config): Errors {
  const e: Errors = {};
  if (!c.model.provider_id) e.provider = "Choose a model provider.";
  if (!c.model.model) e.model = "Choose a model.";
  return e;
}
export function validateTools(c: Config, integrations: any[] = []): Errors {
  const e: Errors = {};
  if (c.integrations.some((id) => integrations.find((i) => i.id === id && i.type === "http")) && !c.tools.includes("integrations"))
    e.tools = "Enable “HTTP API integrations” to let the agent call the integrations you assigned.";
  return e;
}
export function validateKnowledge(c: Config): Errors {
  return c.knowledge_sources.length > 0 && !c.tools.includes("knowledge_search") ? { knowledge: "Enable the “Company knowledge search” tool (Tools step) so the agent can use these sources." } : {};
}

const FieldErr = ({ msg, id }: { msg?: string; id?: string }) => (msg ? <span className="err" id={id} role="alert">{msg}</span> : null);
const nullableNum = (v: string) => (v === "" ? null : Number(v));

// ------------------------------------------------------------------ identity

export function IdentitySection({ value, onChange, errors = {} }: { value: Identity; onChange: (v: Identity) => void; errors?: Errors }) {
  const teams = useQuery({ queryKey: ["teams"], queryFn: ({ signal }) => api.get("/api/teams", signal) });
  const set = (patch: Partial<Identity>) => onChange({ ...value, ...patch });
  return (
    <div className="form-grid">
      <label className="field">
        <span className="req">Agent name</span>
        <input value={value.name} maxLength={80} placeholder="e.g. Market Research Analyst" onChange={(e) => set({ name: e.target.value })} aria-invalid={!!errors.name} aria-describedby="name-err" />
        <FieldErr msg={errors.name} id="name-err" />
        {!errors.name && <span className="help">Unique within your organization.</span>}
      </label>
      <label className="field">
        <span className="req">Category</span>
        <input value={value.category} maxLength={60} onChange={(e) => set({ category: e.target.value })} list="categories" aria-invalid={!!errors.category} />
        <datalist id="categories">{["Research", "Sales", "Support", "Finance", "Operations", "Engineering", "Analytics", "General"].map((c) => <option key={c} value={c} />)}</datalist>
        <FieldErr msg={errors.category} />
      </label>
      <label className="field full">Description
        <textarea value={value.description} maxLength={2000} rows={3} onChange={(e) => set({ description: e.target.value })} placeholder="What this agent is responsible for, in one or two sentences." />
      </label>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 12.5, fontWeight: 550, color: "var(--ink-2)", marginBottom: 5 }}>Mark</legend>
        <div className="row wrap" role="radiogroup" aria-label="Agent mark">
          {Array.from({ length: FACE_COUNT }).map((_, i) => {
            const on = value.avatar.icon === `face-${i}`;
            return (
              <button type="button" key={i} role="radio" aria-checked={on} aria-label={`Mark ${i + 1}`} onClick={() => set({ avatar: { ...value.avatar, icon: `face-${i}` } })}
                style={{ padding: 3, borderRadius: 8, border: on ? "1px solid var(--ink)" : "1px solid transparent", background: "none", cursor: "pointer" }}>
                <BotMark seed={value.name || "new"} avatar={{ icon: `face-${i}`, color: value.avatar.color }} size={30} />
              </button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 12.5, fontWeight: 550, color: "var(--ink-2)", marginBottom: 5 }}>Colour</legend>
        <div className="row wrap" role="radiogroup" aria-label="Agent colour">
          {AGENT_COLORS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={value.avatar.color === c} aria-label={`Colour ${c}`} onClick={() => set({ avatar: { ...value.avatar, color: c } })}
              style={{ width: 24, height: 24, borderRadius: 6, background: c, border: 0, cursor: "pointer", boxShadow: value.avatar.color === c ? "0 0 0 2px #fff, 0 0 0 4px var(--ink)" : "none" }} />
          ))}
        </div>
      </fieldset>
      <label className="field">Owning team
        <select value={value.team_id ?? ""} onChange={(e) => set({ team_id: e.target.value || null })}>
          <option value="">No team</option>
          {(teams.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="field">Tags
        <input value={value.tags.join(", ")} placeholder="comma separated" onChange={(e) => set({ tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
      </label>
    </div>
  );
}

// ------------------------------------------------------------------ instructions

export function InstructionsSection({ value, onChange, errors = {} }: { value: Config; onChange: (v: Config) => void; errors?: Errors }) {
  const set = (patch: Partial<Config>) => onChange({ ...value, ...patch });
  return (
    <div className="stack" style={{ gap: 16 }}>
      <FieldErr msg={errors.objective} />
      <div className="form-grid">
        <label className="field">Role<input value={value.role} maxLength={200} placeholder="e.g. Senior research analyst" onChange={(e) => set({ role: e.target.value })} /></label>
        <label className="field">Objective<input value={value.objective} maxLength={2000} placeholder="The outcome this agent is accountable for" onChange={(e) => set({ objective: e.target.value })} /></label>
      </div>
      <label className="field">Instructions
        <textarea rows={8} value={value.instructions} maxLength={20000} onChange={(e) => set({ instructions: e.target.value })} style={{ fontSize: 13.5 }}
          placeholder="How the agent should approach its work: process, tone, sources to prefer, what good looks like." />
        <span className="help">Added to the agent's instructions together with the platform's security policy.</span>
      </label>
      <div className="form-grid">
        <label className="field">Expected outputs<textarea rows={3} value={value.expected_outputs} onChange={(e) => set({ expected_outputs: e.target.value })} placeholder="e.g. A Markdown report saved as report.md" /></label>
        <label className="field">Completion criteria<textarea rows={3} value={value.completion_criteria} onChange={(e) => set({ completion_criteria: e.target.value })} placeholder="When is the task done?" /></label>
        <div className="field">Constraints<ListInput label="Constraint" value={value.constraints} onChange={(v) => set({ constraints: v })} placeholder="Something the agent must never do" /></div>
        <div className="field">Escalate when<ListInput label="Escalation condition" value={value.escalation_conditions} onChange={(v) => set({ escalation_conditions: v })} placeholder="Stop and ask a human when…" /></div>
        <div className="field">Responsibilities<ListInput label="Responsibility" value={value.responsibilities} onChange={(v) => set({ responsibilities: v })} placeholder="Add a responsibility" /></div>
        <div className="field">Operating rules<ListInput label="Rule" value={value.operating_rules} onChange={(v) => set({ operating_rules: v })} placeholder="Add a rule" /></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ model

export function ModelSection({ value, onChange, errors = {} }: { value: Config; onChange: (v: Config) => void; errors?: Errors }) {
  const providers = useQuery({ queryKey: ["providers"], queryFn: ({ signal }) => api.get("/api/providers", signal) });
  const pid = value.model.provider_id;
  const models = useQuery({ queryKey: ["models", pid], queryFn: ({ signal }) => api.get(`/api/providers/${pid}/models`, signal), enabled: !!pid, retry: false });
  const m = value.model;
  const setM = (patch: Partial<Config["model"]>) => onChange({ ...value, model: { ...m, ...patch } });
  const prov = (providers.data ?? []).find((p: any) => p.id === pid);
  const selected = (models.data?.models ?? []).find((x: any) => x.id === m.model);
  if (providers.data && providers.data.length === 0)
    return <Alert kind="warn" actions={<Link className="btn sm" to="/settings">Add provider</Link>}>No model provider is configured. An administrator must add and test one first.</Alert>;
  const state = prov ? providerState(prov) : null;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="form-grid">
        <label className="field">
          <span className="req">Provider</span>
          <select value={pid} aria-invalid={!!errors.provider} onChange={(e) => { const p = providers.data.find((x: any) => x.id === e.target.value); setM({ provider_id: e.target.value, model: p?.default_model ?? "", fallback_model: null }); }}>
            <option value="">Select a provider…</option>
            {(providers.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <FieldErr msg={errors.provider} />
        </label>
        <label className="field">
          <span className="req">Model</span>
          {models.data?.models?.length ? (
            <select value={m.model} aria-invalid={!!errors.model} onChange={(e) => setM({ model: e.target.value })}>
              <option value="">Select a model…</option>
              {models.data.models.map((x: any) => <option key={x.id} value={x.id}>{x.id}</option>)}
            </select>
          ) : <input value={m.model} aria-invalid={!!errors.model} onChange={(e) => setM({ model: e.target.value })} placeholder="model identifier" />}
          <FieldErr msg={errors.model} />
          {!errors.model && <span className="help">Only models that support tool calling are listed — the agent runtime requires it.</span>}
        </label>
      </div>
      {prov && (
        <div className="panel" style={{ padding: 12 }}>
          <div className="row between">
            <div className="row"><b className="small">{prov.name}</b><Status status={state!} /></div>
            {prov.last_tested_at && <span className="tiny muted">last test {new Date(prov.last_tested_at).toLocaleString()}</span>}
          </div>
          <KV items={[
            ["Endpoint", <span key="e" className="mono">{prov.base_url}</span>],
            ["Credential", prov.has_credential ? <span key="c">Stored encrypted · <span className="mono">{prov.credential_fingerprint}</span></span> : "Not configured"],
          ]} />
          {state !== "connected" && <div className="mt8"><Alert kind={state === "error" ? "error" : "warn"} actions={<Link className="btn xs" to="/settings">Open provider settings</Link>}>
            {state === "misconfigured" ? "This provider is missing a credential or default model." : state === "error" ? `The last connection test failed: ${prov.last_test_result?.error?.message ?? "see Settings"}.` : "This provider has not passed a connection test yet. Agents may fail until it does."}
          </Alert></div>}
        </div>
      )}
      {selected && (
        <KV items={[
          ["Context window", selected.context_window ? `${selected.context_window.toLocaleString()} tokens` : "not published"],
          ["Max output", selected.max_output_tokens ? `${selected.max_output_tokens.toLocaleString()} tokens` : "not published"],
          ["Published price", selected.input_usd_per_token != null ? `${usd(selected.input_usd_per_token * 1e6)} in / ${usd(selected.output_usd_per_token * 1e6)} out per 1M tokens` : "not published"],
        ]} />
      )}
      <details>
        <summary className="small strong" style={{ cursor: "pointer" }}>Advanced model settings</summary>
        <div className="form-grid mt12">
          <label className="field">Fallback model
            <select value={m.fallback_model ?? ""} onChange={(e) => setM({ fallback_model: e.target.value || null })} disabled={!models.data?.models?.length}>
              <option value="">None</option>
              {(models.data?.models ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.id}</option>)}
            </select>
            <span className="help">Used for the retry after a provider outage, rate limit or timeout.</span>
          </label>
          <label className="field">Request timeout (s)<input type="number" min={10} max={1800} value={m.timeout_s} onChange={(e) => setM({ timeout_s: Number(e.target.value) })} /></label>
          <label className="field">Max output tokens<input type="number" min={64} placeholder="Provider default" value={m.max_output_tokens ?? ""} onChange={(e) => setM({ max_output_tokens: nullableNum(e.target.value) })} /></label>
          <label className="field">Temperature<input type="number" step="0.1" min={0} max={2} placeholder="Provider default" value={m.temperature ?? ""} onChange={(e) => setM({ temperature: nullableNum(e.target.value) })} /></label>
          <label className="field">Top-p<input type="number" step="0.05" min={0.05} max={1} placeholder="Provider default" value={m.top_p ?? ""} onChange={(e) => setM({ top_p: nullableNum(e.target.value) })} /></label>
        </div>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ tools

const ACCESS: Record<string, { label: string; tone: string }> = {
  terminal: { label: "Executes commands", tone: "danger" },
  browser: { label: "Executes in browser", tone: "danger" },
  file_editor: { label: "Read & write files", tone: "warning" },
  integrations: { label: "External API calls", tone: "warning" },
  delegation: { label: "Starts other agents", tone: "warning" },
  task_tracker: { label: "Internal only", tone: "" },
  grep: { label: "Read-only", tone: "" },
  glob: { label: "Read-only", tone: "" },
  knowledge_search: { label: "Read-only", tone: "" },
  web_search: { label: "Queries sent to Tavily", tone: "warning" },
};
export const DANGEROUS_TOOLS = ["terminal", "browser"];

export function ToolsSection({ value, onChange, errors = {} }: { value: Config; onChange: (v: Config) => void; errors?: Errors }) {
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const catalog = useQuery({ queryKey: ["tool-catalog"], queryFn: ({ signal }) => api.get("/api/catalog/tools", signal) });
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: ({ signal }) => api.get("/api/integrations", signal) });
  // Web search is asked as its own explicit question below, not as a checkbox in the list.
  const tools = (catalog.data?.tools ?? []).filter((t: any) => t.key !== "web_search" && (!q || `${t.label} ${t.description} ${t.group}`.toLowerCase().includes(q.toLowerCase())));
  const groups = Array.from(new Set(tools.map((t: any) => t.group))) as string[];
  const toggle = async (t: any) => {
    const on = value.tools.includes(t.key);
    if (!on && DANGEROUS_TOOLS.includes(t.key)) {
      const ok = await confirm({ title: `Allow ${t.label.toLowerCase()}?`, confirmLabel: "Allow",
        body: <>This lets the agent <b>{t.key === "terminal" ? "run arbitrary shell commands" : "operate a web browser"}</b> in its workspace. Use the Docker sandbox runtime in production and consider an approval policy for this agent.</> });
      if (!ok) return;
    }
    onChange({ ...value, tools: on ? value.tools.filter((x) => x !== t.key) : [...value.tools, t.key] });
  };
  const toggleInt = (id: string) => onChange({ ...value, integrations: value.integrations.includes(id) ? value.integrations.filter((x) => x !== id) : [...value.integrations, id] });
  const intState = (i: any) => (i.status === "active" ? (i.health?.checked_at ? (i.health.ok ? "connected" : "error") : "untested") : i.status === "disabled" ? "disconnected" : "proposed");
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between wrap">
        <SearchField value={q} onChange={setQ} placeholder="Search tools" label="Search tools" />
        <span className="tiny muted">{value.tools.length} selected</span>
      </div>
      {errors.tools && <Alert kind="warn">{errors.tools}</Alert>}
      <WebSearchPermission enabled={value.tools.includes("web_search")}
        onChange={(on) => onChange({ ...value, tools: on ? Array.from(new Set([...value.tools, "web_search"])) : value.tools.filter((x) => x !== "web_search") })} />
      {groups.map((g) => (
        <div key={g}>
          <div className="section-title">{g}</div>
          <div className="tool-list" role="group" aria-label={g}>
            {tools.filter((t: any) => t.group === g).map((t: any) => {
              const on = value.tools.includes(t.key);
              const acc = ACCESS[t.key] ?? { label: "Tool", tone: "" };
              return (
                <div key={t.key} className="choice" role="checkbox" aria-checked={on} aria-disabled={!t.available} tabIndex={0}
                  onClick={() => t.available && toggle(t)} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && t.available && (e.preventDefault(), toggle(t))}>
                  <span style={{ width: 18, height: 18, borderRadius: 4, flex: "none", marginTop: 1, display: "grid", placeItems: "center", background: on ? "var(--ink)" : "var(--surface)", boxShadow: on ? "none" : "inset 0 0 0 1px var(--border-strong)", color: "#fff" }} aria-hidden>
                    {on ? <Check size={12} /> : !t.available ? <Lock size={11} color="var(--faint)" /> : null}
                  </span>
                  <div className="grow">
                    <div className="row between wrap"><b className="small">{t.label}</b>
                      <span className="row" style={{ gap: 4 }}>
                        <Tag tone={acc.tone}>{acc.label}</Tag>
                        <Tag tone="outline">{t.kind === "runtime" ? "Workspace tool" : "Platform, server-checked"}</Tag>
                      </span>
                    </div>
                    <div className="small muted">{t.description}</div>
                    {!t.available && <div className="tiny" style={{ color: "var(--warning)" }}>Unavailable: {t.unavailable_reason}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div>
        <div className="section-title">Integrations</div>
        {(integrations.data ?? []).length === 0 ? (
          <p className="small muted">No integrations are configured. <Link to="/integrations" style={{ color: "var(--accent)" }}>Add one</Link> to give agents governed API access.</p>
        ) : (
          <div className="tool-list">
            {(integrations.data ?? []).map((i: any) => {
              const on = value.integrations.includes(i.id);
              return (
                <label key={i.id} className="choice" style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={() => toggleInt(i.id)} style={{ marginTop: 2 }} />
                  <div className="grow">
                    <div className="row between"><b className="small">{i.name}</b><Status status={intState(i)} /></div>
                    <div className="small muted">{i.type.toUpperCase()} · {i.description || "No description"}</div>
                    {i.status !== "active" && on && <div className="tiny" style={{ color: "var(--warning)" }}>Assigned, but agents can only call it after an administrator activates it.</div>}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ knowledge

export function KnowledgeSection({ value, onChange, errors = {} }: { value: Config; onChange: (v: Config) => void; errors?: Errors }) {
  const sources = useQuery({ queryKey: ["knowledge-sources"], queryFn: ({ signal }) => api.get("/api/knowledge/sources", signal) });
  const toggle = (id: string) => onChange({ ...value, knowledge_sources: value.knowledge_sources.includes(id) ? value.knowledge_sources.filter((x) => x !== id) : [...value.knowledge_sources, id] });
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>The agent can only retrieve from the sources you select. Retrieved passages carry document references and are treated as untrusted data.</p>
      {errors.knowledge && <Alert kind="warn">{errors.knowledge}</Alert>}
      {(sources.data ?? []).length === 0 && <Alert kind="neutral" actions={<Link className="btn xs" to="/knowledge">Open Knowledge</Link>}>No knowledge sources exist yet.</Alert>}
      {(sources.data ?? []).length > 0 && (
        <div className="tool-list">
          {sources.data.map((s: any) => {
            const indexed = s.documents?.indexed ?? 0;
            const processing = (s.documents?.pending ?? 0) + (s.documents?.processing ?? 0);
            const failed = s.documents?.failed ?? 0;
            return (
              <label key={s.id} className="choice" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={value.knowledge_sources.includes(s.id)} onChange={() => toggle(s.id)} style={{ marginTop: 2 }} />
                <div className="grow">
                  <div className="row between"><b className="small">{s.name}</b><span className="tiny muted">{s.category}{s.department ? ` · ${s.department}` : ""}</span></div>
                  <div className="row small muted" style={{ gap: 12 }}>
                    <span>{indexed} indexed</span>
                    {processing > 0 && <Status status="processing" label={`${processing} processing`} />}
                    {failed > 0 && <Status status="failed" label={`${failed} failed`} />}
                    {indexed === 0 && processing === 0 && <span className="tiny" style={{ color: "var(--warning)" }}>No searchable documents yet</span>}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ permissions

export function PermissionsSection({ value, onChange, agentId }: { value: Config; onChange: (v: Config) => void; agentId?: string }) {
  const confirm = useConfirm();
  const agents = useQuery({ queryKey: ["agents", "nav"], queryFn: ({ signal }) => api.get("/api/agents?page_size=500", signal) });
  const p = value.policy;
  const setP = (patch: Partial<Config["policy"]>) => onChange({ ...value, policy: { ...p, ...patch } });
  const d = p.delegation;
  const setD = (patch: Partial<Config["policy"]["delegation"]>) => setP({ delegation: { ...d, ...patch } });
  const risky = value.tools.filter((t) => ["terminal", "browser", "file_editor", "integrations", "delegation", "web_search"].includes(t));
  const setApproval = async (mode: Config["policy"]["approval_mode"]) => {
    if (mode === "never" && value.tools.some((t) => DANGEROUS_TOOLS.includes(t))) {
      const ok = await confirm({ title: "Run without approvals?", confirmLabel: "Remove approvals", danger: true,
        body: "This agent can execute commands. With approvals off, it will run them without a human checkpoint. Integration write operations still require approval." });
      if (!ok) return;
    }
    setP({ approval_mode: mode });
  };
  const modes: { k: Config["policy"]["approval_mode"]; t: string; d: string }[] = [
    { k: "always", t: "Every action", d: "A person approves each tool action before it runs." },
    { k: "risky", t: "Risky actions", d: "Actions the runtime's security analyser marks high-risk wait for approval." },
    { k: "never", t: "No runtime approvals", d: "Only integration write operations require approval." },
  ];
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <div className="section-title">What this agent can do</div>
        {risky.length ? (
          <div className="row wrap" style={{ gap: 6 }}>
            {risky.map((t) => <Tag key={t} tone={DANGEROUS_TOOLS.includes(t) ? "danger" : "warning"}>{ACCESS[t]?.label ?? t}</Tag>)}
            <span className="tiny muted">plus read-only tools</span>
          </div>
        ) : <p className="small muted" style={{ margin: 0 }}>Read-only and internal tools only.</p>}
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="section-title">Human approval</legend>
        <div className="grid cols-3" style={{ gap: 8 }} role="radiogroup">
          {modes.map((m) => (
            <button type="button" key={m.k} className="choice" role="radio" aria-checked={p.approval_mode === m.k} onClick={() => setApproval(m.k)} style={{ flexDirection: "column", gap: 2 }}>
              <b className="small">{m.t}</b><span className="tiny muted">{m.d}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <div className="section-title">Limits</div>
        <div className="form-grid">
          <label className="field">Concurrent tasks<input type="number" min={1} max={20} value={p.max_concurrent_tasks} onChange={(e) => setP({ max_concurrent_tasks: Number(e.target.value) })} /></label>
          <label className="field">Task timeout (minutes)<input type="number" min={1} max={1440} value={Math.round(p.task_timeout_s / 60)} onChange={(e) => setP({ task_timeout_s: Math.max(60, Number(e.target.value) * 60) })} /></label>
          <label className="field">Automatic retries<input type="number" min={0} max={5} value={p.max_retries} onChange={(e) => setP({ max_retries: Number(e.target.value) })} /><span className="help">Transient provider or infrastructure failures only.</span></label>
          <label className="field">Max agent iterations<input type="number" min={3} max={500} value={p.max_iterations} onChange={(e) => setP({ max_iterations: Number(e.target.value) })} /></label>
          <label className="field">Max tool calls per task<input type="number" min={1} max={2000} value={p.max_tool_calls} onChange={(e) => setP({ max_tool_calls: Number(e.target.value) })} /></label>
          <label className="field">Budget per task (USD)<input type="number" min={0} step="0.01" placeholder="No limit" value={p.budget_usd_per_task ?? ""} onChange={(e) => setP({ budget_usd_per_task: nullableNum(e.target.value) })} /><span className="help">Enforced on estimated cost when the model publishes pricing.</span></label>
          <label className="field">Monthly budget (USD)<input type="number" min={0} step="1" placeholder="No limit" value={p.budget_usd_monthly ?? ""} onChange={(e) => setP({ budget_usd_monthly: nullableNum(e.target.value) })} /></label>
          <label className="field">Sandbox CPU / memory
            <div className="row"><input type="number" min={0.25} max={16} step={0.25} value={p.cpu_limit} aria-label="CPU cores" onChange={(e) => setP({ cpu_limit: Number(e.target.value) })} />
              <input type="number" min={256} max={65536} step={256} value={p.memory_mb} aria-label="Memory MB" onChange={(e) => setP({ memory_mb: Number(e.target.value) })} /></div>
            <span className="help">Cores · MB. Applied by the Docker runtime.</span></label>
        </div>
        <label className="check mt12"><input type="checkbox" checked={p.network_access} onChange={(e) => setP({ network_access: e.target.checked })} />
          <span>Allow assigned integrations and MCP servers <span className="muted">(outbound calls stay limited to the integration gateway's network policy)</span></span></label>
      </div>
      <div>
        <div className="section-title">Delegation</div>
        {!value.tools.includes("delegation") && <p className="small muted" style={{ margin: "0 0 8px" }}>Enable the “Agent delegation” tool to let this agent hand sub-tasks to others.</p>}
        <div className="row wrap" style={{ gap: 6, opacity: value.tools.includes("delegation") ? 1 : 0.55 }} role="group" aria-label="Agents this agent may delegate to">
          {(agents.data?.items ?? []).filter((a: any) => a.id !== agentId).map((a: any) => {
            const on = d.allowed_agent_ids.includes(a.id);
            return <button type="button" key={a.id} className="chip-btn" aria-pressed={on} disabled={!value.tools.includes("delegation")}
              onClick={() => setD({ allowed_agent_ids: on ? d.allowed_agent_ids.filter((x) => x !== a.id) : [...d.allowed_agent_ids, a.id] })}>{a.name}</button>;
          })}
        </div>
        <div className="form-grid mt12">
          <label className="field">Max delegation depth<input type="number" min={1} max={5} value={d.max_depth} onChange={(e) => setD({ max_depth: Number(e.target.value) })} /></label>
          <label className="field">Sub-task timeout (minutes)<input type="number" min={1} max={120} value={Math.round(d.child_timeout_s / 60)} onChange={(e) => setD({ child_timeout_s: Math.max(60, Number(e.target.value) * 60) })} /></label>
        </div>
        <p className="tiny muted">Delegated agents use their own tools, credentials and workspace. Nothing is inherited, and cycles are rejected.</p>
      </div>
      {p.approval_mode === "never" && value.tools.some((t) => DANGEROUS_TOOLS.includes(t)) && (
        <Alert kind="warn">This agent can execute commands without a human checkpoint.</Alert>
      )}
    </div>
  );
}

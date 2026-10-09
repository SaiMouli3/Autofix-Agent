/** Agent configuration sections shared by the creation wizard and the workspace settings tab. */
import { useQuery } from "@tanstack/react-query";
import { Check, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { usd } from "../lib/format";
import { AGENT_COLORS, AGENT_ICONS, AgentAvatar, KV, ListInput, Notice } from "./ui";

export interface Identity {
  name: string;
  description: string;
  category: string;
  avatar: { icon: string; color: string };
  team_id: string | null;
  tags: string[];
}

export interface Config {
  role: string;
  instructions: string;
  objective: string;
  responsibilities: string[];
  expected_outputs: string;
  operating_rules: string[];
  constraints: string[];
  escalation_conditions: string[];
  completion_criteria: string;
  model: { provider_id: string; model: string; timeout_s: number; max_output_tokens: number | null; temperature: number | null; top_p: number | null; fallback_model: string | null };
  tools: string[];
  integrations: string[];
  knowledge_sources: string[];
  policy: {
    max_concurrent_tasks: number; task_timeout_s: number; max_retries: number; max_iterations: number; max_tool_calls: number;
    approval_mode: "never" | "risky" | "always"; network_access: boolean; budget_usd_per_task: number | null; budget_usd_monthly: number | null;
    cpu_limit: number; memory_mb: number; delegation: { allowed_agent_ids: string[]; max_depth: number; child_timeout_s: number };
  };
}

export const emptyIdentity = (): Identity => ({ name: "", description: "", category: "General", avatar: { icon: "bot", color: "#F97316" }, team_id: null, tags: [] });

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

const nullableNum = (v: string) => (v === "" ? null : Number(v));

export function IdentitySection({ value, onChange }: { value: Identity; onChange: (v: Identity) => void }) {
  const teams = useQuery({ queryKey: ["teams"], queryFn: () => api.get("/api/teams") });
  const set = (patch: Partial<Identity>) => onChange({ ...value, ...patch });
  return (
    <div className="form-grid">
      <label className="field">Agent name<input required value={value.name} maxLength={80} placeholder="e.g. Market Research Analyst" onChange={(e) => set({ name: e.target.value })} />
        <span className="help">Unique within your organization. Letters, numbers, spaces, - _ .</span></label>
      <label className="field">Category<input value={value.category} maxLength={60} onChange={(e) => set({ category: e.target.value })} list="categories" />
        <datalist id="categories">{["Research", "Sales", "Support", "Finance", "Operations", "Engineering", "Analytics", "General"].map((c) => <option key={c} value={c} />)}</datalist></label>
      <label className="field full">Description<textarea value={value.description} maxLength={2000} onChange={(e) => set({ description: e.target.value })} placeholder="What this agent is responsible for." /></label>
      <div className="field">Icon
        <div className="pill-list">
          {Object.keys(AGENT_ICONS).map((k) => (
            <button type="button" key={k} onClick={() => set({ avatar: { ...value.avatar, icon: k } })} aria-label={`icon ${k}`}
              style={{ border: value.avatar.icon === k ? "1px solid var(--accent)" : "1px solid transparent", borderRadius: 10, background: "none", padding: 2, cursor: "pointer" }}>
              <AgentAvatar avatar={{ icon: k, color: value.avatar.color }} />
            </button>
          ))}
        </div>
      </div>
      <div className="field">Color
        <div className="pill-list">
          {AGENT_COLORS.map((c) => (
            <button type="button" key={c} aria-label={`color ${c}`} onClick={() => set({ avatar: { ...value.avatar, color: c } })}
              style={{ width: 28, height: 28, borderRadius: 8, background: c, border: value.avatar.color === c ? "2px solid #fff" : "2px solid transparent", cursor: "pointer" }} />
          ))}
        </div>
      </div>
      <label className="field">Owning team
        <select value={value.team_id ?? ""} onChange={(e) => set({ team_id: e.target.value || null })}>
          <option value="">No team</option>
          {(teams.data ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
      <label className="field">Tags<input value={value.tags.join(", ")} placeholder="comma separated" onChange={(e) => set({ tags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></label>
    </div>
  );
}

export function RoleSection({ value, onChange }: { value: Config; onChange: (v: Config) => void }) {
  const set = (patch: Partial<Config>) => onChange({ ...value, ...patch });
  return (
    <div className="form-grid">
      <label className="field">Role<input value={value.role} maxLength={200} placeholder="e.g. Senior research analyst" onChange={(e) => set({ role: e.target.value })} /></label>
      <label className="field">Primary objective<input value={value.objective} maxLength={2000} onChange={(e) => set({ objective: e.target.value })} /></label>
      <label className="field full">System instructions<textarea rows={6} value={value.instructions} maxLength={20000} onChange={(e) => set({ instructions: e.target.value })}
        placeholder="How the agent should approach its work. Appended to the OpenHands agent system prompt." /></label>
      <div className="field">Responsibilities<ListInput value={value.responsibilities} onChange={(v) => set({ responsibilities: v })} placeholder="Add a responsibility" /></div>
      <div className="field">Operating rules<ListInput value={value.operating_rules} onChange={(v) => set({ operating_rules: v })} placeholder="Add a rule" /></div>
      <div className="field">Constraints<ListInput value={value.constraints} onChange={(v) => set({ constraints: v })} placeholder="Add a constraint" /></div>
      <div className="field">Escalation conditions<ListInput value={value.escalation_conditions} onChange={(v) => set({ escalation_conditions: v })} placeholder="When should it stop and ask?" /></div>
      <label className="field">Expected outputs<textarea value={value.expected_outputs} onChange={(e) => set({ expected_outputs: e.target.value })} /></label>
      <label className="field">Completion criteria<textarea value={value.completion_criteria} onChange={(e) => set({ completion_criteria: e.target.value })} /></label>
    </div>
  );
}

export function ModelSection({ value, onChange }: { value: Config; onChange: (v: Config) => void }) {
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api.get("/api/providers") });
  const pid = value.model.provider_id;
  const models = useQuery({ queryKey: ["models", pid], queryFn: () => api.get(`/api/providers/${pid}/models`), enabled: !!pid, retry: false });
  const m = value.model;
  const setM = (patch: Partial<Config["model"]>) => onChange({ ...value, model: { ...m, ...patch } });
  const prov = (providers.data ?? []).find((p: any) => p.id === pid);
  const selected = (models.data?.models ?? []).find((x: any) => x.id === m.model);
  if (providers.data && providers.data.length === 0)
    return <Notice kind="warn">No model provider is configured. An administrator must add one in <Link to="/settings" style={{ color: "var(--accent)" }}>Settings → Model providers</Link>.</Notice>;
  return (
    <div className="stack">
      <div className="form-grid">
        <label className="field">Provider
          <select value={pid} onChange={(e) => { const p = providers.data.find((x: any) => x.id === e.target.value); setM({ provider_id: e.target.value, model: p?.default_model ?? "" }); }}>
            <option value="">Select a provider…</option>
            {(providers.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.kind_label}){p.status === "ok" ? "" : ` — ${p.status}`}</option>)}
          </select>
          {prov && <span className="help">Endpoint {prov.base_url} · credential {prov.has_credential ? `configured (${prov.credential_fingerprint})` : "missing"} · status {prov.status}</span>}
        </label>
        <label className="field">Model
          {models.data?.models?.length ? (
            <select value={m.model} onChange={(e) => setM({ model: e.target.value })}>
              <option value="">Select a model…</option>
              {models.data.models.map((x: any) => <option key={x.id} value={x.id}>{x.id}</option>)}
            </select>
          ) : (
            <input value={m.model} onChange={(e) => setM({ model: e.target.value })} placeholder="model identifier" />
          )}
          <span className="help">Only tool-calling models are listed: the OpenHands agent loop requires tool calls.</span>
        </label>
        <label className="field">Fallback model (optional)
          {models.data?.models?.length ? (
            <select value={m.fallback_model ?? ""} onChange={(e) => setM({ fallback_model: e.target.value || null })}>
              <option value="">None</option>
              {models.data.models.map((x: any) => <option key={x.id} value={x.id}>{x.id}</option>)}
            </select>
          ) : <input value={m.fallback_model ?? ""} onChange={(e) => setM({ fallback_model: e.target.value || null })} />}
          <span className="help">Used for the retry after a provider outage, rate limit or timeout.</span>
        </label>
        <label className="field">Request timeout (seconds)<input type="number" min={10} max={1800} value={m.timeout_s} onChange={(e) => setM({ timeout_s: Number(e.target.value) })} /></label>
        <label className="field">Max output tokens<input type="number" min={64} placeholder="provider default" value={m.max_output_tokens ?? ""} onChange={(e) => setM({ max_output_tokens: nullableNum(e.target.value) })} /></label>
        <label className="field">Temperature<input type="number" step="0.1" min={0} max={2} placeholder="provider default" value={m.temperature ?? ""} onChange={(e) => setM({ temperature: nullableNum(e.target.value) })} /></label>
        <label className="field">Top-p<input type="number" step="0.05" min={0.05} max={1} placeholder="provider default" value={m.top_p ?? ""} onChange={(e) => setM({ top_p: nullableNum(e.target.value) })} /></label>
      </div>
      {selected && (
        <div className="card" style={{ background: "var(--surface-0)" }}>
          <KV items={[
            ["Context window", selected.context_window ? `${selected.context_window.toLocaleString()} tokens` : "not published"],
            ["Max output", selected.max_output_tokens ? `${selected.max_output_tokens.toLocaleString()} tokens` : "not published"],
            ["Published price", selected.input_usd_per_token != null ? `${usd(selected.input_usd_per_token * 1e6)} / ${usd(selected.output_usd_per_token * 1e6)} per 1M input/output tokens` : "not published"],
          ]} />
        </div>
      )}
    </div>
  );
}

export function ToolsSection({ value, onChange }: { value: Config; onChange: (v: Config) => void }) {
  const catalog = useQuery({ queryKey: ["tool-catalog"], queryFn: () => api.get("/api/catalog/tools") });
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: () => api.get("/api/integrations") });
  const toggle = (k: string) => onChange({ ...value, tools: value.tools.includes(k) ? value.tools.filter((t) => t !== k) : [...value.tools, k] });
  const toggleInt = (id: string) => onChange({ ...value, integrations: value.integrations.includes(id) ? value.integrations.filter((x) => x !== id) : [...value.integrations, id] });
  return (
    <div className="stack">
      <div className="grid cols-2">
        {(catalog.data?.tools ?? []).map((t: any) => {
          const on = value.tools.includes(t.key);
          return (
            <div key={t.key} className={`tool-card ${on ? "on" : ""} ${t.available ? "" : "off"}`} role="checkbox" aria-checked={on} tabIndex={0}
              onClick={() => t.available && toggle(t.key)} onKeyDown={(e) => (e.key === " " || e.key === "Enter") && t.available && (e.preventDefault(), toggle(t.key))}>
              <div style={{ width: 20 }}>{on ? <Check size={18} color="var(--accent)" /> : t.available ? null : <Lock size={16} />}</div>
              <div className="grow">
                <div className="row between"><b>{t.label}</b><span className={`badge risk-${t.risk}`}>{t.risk} risk</span></div>
                <div className="muted small">{t.description}</div>
                <div className="faint tiny mt8">{t.kind === "runtime" ? "OpenHands runtime tool" : "Platform tool (server-side permission checks)"}{!t.available && ` · ${t.unavailable_reason}`}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="card" style={{ background: "var(--surface-0)" }}>
        <div className="card-title">Integrations <span className="faint small">only active integrations can be called; MCP servers attach directly</span></div>
        {(integrations.data ?? []).length === 0 && <div className="faint small">No integrations configured. <Link to="/integrations" style={{ color: "var(--accent)" }}>Add one</Link>.</div>}
        <div className="stack" style={{ gap: 6 }}>
          {(integrations.data ?? []).map((i: any) => (
            <label key={i.id} className="check">
              <input type="checkbox" checked={value.integrations.includes(i.id)} onChange={() => toggleInt(i.id)} />
              <span className="grow"><b>{i.name}</b> <span className="faint small">{i.type.toUpperCase()} · {i.description}</span></span>
              <span className={`badge ${i.status}`}>{i.status}</span>
            </label>
          ))}
        </div>
        {value.integrations.some((id) => (integrations.data ?? []).find((i: any) => i.id === id && i.type === "http")) && !value.tools.includes("integrations") && (
          <div className="mt8"><Notice kind="warn">Enable the “HTTP API integrations” tool above so the agent can call assigned HTTP integrations.</Notice></div>
        )}
      </div>
    </div>
  );
}

export function KnowledgeSection({ value, onChange }: { value: Config; onChange: (v: Config) => void }) {
  const sources = useQuery({ queryKey: ["knowledge-sources"], queryFn: () => api.get("/api/knowledge/sources") });
  const toggle = (id: string) => onChange({ ...value, knowledge_sources: value.knowledge_sources.includes(id) ? value.knowledge_sources.filter((x) => x !== id) : [...value.knowledge_sources, id] });
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>Agents can only retrieve from the sources selected here. Retrieval results include document references and are treated as untrusted data.</p>
      {(sources.data ?? []).length === 0 && <Notice>No knowledge sources yet. <Link to="/knowledge" style={{ color: "var(--accent)" }}>Create one and upload documents</Link>.</Notice>}
      {(sources.data ?? []).map((s: any) => (
        <label key={s.id} className="check card" style={{ padding: 12, background: "var(--surface-0)" }}>
          <input type="checkbox" checked={value.knowledge_sources.includes(s.id)} onChange={() => toggle(s.id)} />
          <span className="grow"><b>{s.name}</b> <span className="faint small">{s.category}{s.department ? ` · ${s.department}` : ""}</span>
            <div className="faint small">{s.document_count} documents · {s.chunk_count} indexed passages</div></span>
        </label>
      ))}
      {value.knowledge_sources.length > 0 && !value.tools.includes("knowledge_search") && (
        <Notice kind="warn">Enable the “Company knowledge search” tool in the Tools step so the agent can use these sources.</Notice>
      )}
    </div>
  );
}

export function PolicySection({ value, onChange, agentId }: { value: Config; onChange: (v: Config) => void; agentId?: string }) {
  const agents = useQuery({ queryKey: ["agents", "all"], queryFn: () => api.get("/api/agents?page_size=500") });
  const p = value.policy;
  const setP = (patch: Partial<Config["policy"]>) => onChange({ ...value, policy: { ...p, ...patch } });
  const d = p.delegation;
  const setD = (patch: Partial<Config["policy"]["delegation"]>) => setP({ delegation: { ...d, ...patch } });
  return (
    <div className="stack">
      <div className="form-grid">
        <label className="field">Approval requirement
          <select value={p.approval_mode} onChange={(e) => setP({ approval_mode: e.target.value as any })}>
            <option value="always">Always — every action needs human approval</option>
            <option value="risky">Risky actions — model-assessed high-risk actions need approval</option>
            <option value="never">Never — no runtime approvals (integration write operations still require approval)</option>
          </select></label>
        <label className="field">Max concurrent tasks<input type="number" min={1} max={20} value={p.max_concurrent_tasks} onChange={(e) => setP({ max_concurrent_tasks: Number(e.target.value) })} /></label>
        <label className="field">Task timeout (seconds)<input type="number" min={60} max={86400} value={p.task_timeout_s} onChange={(e) => setP({ task_timeout_s: Number(e.target.value) })} /></label>
        <label className="field">Automatic retries<input type="number" min={0} max={5} value={p.max_retries} onChange={(e) => setP({ max_retries: Number(e.target.value) })} />
          <span className="help">Only transient provider/infrastructure failures are retried.</span></label>
        <label className="field">Max agent iterations<input type="number" min={3} max={500} value={p.max_iterations} onChange={(e) => setP({ max_iterations: Number(e.target.value) })} /></label>
        <label className="field">Max tool calls per task<input type="number" min={1} max={2000} value={p.max_tool_calls} onChange={(e) => setP({ max_tool_calls: Number(e.target.value) })} /></label>
        <label className="field">Budget per task (USD)<input type="number" min={0} step="0.01" placeholder="unlimited" value={p.budget_usd_per_task ?? ""} onChange={(e) => setP({ budget_usd_per_task: nullableNum(e.target.value) })} />
          <span className="help">Enforced on estimated cost when the model publishes pricing.</span></label>
        <label className="field">Monthly budget (USD)<input type="number" min={0} step="1" placeholder="unlimited" value={p.budget_usd_monthly ?? ""} onChange={(e) => setP({ budget_usd_monthly: nullableNum(e.target.value) })} /></label>
        <label className="field">Sandbox CPU limit (cores)<input type="number" min={0.25} max={16} step={0.25} value={p.cpu_limit} onChange={(e) => setP({ cpu_limit: Number(e.target.value) })} />
          <span className="help">Applied by the Docker runtime.</span></label>
        <label className="field">Sandbox memory limit (MB)<input type="number" min={256} max={65536} step={256} value={p.memory_mb} onChange={(e) => setP({ memory_mb: Number(e.target.value) })} /></label>
        <label className="check full"><input type="checkbox" checked={p.network_access} onChange={(e) => setP({ network_access: e.target.checked })} />
          <span>Allow external network integrations (HTTP APIs and MCP servers). <span className="faint">Integrations are still limited to the assigned list and the outbound network policy.</span></span></label>
      </div>
      <div className="card" style={{ background: "var(--surface-0)" }}>
        <div className="card-title">Agent-to-agent delegation <span className="faint small">requires the “Agent delegation” tool</span></div>
        <div className="form-grid">
          <label className="field">Max delegation depth<input type="number" min={1} max={5} value={d.max_depth} onChange={(e) => setD({ max_depth: Number(e.target.value) })} /></label>
          <label className="field">Delegated task timeout (seconds)<input type="number" min={60} max={7200} value={d.child_timeout_s} onChange={(e) => setD({ child_timeout_s: Number(e.target.value) })} /></label>
        </div>
        <div className="field mt16">May delegate to
          <div className="pill-list">
            {(agents.data?.items ?? []).filter((a: any) => a.id !== agentId).map((a: any) => {
              const on = d.allowed_agent_ids.includes(a.id);
              return <button type="button" key={a.id} className={`badge ${on ? "accent" : "outline"}`} style={{ cursor: "pointer" }}
                onClick={() => setD({ allowed_agent_ids: on ? d.allowed_agent_ids.filter((x) => x !== a.id) : [...d.allowed_agent_ids, a.id] })}>{on ? "✓ " : ""}{a.name}</button>;
            })}
            {(agents.data?.items ?? []).length <= (agentId ? 1 : 0) && <span className="faint small">Create other agents to enable delegation.</span>}
          </div>
          <span className="help">Delegated agents use their own tools, secrets and workspace — nothing is inherited. Cycles are rejected.</span>
        </div>
      </div>
    </div>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Config,
  defaultConfig,
  emptyIdentity,
  Identity,
  IdentitySection,
  KnowledgeSection,
  ModelSection,
  PolicySection,
  RoleSection,
  ToolsSection,
} from "../components/AgentForm";
import { Shell } from "../components/Shell";
import { AGENT_ICONS, AgentAvatar, ErrorBox, KV, Notice, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

const STEPS = ["Identity", "Role & instructions", "Model", "Tools & integrations", "Company knowledge", "Execution policies", "Review & create"];

export default function CreateAgent() {
  const { can } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState<Identity>(emptyIdentity());
  const [config, setConfig] = useState<Config>(defaultConfig());
  const [template, setTemplate] = useState<string>("");
  const [err, setErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api.get("/api/catalog/templates") });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => api.get("/api/providers") });

  useEffect(() => {
    const p = (providers.data ?? []).find((x: any) => x.status === "ok") ?? providers.data?.[0];
    if (p && !config.model.provider_id) setConfig((c) => ({ ...c, model: { ...c.model, provider_id: p.id, model: p.default_model } }));
  }, [providers.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyTemplate = (t: any) => {
    setTemplate(t.key);
    setIdentity((i) => ({ ...i, name: i.name || t.name, category: t.category, description: t.description, avatar: { icon: t.icon in AGENT_ICONS ? t.icon : "bot", color: t.color } }));
    const base = defaultConfig(config.model.provider_id, config.model.model);
    setConfig({ ...base, ...t.config, model: config.model, integrations: [], knowledge_sources: [],
      policy: { ...base.policy, ...(t.config.policy ?? {}), delegation: base.policy.delegation } });
  };

  const validate = (upTo: number): string | null => {
    if (upTo >= 0 && identity.name.trim().length < 2) return "Agent name must be at least 2 characters.";
    if (upTo >= 2 && (!config.model.provider_id || !config.model.model)) return "Choose a model provider and model.";
    return null;
  };

  const next = () => {
    const v = validate(step);
    if (v) return setErr(v);
    setErr(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submit = async (status: "draft" | "active") => {
    const v = validate(6);
    if (v) return setErr(v);
    setBusy(true);
    setErr(null);
    try {
      const a = await api.post("/api/agents", { ...identity, config, status, change_note: template ? `created from ${template} template` : "initial version" });
      qc.invalidateQueries({ queryKey: ["agents"] });
      toast("ok", status === "draft" ? `Saved ${a.name} as a draft` : `${a.name} is ready`);
      nav(`/agents/${a.id}`);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  if (!can("agents:write"))
    return <Shell title="Create agent"><Notice kind="error">Your role cannot create agents.</Notice></Shell>;

  return (
    <Shell title="Create agent" crumbs={<span>My Agents / New</span>}>
      <div className="wizard">
        <div className="card" style={{ padding: 10, position: "sticky", top: 0 }}>
          <div className="steps">
            {STEPS.map((s, i) => (
              <button key={s} className={`step ${i === step ? "on" : ""} ${i < step ? "done" : ""}`} onClick={() => { if (i <= step || !validate(Math.min(i - 1, 2))) setStep(i); }}>
                <span className="n">{i + 1}</span> {s}
              </button>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="row between mb16">
            <div>
              <div className="faint small">Step {step + 1} of {STEPS.length}</div>
              <h2 style={{ margin: 0, fontSize: 18 }}>{STEPS[step]}</h2>
            </div>
            <AgentAvatar avatar={identity.avatar} size="lg" />
          </div>

          {step === 0 && (
            <div className="stack">
              <div>
                <div className="section-title">Start from a template (optional)</div>
                <div className="grid cols-4" style={{ gap: 10 }}>
                  {(templates.data ?? []).map((t: any) => (
                    <button type="button" key={t.key} className={`template ${template === t.key ? "on" : ""}`} onClick={() => applyTemplate(t)}>
                      <AgentAvatar avatar={{ icon: t.icon in AGENT_ICONS ? t.icon : "bot", color: t.color }} size="sm" />
                      <span><b className="small">{t.name}</b><div className="faint tiny">{t.description}</div></span>
                    </button>
                  ))}
                </div>
                <p className="faint tiny">Templates pre-fill instructions and suggested tools only. They never grant access to integrations or knowledge.</p>
              </div>
              <IdentitySection value={identity} onChange={setIdentity} />
            </div>
          )}
          {step === 1 && <RoleSection value={config} onChange={setConfig} />}
          {step === 2 && <ModelSection value={config} onChange={setConfig} />}
          {step === 3 && <ToolsSection value={config} onChange={setConfig} />}
          {step === 4 && <KnowledgeSection value={config} onChange={setConfig} />}
          {step === 5 && <PolicySection value={config} onChange={setConfig} />}
          {step === 6 && <Review identity={identity} config={config} />}

          <div className="mt16"><ErrorBox error={err} title="Cannot continue" /></div>
          <div className="row between mt16">
            <button className="btn ghost" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft /> Back</button>
            <div className="row">
              <button className="btn" disabled={busy} onClick={() => submit("draft")}><Save /> Save as draft</button>
              {step < STEPS.length - 1 ? (
                <button className="btn primary" onClick={next}>Continue <ArrowRight /></button>
              ) : (
                <button className="btn primary" disabled={busy} onClick={() => submit("active")}><Sparkles /> Create agent</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Review({ identity, config }: { identity: Identity; config: Config }) {
  const p = config.policy;
  return (
    <div className="stack">
      <Notice>Creating an agent does not start any work and does not authorize destructive actions. Tasks run only when assigned.</Notice>
      <div className="grid cols-2">
        <div className="card" style={{ background: "var(--surface-0)" }}>
          <div className="section-title">Identity</div>
          <KV items={[["Name", identity.name], ["Category", identity.category], ["Description", identity.description || "—"], ["Tags", identity.tags.join(", ") || "—"]]} />
        </div>
        <div className="card" style={{ background: "var(--surface-0)" }}>
          <div className="section-title">Model</div>
          <KV items={[["Model", config.model.model], ["Fallback", config.model.fallback_model ?? "none"], ["Timeout", `${config.model.timeout_s}s`],
            ["Sampling", `temperature ${config.model.temperature ?? "default"}, top-p ${config.model.top_p ?? "default"}`]]} />
        </div>
        <div className="card" style={{ background: "var(--surface-0)" }}>
          <div className="section-title">Role</div>
          <KV items={[["Role", config.role || "—"], ["Objective", config.objective || "—"], ["Responsibilities", config.responsibilities.join("; ") || "—"],
            ["Escalation", config.escalation_conditions.join("; ") || "—"]]} />
        </div>
        <div className="card" style={{ background: "var(--surface-0)" }}>
          <div className="section-title">Access & policy</div>
          <KV items={[["Tools", config.tools.join(", ") || "none"], ["Integrations", String(config.integrations.length)], ["Knowledge sources", String(config.knowledge_sources.length)],
            ["Approvals", p.approval_mode], ["Concurrency", `${p.max_concurrent_tasks} tasks`], ["Timeout / retries", `${p.task_timeout_s}s / ${p.max_retries}`],
            ["Budgets", `${p.budget_usd_per_task ?? "∞"} per task · ${p.budget_usd_monthly ?? "∞"} monthly (USD)`],
            ["Delegation", p.delegation.allowed_agent_ids.length ? `${p.delegation.allowed_agent_ids.length} agents, depth ${p.delegation.max_depth}` : "none"]]} />
        </div>
      </div>
    </div>
  );
}

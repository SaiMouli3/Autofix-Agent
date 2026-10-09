import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Config,
  defaultConfig,
  emptyIdentity,
  Errors,
  Identity,
  IdentitySection,
  InstructionsSection,
  KnowledgeSection,
  ModelSection,
  PermissionsSection,
  ToolsSection,
  validateIdentity,
  validateInstructions,
  validateKnowledge,
  validateModel,
  validateTools,
} from "../components/AgentForm";
import { AGENT_COLORS, BotMark } from "../components/BotMark";
import { Shell } from "../components/Shell";
import { Alert, InlineError, KV, Tag, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

const STEPS = ["Identity", "Instructions", "Model", "Tools", "Knowledge", "Permissions", "Review"] as const;
const SUBTITLES = [
  "Name the agent and describe its responsibility.",
  "Tell the agent how to work and what done looks like.",
  "Choose the model that will reason for this agent.",
  "Grant only the tools the work needs.",
  "Select the company knowledge it may consult.",
  "Decide where people stay in the loop, and set limits.",
  "Check everything before the agent is created.",
];

export default function CreateAgent() {
  const { can } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [identity, setIdentity] = useState<Identity>(emptyIdentity());
  const [config, setConfig] = useState<Config>(defaultConfig());
  const [template, setTemplate] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [serverErr, setServerErr] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const templates = useQuery({ queryKey: ["templates"], queryFn: ({ signal }) => api.get("/api/catalog/templates", signal) });
  const providers = useQuery({ queryKey: ["providers"], queryFn: ({ signal }) => api.get("/api/providers", signal) });
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: ({ signal }) => api.get("/api/integrations", signal) });

  useEffect(() => {
    const p = (providers.data ?? []).find((x: any) => x.status === "ok") ?? providers.data?.[0];
    if (p && !config.model.provider_id) setConfig((c) => ({ ...c, model: { ...c.model, provider_id: p.id, model: p.default_model } }));
  }, [providers.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const validators = [
    () => validateIdentity(identity), () => validateInstructions(config), () => validateModel(config),
    () => validateTools(config, integrations.data), () => validateKnowledge(config), () => ({}), () => ({}),
  ];
  const go = (target: number) => {
    if (target > step) {
      for (let i = step; i < target; i++) {
        const e = validators[i]();
        if (Object.keys(e).length) { setErrors(e); setStep(i); return; }
      }
    }
    setErrors({});
    setStep(target);
    setReached((r) => Math.max(r, target));
    document.getElementById("main")?.scrollTo({ top: 0 });
  };
  const applyTemplate = (t: any) => {
    setTemplate(t.key);
    const idx = Math.max(0, AGENT_COLORS.findIndex((c) => c.toLowerCase() === String(t.color).toLowerCase()));
    setIdentity((i) => ({ ...i, name: i.name || t.name, category: t.category, description: t.description, avatar: { icon: `face-${(t.key.length + idx) % 6}`, color: AGENT_COLORS[idx] } }));
    const base = defaultConfig(config.model.provider_id, config.model.model);
    setConfig({ ...base, ...t.config, model: config.model, integrations: [], knowledge_sources: [], policy: { ...base.policy, ...(t.config.policy ?? {}), delegation: base.policy.delegation } });
  };

  const submit = async (status: "draft" | "active") => {
    for (let i = 0; i < validators.length; i++) {
      const e = validators[i]();
      if (Object.keys(e).length) { setErrors(e); setStep(i); return; }
    }
    setBusy(true);
    setServerErr(null);
    try {
      const a = await api.post("/api/agents", { ...identity, name: identity.name.trim(), config, status, change_note: template ? `created from the ${template} template` : "initial version" });
      qc.invalidateQueries({ queryKey: ["agents"] });
      toast("ok", status === "draft" ? `${a.name} saved as a draft` : `${a.name} is ready for tasks`);
      nav(`/agents/${a.id}`);
    } catch (e) {
      setServerErr(e);
    } finally {
      setBusy(false);
    }
  };

  if (!can("agents:write"))
    return <Shell crumbs={[{ label: "Agents", to: "/agents" }, { label: "New agent" }]}><Alert kind="error">Your role cannot create agents. Ask an Agent Administrator.</Alert></Shell>;

  return (
    <Shell crumbs={[{ label: "Agents", to: "/agents" }, { label: "New agent" }]}>
      <div className="page-head">
        <div className="row" style={{ gap: 12 }}>
          <BotMark seed={identity.name || "new"} avatar={identity.avatar} size={40} />
          <div>
            <h1>{identity.name.trim() || "New agent"}</h1>
            <p style={{ margin: 0 }}>{SUBTITLES[step]}</p>
          </div>
        </div>
        <Link to="/agents" className="btn ghost">Cancel</Link>
      </div>
      <div className="wizard">
        <nav aria-label="Creation steps">
          <ol className="steps">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button className={`step ${i !== step && i < reached ? "done" : ""}`}
                  aria-current={i === step ? "step" : undefined} disabled={i > reached + 1} onClick={() => go(i)}>
                  <span className="n">{i !== step && i < reached ? <Check /> : i + 1}</span>{s}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section className="panel" aria-labelledby="step-title">
          <div className="panel-head">
            <h2 id="step-title">{step + 1}. {STEPS[step]}</h2>
            <span className="tiny muted">Step {step + 1} of {STEPS.length}</span>
          </div>
          <div className="panel-body">
            {step === 0 && (
              <div className="stack" style={{ gap: 20 }}>
                <div>
                  <div className="section-title">Start from a template <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>— optional, everything stays editable</span></div>
                  <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                    {(templates.data ?? []).map((t: any) => (
                      <button type="button" key={t.key} className="choice" aria-pressed={template === t.key} onClick={() => applyTemplate(t)}>
                        <span className="grow"><b className="small">{t.name}</b><span className="tiny muted" style={{ display: "block" }}>{t.description}</span></span>
                      </button>
                    ))}
                  </div>
                  <p className="tiny muted">Templates pre-fill instructions and suggested tools. They never grant access to integrations or knowledge.</p>
                </div>
                <IdentitySection value={identity} onChange={setIdentity} errors={errors} />
              </div>
            )}
            {step === 1 && <InstructionsSection value={config} onChange={setConfig} errors={errors} />}
            {step === 2 && <ModelSection value={config} onChange={setConfig} errors={errors} />}
            {step === 3 && <ToolsSection value={config} onChange={setConfig} errors={errors} />}
            {step === 4 && <KnowledgeSection value={config} onChange={setConfig} errors={errors} />}
            {step === 5 && <PermissionsSection value={config} onChange={setConfig} />}
            {step === 6 && <Review identity={identity} config={config} providers={providers.data ?? []} onEdit={go} />}
            {serverErr && <div className="mt16"><InlineError error={serverErr} /></div>}
          </div>
          <div className="panel-foot row between">
            <button className="btn ghost" disabled={step === 0} onClick={() => go(step - 1)}><ArrowLeft /> Back</button>
            <div className="row">
              {step === STEPS.length - 1 && <button className="btn" disabled={busy} onClick={() => submit("draft")}>Save as draft</button>}
              {step < STEPS.length - 1
                ? <button className="btn dark" onClick={() => go(step + 1)}>Continue <ArrowRight /></button>
                : <button className="btn primary" disabled={busy} onClick={() => submit("active")}>{busy ? "Creating…" : "Create agent"}</button>}
            </div>
          </div>
        </section>
      </div>
    </Shell>
  );
}

function Review({ identity, config, providers, onEdit }: { identity: Identity; config: Config; providers: any[]; onEdit: (step: number) => void }) {
  const p = config.policy;
  const prov = providers.find((x) => x.id === config.model.provider_id);
  const Section = ({ title, step, children }: { title: string; step: number; children: any }) => (
    <div style={{ borderBottom: "1px solid var(--border)", padding: "12px 0" }}>
      <div className="row between"><h3 style={{ fontSize: 13.5 }}>{title}</h3><button className="btn xs ghost" onClick={() => onEdit(step)}>Edit</button></div>
      <div className="mt8">{children}</div>
    </div>
  );
  return (
    <div>
      <Alert kind="info">Creating the agent does not start any work or authorize anything beyond what is listed here. Tasks run only when someone assigns them.</Alert>
      <Section title="Identity" step={0}><KV items={[["Name", identity.name], ["Category", identity.category], ["Description", identity.description || "—"], ["Tags", identity.tags.join(", ") || "—"]]} /></Section>
      <Section title="Instructions" step={1}><KV items={[["Role", config.role || "—"], ["Objective", config.objective || "—"], ["Instructions", config.instructions ? `${config.instructions.slice(0, 220)}${config.instructions.length > 220 ? "…" : ""}` : "—"], ["Constraints", config.constraints.join("; ") || "—"], ["Completion", config.completion_criteria || "—"]]} /></Section>
      <Section title="Model" step={2}><KV items={[["Provider", prov?.name ?? "—"], ["Model", <span key="m" className="mono">{config.model.model}</span>], ["Fallback", config.model.fallback_model ?? "None"]]} /></Section>
      <Section title="Tools & integrations" step={3}><div className="row wrap" style={{ gap: 4 }}>{config.tools.map((t) => <Tag key={t} tone={["terminal", "browser"].includes(t) ? "danger" : ""}>{t}</Tag>)}{!config.tools.length && <span className="muted small">None</span>}<span className="tiny muted">· {config.integrations.length} integration(s)</span></div></Section>
      <Section title="Knowledge" step={4}><span className="small">{config.knowledge_sources.length} source(s)</span></Section>
      <Section title="Permissions" step={5}><KV items={[["Approvals", { always: "Every action", risky: "Risky actions", never: "No runtime approvals" }[p.approval_mode]], ["Concurrency", `${p.max_concurrent_tasks} tasks`], ["Timeout", `${Math.round(p.task_timeout_s / 60)} min, ${p.max_retries} retries`], ["Budget", `${p.budget_usd_per_task ?? "no limit"} per task · ${p.budget_usd_monthly ?? "no limit"} monthly (USD)`], ["Delegation", p.delegation.allowed_agent_ids.length ? `${p.delegation.allowed_agent_ids.length} agent(s), depth ${p.delegation.max_depth}` : "None"]]} /></Section>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Config,
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
import { BotMark } from "../components/BotMark";
import { Shell } from "../components/Shell";
import { Alert, ErrorState, InlineError, Skeleton, Status, useConfirm, useToast } from "../components/ui";
import { api } from "../lib/api";
import { fullDateTime } from "../lib/format";
import { useSession } from "../lib/session";

const SECTIONS = ["Identity", "Instructions", "Model", "Tools", "Knowledge", "Permissions", "Versions"] as const;
type Section = (typeof SECTIONS)[number];

export default function AgentSettings() {
  const { agentId = "" } = useParams();
  const { can } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const agent = useQuery({ queryKey: ["agents", agentId], queryFn: ({ signal }) => api.get(`/api/agents/${agentId}`, signal) });
  const versions = useQuery({ queryKey: ["versions", agentId], queryFn: ({ signal }) => api.get(`/api/agents/${agentId}/versions`, signal) });
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: ({ signal }) => api.get("/api/integrations", signal) });
  const [section, setSection] = useState<Section>("Identity");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  useEffect(() => {
    if (agent.data && !identity) {
      const a = agent.data;
      setIdentity({ name: a.name, description: a.description, category: a.category, avatar: { icon: a.avatar?.icon ?? "", color: a.avatar?.color ?? "" }, team_id: a.team_id, tags: a.tags });
      setConfig(a.config);
    }
  }, [agent.data, identity]);
  const dirty = !!agent.data && !!identity && !!config && (JSON.stringify(config) !== JSON.stringify(agent.data.config) ||
    identity.name !== agent.data.name || identity.description !== agent.data.description || identity.category !== agent.data.category ||
    JSON.stringify(identity.avatar) !== JSON.stringify(agent.data.avatar) || identity.team_id !== agent.data.team_id || JSON.stringify(identity.tags) !== JSON.stringify(agent.data.tags));
  const save = useMutation({
    mutationFn: () => api.put(`/api/agents/${agentId}`, { identity, config, change_note: note }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["agents"] }); qc.invalidateQueries({ queryKey: ["versions", agentId] }); setNote(""); setIdentity(null); toast("ok", `Saved. New tasks use version ${r.current_version}.`); },
  });
  const onSave = () => {
    if (!identity || !config) return;
    const all = { ...validateIdentity(identity), ...validateInstructions(config), ...validateModel(config), ...validateTools(config, integrations.data), ...validateKnowledge(config) };
    setErrors(all);
    if (Object.keys(all).length) {
      const first = all.name || all.category ? "Identity" : all.objective ? "Instructions" : all.provider || all.model ? "Model" : all.tools ? "Tools" : "Knowledge";
      setSection(first as Section);
      return;
    }
    save.mutate();
  };
  if (agent.isLoading || !identity || !config) return <Shell crumbs={[{ label: "Agents", to: "/agents" }, { label: "…" }]}>{agent.isError ? <ErrorState error={agent.error} what="this agent" /> : <Skeleton h={300} />}</Shell>;
  const a = agent.data;
  const editable = can("agents:write");
  return (
    <Shell crumbs={[{ label: "Agents", to: "/agents" }, { label: a.name, to: `/agents/${a.id}` }, { label: "Configuration" }]}>
      <div className="page-head">
        <div className="row" style={{ gap: 12 }}>
          <BotMark seed={a.id} avatar={identity.avatar} size={40} state={a.status !== "active" ? a.status : undefined} />
          <div><h1>{a.name} · configuration</h1><p style={{ margin: 0 }}>Version {a.current_version} · <Status status={a.status} /> · Changes create a new version; running tasks keep theirs.</p></div>
        </div>
        <button className="btn" onClick={async () => { if (!dirty || await confirm({ title: "Discard unsaved changes?", confirmLabel: "Discard", danger: true })) nav(`/agents/${a.id}`); }}>Back to workspace</button>
      </div>
      {!editable && <div style={{ marginBottom: 16 }}><Alert kind="neutral">Read-only: your role cannot change agent configuration.</Alert></div>}
      <div className="wizard">
        <nav aria-label="Configuration sections">
          <ol className="steps">
            {SECTIONS.map((s) => <li key={s}><button className="step" aria-current={section === s ? "step" : undefined} onClick={() => setSection(s)}>{s}</button></li>)}
          </ol>
        </nav>
        <section className="panel">
          <div className="panel-head"><h2>{section}</h2>{dirty && <span className="tag warning">Unsaved changes</span>}</div>
          <div className="panel-body">
            <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              {section === "Identity" && <IdentitySection value={identity} onChange={setIdentity} errors={errors} />}
              {section === "Instructions" && <InstructionsSection value={config} onChange={setConfig} errors={errors} />}
              {section === "Model" && <ModelSection value={config} onChange={setConfig} errors={errors} />}
              {section === "Tools" && <ToolsSection value={config} onChange={setConfig} errors={errors} />}
              {section === "Knowledge" && <KnowledgeSection value={config} onChange={setConfig} errors={errors} />}
              {section === "Permissions" && <PermissionsSection value={config} onChange={setConfig} agentId={a.id} />}
            </fieldset>
            {section === "Versions" && (
              <table className="table">
                <thead><tr><th scope="col">Version</th><th scope="col">Change</th><th scope="col">Model</th><th scope="col">Tools</th><th scope="col">Created</th></tr></thead>
                <tbody>{(versions.data ?? []).map((v: any) => (
                  <tr key={v.version}>
                    <td className="nowrap">v{v.version} {v.version === a.current_version && <span className="tag accent">current</span>}</td>
                    <td className="small">{v.change_note || "—"}</td>
                    <td className="mono">{v.config.model.model}</td>
                    <td className="small">{v.config.tools.join(", ")}</td>
                    <td className="muted nowrap">{fullDateTime(v.created_at)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            {save.error && <div className="mt16"><InlineError error={save.error} /></div>}
          </div>
          {editable && section !== "Versions" && (
            <div className="panel-foot row">
              <input placeholder="Describe the change (optional, shown in version history)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} aria-label="Change note" />
              <button className="btn" disabled={!dirty} onClick={() => setIdentity(null)}>Discard</button>
              <button className="btn primary" disabled={!dirty || save.isPending} onClick={onSave}>{save.isPending ? "Saving…" : "Save new version"}</button>
            </div>
          )}
        </section>
      </div>
    </Shell>
  );
}

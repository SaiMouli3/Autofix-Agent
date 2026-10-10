import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { BrandLogo } from "./BrandLogo";
import { Alert, ErrorState, InlineError, KV, SkeletonRows, Status, useConfirm, useToast } from "./ui";

/** Logo key for each sign-in provider (a connector of that vendor). */
const LOGO: Record<string, string> = { github: "github", google: "gmail", microsoft: "microsoft_365", salesforce: "salesforce", slack: "slack" };

export function useSignInApps() {
  return useQuery({ queryKey: ["sign-in-apps"], queryFn: ({ signal }) => api.get("/api/integrations/sign-in-apps", signal) });
}

function CopyLine({ value }: { value: string }) {
  const toast = useToast();
  return (
    <span className="row" style={{ gap: 6, minWidth: 0 }}>
      <span className="mono small ellipsis" title={value}>{value}</span>
      <button type="button" className="btn xs ghost" onClick={() => navigator.clipboard.writeText(value).then(() => toast("ok", "Copied"), () => toast("error", "Copy failed; select the text instead"))}>Copy</button>
    </span>
  );
}

/** Register a provider's OAuth app once for the whole organization. The secret is sent once and
 *  stored encrypted on the server; it is never shown again. */
export function SignInAppForm({ app, onSaved }: { app: any; onSaved?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ client_id: "", client_secret: "" });
  const save = useMutation({
    mutationFn: () => api.put(`/api/integrations/sign-in-apps/${app.provider}`, v),
    onSuccess: () => {
      setV({ client_id: "", client_secret: "" });
      qc.invalidateQueries({ queryKey: ["sign-in-apps"] });
      qc.invalidateQueries({ queryKey: ["connectors"] });
      qc.invalidateQueries({ queryKey: ["integrations"] });
      toast("ok", `${app.name} sign-in is set up. Everyone in your organization can now connect with one click.`);
      onSaved?.();
    },
  });
  return (
    <div className="stack tight">
      <p className="small muted" style={{ margin: 0 }}>{app.steps}</p>
      <KV items={[
        ["Callback URL", <CopyLine key="cb" value={app.redirect_uri} />],
        ["Where", <a key="w" href={app.console_url} target="_blank" rel="noreferrer noopener" className="small" style={{ color: "var(--accent)" }}>Open {app.name} developer settings <ExternalLink size={11} style={{ verticalAlign: -1 }} /></a>],
      ]} />
      <div className="form-grid">
        <label className="field">Client ID<input value={v.client_id} onChange={(e) => setV({ ...v, client_id: e.target.value })} autoComplete="off" /></label>
        <label className="field">Client secret<input type="password" value={v.client_secret} onChange={(e) => setV({ ...v, client_secret: e.target.value })} autoComplete="off" />
          <span className="help">Stored encrypted on the server and never shown again.</span></label>
      </div>
      <InlineError error={save.error} />
      <div><button className="btn sm dark" disabled={save.isPending || !v.client_id.trim() || !v.client_secret.trim()} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : `Save ${app.name} sign-in app`}</button></div>
    </div>
  );
}

/** Settings → Sign-in apps: one OAuth app per provider, shared by every connector of that vendor. */
export function SignInAppsSection() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const apps = useSignInApps();
  const [open, setOpen] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (p: string) => api.del(`/api/integrations/sign-in-apps/${p}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sign-in-apps"] }); qc.invalidateQueries({ queryKey: ["connectors"] }); toast("ok", "Sign-in app removed"); },
    onError: (e: any) => toast("error", e.message),
  });
  if (apps.isLoading) return <SkeletonRows rows={5} />;
  if (apps.error) return <ErrorState error={apps.error} what="sign-in apps" onRetry={() => apps.refetch()} />;
  const write = can("settings:write");
  return (
    <div className="stack">
      <Alert kind="info">Register each provider's OAuth app once. After that, anyone in your organization connects GitHub, Gmail,
        Microsoft 365, Salesforce or Slack by clicking <b>Connect</b> and signing in with that provider, like the connectors in
        Claude or ChatGPT. Connections already made with their own client keep working.</Alert>
      {apps.data.map((a: any) => (
        <section className="panel" key={a.provider} aria-label={`${a.name} sign-in app`}>
          <div className="panel-head">
            <BrandLogo connectorKey={LOGO[a.provider]} name={a.name} size={28} />
            <div className="grow" style={{ minWidth: 0 }}><h2>{a.name}</h2>
              <div className="tiny muted">{a.configured ? `Client ${a.client_id_hint} · ${a.source === "deployment" ? "set by the deployment (SCA_OAUTH_CLIENTS)" : "set for this organization"}` : "Not set up: users cannot sign in with " + a.name + " yet"}</div></div>
            {a.configured ? <Status status="connected" label="Ready" /> : <Status status="disconnected" label="Not set up" />}
            {write && <button className="btn sm" onClick={() => setOpen(open === a.provider ? null : a.provider)}>{a.configured ? "Replace" : "Set up"}</button>}
            {write && a.source === "organization" && <button className="btn sm ghost" disabled={remove.isPending} onClick={async () => {
              if (await confirm({ title: `Remove the ${a.name} sign-in app?`, body: "New sign-ins with this provider stop working until an app is added again. Existing connections keep their tokens until they expire or are disconnected.", confirmLabel: "Remove", danger: true })) remove.mutate(a.provider);
            }}>Remove</button>}
          </div>
          {open === a.provider && write && <div className="panel-body"><SignInAppForm app={a} onSaved={() => setOpen(null)} /></div>}
        </section>
      ))}
      {!write && <p className="small muted">Only organization administrators can add or change sign-in apps.</p>}
    </div>
  );
}

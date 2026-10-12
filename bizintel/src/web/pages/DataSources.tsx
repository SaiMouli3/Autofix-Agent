import { useState } from "react";
import { ExternalLink, PlugZap } from "lucide-react";
import type { ProviderInfo, ProviderState } from "@/lib/types";
import { api, errorMessage } from "@/lib/api";
import { keys, useConfig, useInvalidate, useProviders } from "@/lib/queries";
import { dateTime, relativeTime } from "@/lib/format";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { BlockSkeleton, ErrorState } from "@/components/ui/States";
import { Badge, type Tone } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";

const STATE: Record<ProviderState, { tone: Tone; label: string }> = {
  connected: { tone: "success", label: "Connected" },
  not_tested: { tone: "neutral", label: "Configured · not used yet" },
  missing_credentials: { tone: "warning", label: "Missing credentials" },
  configuration_error: { tone: "danger", label: "Configuration error" },
  unavailable: { tone: "danger", label: "Temporarily unavailable" },
  rate_limited: { tone: "warning", label: "Rate limited" },
};

const ENV_HINT: Record<string, string> = {
  tavily: "TAVILY_API_KEY",
  llm: "LLM_BASE_URL, LLM_API_KEY, LLM_MODEL",
  overpass: "OVERPASS_URLS (optional)",
  nominatim: "NOMINATIM_URL (optional)",
  photon: "PHOTON_URL (optional)",
};

function ProviderCard({ p }: { p: ProviderInfo }) {
  const [testing, setTesting] = useState(false);
  const inv = useInvalidate();
  const toast = useToast();
  const s = STATE[p.state];
  return (
    <section className="panel" aria-labelledby={`p-${p.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 id={`p-${p.key}`} className="t-card-title">{p.name}</h2>
          <p className="mt-0.5 text-sm text-fg-2">{p.purpose}</p>
        </div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border px-4 py-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="t-label">Credential</dt>
          <dd className="mt-0.5 font-mono text-xs">{p.requiresKey ? (p.maskedKey ?? <span className="font-sans text-fg-3">Not set</span>) : <span className="font-sans text-fg-3">None required</span>}</dd>
        </div>
        <div>
          <dt className="t-label">Last success</dt>
          <dd className="mt-0.5" title={dateTime(p.lastSuccessAt)}>{p.lastSuccessAt ? relativeTime(p.lastSuccessAt) : "—"}</dd>
        </div>
        <div>
          <dt className="t-label">Requests (this server)</dt>
          <dd className="mt-0.5 tnum">{p.requestCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="t-label">Last error</dt>
          <dd className="mt-0.5 truncate" title={p.lastError ?? undefined}>{p.lastErrorAt ? relativeTime(p.lastErrorAt) : "—"}</dd>
        </div>
      </dl>
      {(p.detail || p.lastError) && (
        <div className="space-y-1 border-t border-border px-4 py-2.5 text-xs text-fg-2">
          {p.detail && <p>{p.detail}</p>}
          {p.lastError && <p className="break-words text-danger">Last error: {p.lastError}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-subtle/40 px-4 py-2.5">
        <span className="t-meta">{ENV_HINT[p.key] ? <>Configured with <code className="font-mono">{ENV_HINT[p.key]}</code> in the server environment.</> : "Built in."}</span>
        <div className="flex gap-2">
          {p.docsUrl && (
            <a href={p.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-control-sm items-center gap-1 rounded px-2 text-sm text-fg-2 hover:bg-subtle hover:text-fg">
              Docs <ExternalLink size={12} />
            </a>
          )}
          {p.testable && (
            <Button
              size="sm"
              icon={<PlugZap size={14} />}
              loading={testing}
              onClick={async () => {
                setTesting(true);
                try {
                  const r = await api.post<{ ok: boolean; message: string }>(`/providers/${p.key}/test`);
                  await inv(keys.providers, keys.overview);
                  if (r.ok) toast.success(`${p.name}: connection succeeded`);
                  else toast.error(`${p.name}: test failed`, r.message);
                } catch (e) {
                  toast.error("Test failed", errorMessage(e));
                } finally {
                  setTesting(false);
                }
              }}
            >
              Test connection
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

export default function DataSources() {
  const { data: cfg } = useConfig();
  useCrumbs([{ label: "Data Sources" }], cfg?.branding.productName);
  const { data, isLoading, isError, error, refetch } = useProviders();
  return (
    <PageBody>
      <PageHeader title="Data sources" subtitle="Providers this workspace uses, with their live status. Credentials are set in the server environment and never shown in full." />
      {isLoading ? <div className="panel"><BlockSkeleton lines={8} /></div> : isError ? <ErrorState error={error} onRetry={() => refetch()} /> : <div className="space-y-4">{data?.map((p) => <ProviderCard key={p.key} p={p} />)}</div>}
    </PageBody>
  );
}

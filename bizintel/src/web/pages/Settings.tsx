import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { Save } from "lucide-react";
import { DEPTH_INFO } from "@shared/domain";
import type { ResearchDepth, WorkspaceConfig } from "@/lib/types";
import { api, errorMessage } from "@/lib/api";
import { keys, useConfig, useInvalidate, useMeta } from "@/lib/queries";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { RouteTabs } from "@/components/ui/Tabs";
import { BlockSkeleton, ErrorState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { IndustryMultiSelect } from "@/components/search/IndustryMultiSelect";

const codes = (s: string) =>
  s
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-border py-6 last:border-0 md:grid-cols-[240px_minmax(0,1fr)]">
      <div>
        <h2 className="t-card-title">{title}</h2>
        {description && <p className="t-meta mt-1">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function NumberField({ label, id, value, onChange, min, max, hint }: { label: string; id: string; value: number; onChange: (n: number) => void; min: number; max: number; hint?: string }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input id={id} type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="tnum max-w-[160px]" />
    </Field>
  );
}

export default function Settings() {
  const { tab = "research" } = useParams();
  const { data: cfg, isLoading, isError, error, refetch } = useConfig();
  const { data: meta } = useMeta();
  useCrumbs([{ label: "Settings" }], cfg?.branding.productName);
  const [draft, setDraft] = useState<WorkspaceConfig | null>(null);
  const [countriesText, setCountriesText] = useState("");
  const [targetCountriesText, setTargetCountriesText] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [saving, setSaving] = useState(false);
  const inv = useInvalidate();
  const toast = useToast();

  useEffect(() => {
    if (!cfg) return;
    setDraft(cfg);
    setCountriesText(cfg.research.supportedCountries.join(", "));
    setTargetCountriesText(cfg.qualification.targetCountries.join(", "));
    setKeywordsText(cfg.qualification.needKeywords.join(", "));
  }, [cfg]);

  if (isLoading || (cfg && !draft)) return <PageBody><BlockSkeleton lines={10} /></PageBody>;
  if (isError || !draft) return <PageBody><ErrorState error={error} onRetry={() => refetch()} /></PageBody>;

  const r = draft.research;
  const q = draft.qualification;
  const b = draft.branding;
  const setR = (p: Partial<typeof r>) => setDraft({ ...draft, research: { ...r, ...p } });
  const setQ = (p: Partial<typeof q>) => setDraft({ ...draft, qualification: { ...q, ...p } });
  const setB = (p: Partial<typeof b>) => setDraft({ ...draft, branding: { ...b, ...p } });

  const save = async () => {
    setSaving(true);
    const body: WorkspaceConfig = {
      ...draft,
      research: { ...r, supportedCountries: codes(countriesText) },
      qualification: {
        ...q,
        targetCountries: codes(targetCountriesText),
        needKeywords: keywordsText
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length >= 2),
      },
    };
    try {
      await api.put("/config", body);
      await inv(keys.config, keys.overview);
      toast.success("Settings saved", tab === "qualification" ? "Use “Rescore all” on Opportunities to apply new criteria to existing scores." : undefined);
    } catch (e) {
      toast.error("Couldn’t save settings", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const totalWeight = q.criteria.filter((c) => c.enabled).reduce((s, c) => s + c.weight, 0);

  return (
    <PageBody>
      <PageHeader title="Settings" subtitle="Workspace configuration. Changes apply to new searches and research." actions={<Button variant="primary" icon={<Save size={15} />} loading={saving} onClick={save}>Save changes</Button>} />
      <div className="border-b border-border">
        <RouteTabs
          base="/settings"
          label="Settings sections"
          tabs={[
            { key: "research", label: "Research" },
            { key: "qualification", label: "Qualification" },
            { key: "branding", label: "Branding" },
          ]}
        />
      </div>

      {tab === "research" && (
        <div>
          <Section title="Search defaults" description="Pre-filled on the Discover page.">
            <Field label="Default research depth" htmlFor="s-depth">
              <Select id="s-depth" value={r.defaultDepth} onChange={(e) => setR({ defaultDepth: e.target.value as ResearchDepth })} className="max-w-[240px]">
                {(["fast", "standard", "deep"] as ResearchDepth[]).map((d) => <option key={d} value={d}>{DEPTH_INFO[d].label}</option>)}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-4">
              <NumberField label="Default radius" id="s-radius" value={r.defaultRadius} onChange={(n) => setR({ defaultRadius: n })} min={0.1} max={62} />
              <Field label="Default distance unit" htmlFor="s-unit">
                <Select id="s-unit" value={r.defaultUnit} onChange={(e) => setR({ defaultUnit: e.target.value as typeof r.defaultUnit })} className="w-[200px]">
                  <option value="auto">Automatic by country</option>
                  <option value="mi">Miles</option>
                  <option value="km">Kilometers</option>
                </Select>
              </Field>
            </div>
            <Field label="Default industries" htmlFor="s-ind">
              {meta && <IndustryMultiSelect id="s-ind" groups={meta.industries} value={r.defaultIndustries} onChange={(v) => setR({ defaultIndustries: v })} />}
            </Field>
            <Field label="Supported countries" htmlFor="s-countries" hint="ISO codes separated by commas, e.g. US, CA, GB. Leave empty to allow searches anywhere.">
              <Input id="s-countries" value={countriesText} onChange={(e) => setCountriesText(e.target.value)} placeholder="All countries" />
            </Field>
          </Section>
          <Section title="Crawling" description="How company websites are inspected.">
            <NumberField label="Maximum pages per company" id="s-pages" value={r.maxPagesPerCompany} onChange={(n) => setR({ maxPagesPerCompany: n })} min={1} max={25} hint="Deep research uses at least 10." />
            <NumberField label="Crawl concurrency" id="s-conc" value={r.crawlConcurrency} onChange={(n) => setR({ crawlConcurrency: n })} min={1} max={10} hint="Websites inspected in parallel during a search." />
          </Section>
          <Section title="Limits and cost controls" description="Caps on paid provider usage per search.">
            <NumberField label="Maximum businesses per search" id="s-max" value={r.maxBusinessesPerSearch} onChange={(n) => setR({ maxBusinessesPerSearch: n })} min={10} max={1000} />
            <NumberField label="Model calls per search" id="s-llm" value={r.maxLlmCallsPerSearch} onChange={(n) => setR({ maxLlmCallsPerSearch: n })} min={0} max={1000} hint="Companies beyond this limit get extraction-only research." />
            <NumberField label="Web-search calls per search" id="s-web" value={r.maxWebSearchCallsPerSearch} onChange={(n) => setR({ maxWebSearchCallsPerSearch: n })} min={0} max={1000} hint="Used for website lookup and third-party sources." />
          </Section>
        </div>
      )}

      {tab === "qualification" && (
        <div>
          <Section title="Your offering" description="Used to frame opportunity analysis and outreach drafts. Not shown to prospects.">
            <Field label="What does your team offer?" htmlFor="q-offer">
              <Textarea id="q-offer" value={q.offeringDescription} onChange={(e) => setQ({ offeringDescription: e.target.value })} maxLength={2000} placeholder="Describe your products or services in two or three sentences." />
            </Field>
            <Field label="Need keywords" htmlFor="q-kw" hint="Comma-separated topics that indicate relevance, matched against research evidence (e.g. “online booking, fleet maintenance”).">
              <Input id="q-kw" value={keywordsText} onChange={(e) => setKeywordsText(e.target.value)} />
            </Field>
          </Section>
          <Section title="Target profile">
            <Field label="Target industries" htmlFor="q-ind">
              {meta && <IndustryMultiSelect id="q-ind" groups={meta.industries} value={q.targetIndustries} onChange={(v) => setQ({ targetIndustries: v })} />}
            </Field>
            <fieldset>
              <legend className="t-label mb-2">Target company sizes (employees)</legend>
              <div className="flex flex-wrap gap-4">
                {meta?.sizeBands.map((s) => (
                  <Checkbox key={s} label={s} checked={q.targetSizes.includes(s)} onChange={(e) => setQ({ targetSizes: e.target.checked ? [...q.targetSizes, s] : q.targetSizes.filter((x) => x !== s) })} />
                ))}
              </div>
            </fieldset>
            <Field label="Target countries" htmlFor="q-countries" hint="ISO codes separated by commas.">
              <Input id="q-countries" value={targetCountriesText} onChange={(e) => setTargetCountriesText(e.target.value)} placeholder="Any" />
            </Field>
          </Section>
          <Section title="Scoring weights" description={`Relative weights; enabled weights total ${totalWeight}. Scores are normalized to 0–100.`}>
            <table className="w-full max-w-lg text-left">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-1.5 t-th">Criterion</th>
                  <th scope="col" className="py-1.5 t-th">Enabled</th>
                  <th scope="col" className="py-1.5 t-th">Weight</th>
                </tr>
              </thead>
              <tbody>
                {q.criteria.map((c, i) => (
                  <tr key={c.key} className="border-b border-border last:border-0">
                    <td className="py-2 text-sm">{c.label}</td>
                    <td className="py-2">
                      <Checkbox aria-label={`Enable ${c.label}`} checked={c.enabled} onChange={(e) => setQ({ criteria: q.criteria.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) })} />
                    </td>
                    <td className="py-2">
                      <Input aria-label={`${c.label} weight`} type="number" min={0} max={100} value={c.weight} disabled={!c.enabled} onChange={(e) => setQ({ criteria: q.criteria.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)) })} className="h-control-sm w-[90px] tnum" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <NumberField label="Qualified threshold" id="q-thr" value={q.qualifiedThreshold} onChange={(n) => setQ({ qualifiedThreshold: n })} min={0} max={100} hint="Businesses scoring at or above this are marked Qualified unless overridden manually." />
          </Section>
        </div>
      )}

      {tab === "branding" && (
        <div>
          <Section title="Workspace branding" description="Shown in the navigation and browser title.">
            <Field label="Product name" htmlFor="b-name"><Input id="b-name" value={b.productName} onChange={(e) => setB({ productName: e.target.value })} maxLength={60} /></Field>
            <Field label="Workspace name" htmlFor="b-ws"><Input id="b-ws" value={b.workspaceName} onChange={(e) => setB({ workspaceName: e.target.value })} maxLength={60} /></Field>
            <Field label="Logo URL" optional htmlFor="b-logo" hint="A square image (SVG or PNG) hosted over HTTPS.">
              <Input id="b-logo" type="url" value={b.logoUrl ?? ""} onChange={(e) => setB({ logoUrl: e.target.value || null })} placeholder="https://…" />
            </Field>
            <Field label="Default theme" htmlFor="b-theme" hint="Viewers can still choose their own theme from the workspace menu.">
              <Select id="b-theme" value={b.theme} onChange={(e) => setB({ theme: e.target.value as typeof b.theme })} className="max-w-[240px]">
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Field>
          </Section>
        </div>
      )}
    </PageBody>
  );
}

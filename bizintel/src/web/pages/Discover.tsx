import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown, Map as MapIcon, Navigation, SlidersHorizontal } from "lucide-react";
import { defaultUnitFor, DEPTH_INFO, toMeters } from "@shared/domain";
import { industryLabel } from "@shared/industries";
import type { DistanceUnit, LocationSuggestion, ResearchDepth, ResolvedLocation } from "@/lib/types";
import { useConfig, useCreateSearch, useMeta, useProviders } from "@/lib/queries";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader, Panel } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { InlineAlert } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { confidenceLabel, LocationAutocomplete } from "@/components/search/LocationAutocomplete";
import { RadiusSelector } from "@/components/search/RadiusSelector";
import { IndustryMultiSelect } from "@/components/search/IndustryMultiSelect";
import { DepthSelector } from "@/components/search/DepthSelector";

const MapPreview = lazy(() => import("@/components/search/MapPreview"));

interface Draft {
  location: ResolvedLocation | null;
  alternatives: LocationSuggestion[];
  radius: number;
  unit: DistanceUnit;
  unitTouched: boolean;
  industries: string[];
  depth: ResearchDepth;
  name: string;
  maxBusinesses: string;
}

const STORAGE_KEY = "discover-draft";

function loadDraft(): Partial<Draft> | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Draft>) : null;
  } catch {
    return null;
  }
}

export default function Discover() {
  const { data: cfg } = useConfig();
  const { data: meta } = useMeta();
  const { data: providers } = useProviders();
  useCrumbs([{ label: "Discover Businesses" }], cfg?.branding.productName);
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateSearch();

  const [d, setD] = useState<Draft>(() => ({
    location: null,
    alternatives: [],
    radius: 5,
    unit: "mi",
    unitTouched: false,
    industries: [],
    depth: "standard",
    name: "",
    maxBusinesses: "",
    ...loadDraft(),
  }));
  const [initialized, setInitialized] = useState(Boolean(loadDraft()));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [confirmedLowConfidence, setConfirmedLowConfidence] = useState(false);

  // Apply workspace defaults once, unless the user already has a draft in this session.
  useEffect(() => {
    if (!cfg || initialized) return;
    const r = cfg.research;
    setD((x) => ({ ...x, radius: r.defaultRadius, depth: r.defaultDepth, industries: r.defaultIndustries, unit: r.defaultUnit === "auto" ? x.unit : r.defaultUnit, unitTouched: r.defaultUnit !== "auto" }));
    setInitialized(true);
  }, [cfg, initialized]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    } catch {
      /* ignore */
    }
  }, [d]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const onLocation = (loc: ResolvedLocation | null, alternatives: LocationSuggestion[] = []) => {
    setConfirmedLowConfidence(false);
    setD((x) => ({ ...x, location: loc, alternatives, unit: loc && !x.unitTouched ? defaultUnitFor(loc.countryCode) : x.unit }));
  };

  const lowConfidence = d.location ? d.location.confidence < 0.65 : false;
  const radiusMeters = toMeters(d.radius, d.unit);
  const errors = {
    location: !d.location ? "Choose a location from the suggestions." : lowConfidence && !confirmedLowConfidence ? "Confirm this location or pick a more specific one." : null,
    radius: !(radiusMeters > 0) || radiusMeters > 100_000 ? "Radius must be between 0.1 and 62 mi (100 km)." : null,
    max: d.maxBusinesses && (!Number.isInteger(Number(d.maxBusinesses)) || Number(d.maxBusinesses) < 1) ? "Enter a whole number." : null,
  };
  const valid = !errors.location && !errors.radius && !errors.max;

  const discoveryDown = providers?.find((p) => p.key === "overpass")?.state === "unavailable";
  const llm = providers?.find((p) => p.key === "llm");
  const tavily = providers?.find((p) => p.key === "tavily");
  const maxCap = cfg?.research.maxBusinessesPerSearch ?? 150;

  const submit = () => {
    setSubmitted(true);
    if (!valid || !d.location) return;
    create.mutate(
      {
        location: d.location,
        radius: d.radius,
        unit: d.unit,
        industries: d.industries,
        depth: d.depth,
        name: d.name.trim() || undefined,
        maxBusinesses: d.maxBusinesses ? Number(d.maxBusinesses) : undefined,
      },
      {
        onSuccess: (s) => navigate(`/searches/${s.id}`),
        onError: (e) => toast.error("Couldn’t start the search", errorMessage(e)),
      },
    );
  };

  const industriesSummary = useMemo(() => (d.industries.length ? d.industries.map(industryLabel).join(", ") : "All industries"), [d.industries]);

  return (
    <PageBody wide>
      <PageHeader title="Discover businesses" subtitle="Choose an area and the kinds of businesses to find. Each search runs as a background job you can follow and cancel." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Panel title="Where" id="where" bodyClassName="space-y-4 p-4">
            <LocationAutocomplete value={d.location} onChange={onLocation} invalid={submitted && Boolean(errors.location) && !d.location} />
            <p className="t-meta -mt-2">
              Examples: <span className="text-fg-2">Austin, TX</span> · <span className="text-fg-2">SW1A 1AA</span> · <span className="text-fg-2">Rue de Rivoli, Paris</span> · <span className="text-fg-2">52.52, 13.405</span>
            </p>

            {d.location && (
              <div className="rounded-md border border-border bg-subtle/60 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="t-label">Resolved location</div>
                    <div className="mt-0.5 font-medium">{d.location.label}</div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
                      <span>Country: {d.location.country ?? "Determined when the search starts"}</span>
                      <span className="tnum">
                        Center: {d.location.lat.toFixed(4)}, {d.location.lon.toFixed(4)}
                      </span>
                      <span className="capitalize">Type: {d.location.kind}</span>
                    </div>
                  </div>
                  {(() => {
                    const c = confidenceLabel(d.location.confidence);
                    return <Badge tone={c.tone}>{c.label}</Badge>;
                  })()}
                </div>
                {lowConfidence && (
                  <div className="mt-3">
                    <InlineAlert tone="warning" title="This match is uncertain">
                      The geocoder isn’t confident this is the place you meant.
                      <label className="mt-2 flex items-center gap-2 text-fg">
                        <input type="checkbox" checked={confirmedLowConfidence} onChange={(e) => setConfirmedLowConfidence(e.target.checked)} className="accent-[rgb(var(--c-primary))]" />
                        Yes, search around this location
                      </label>
                    </InlineAlert>
                  </div>
                )}
                {d.alternatives.length > 0 && (
                  <div className="mt-3 text-xs text-fg-2">
                    Not the right place? Also matched:{" "}
                    {d.alternatives.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 && " · "}
                        <button
                          type="button"
                          className="link"
                          onClick={() => {
                            const { id: _i, ...loc } = a;
                            void _i;
                            onLocation(loc, d.alternatives.filter((x) => x.id !== a.id).concat(d.location ? [{ ...d.location, id: "prev" }] : []));
                          }}
                        >
                          {a.label}
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {submitted && errors.location && (
              <p className="text-xs text-danger" role="alert">
                {errors.location}
              </p>
            )}

            <Field label="Radius" error={submitted ? errors.radius : null} hint="Businesses within this distance of the search center. Larger radii take longer and return the closest results first.">
              <RadiusSelector radius={d.radius} unit={d.unit} onRadius={(n) => set("radius", n)} onUnit={(u) => setD((x) => ({ ...x, unit: u, unitTouched: true }))} />
            </Field>

            {d.location && (
              <div>
                <button type="button" onClick={() => setShowMap((s) => !s)} className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-fg-2 hover:text-fg" aria-expanded={showMap}>
                  <MapIcon size={13} /> {showMap ? "Hide map" : "Show map"}
                </button>
                {showMap && (
                  <div className="overflow-hidden rounded-md border border-border">
                    <Suspense fallback={<Skeleton className="h-[280px] w-full rounded-none" />}>
                      <MapPreview lat={d.location.lat} lon={d.location.lon} radiusMeters={radiusMeters} />
                    </Suspense>
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel title="What" id="what" bodyClassName="space-y-4 p-4">
            <Field label="Industries" htmlFor="industry-select" hint="Select whole categories or individual sub-categories. Leave empty to include all supported business types.">
              {meta ? <IndustryMultiSelect id="industry-select" groups={meta.industries} value={d.industries} onChange={(v) => set("industries", v)} /> : <Skeleton className="h-control w-full" />}
            </Field>
            <div>
              <button type="button" onClick={() => setShowAdvanced((s) => !s)} aria-expanded={showAdvanced} className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-2 hover:text-fg">
                <SlidersHorizontal size={14} /> Advanced options <ChevronDown size={14} className={cn("transition-transform", showAdvanced && "rotate-180")} />
              </button>
              {showAdvanced && (
                <div className="mt-3 grid gap-4 rounded-md border border-border p-3 sm:grid-cols-2">
                  <Field label="Search name" optional htmlFor="search-name" hint="Defaults to the industries and location.">
                    <Input id="search-name" value={d.name} maxLength={120} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Downtown professional services" />
                  </Field>
                  <Field label="Maximum businesses" optional htmlFor="max-biz" error={submitted ? errors.max : null} hint={`Closest first. Workspace limit: ${maxCap}.`}>
                    <Input id="max-biz" type="number" min={1} max={maxCap} value={d.maxBusinesses} onChange={(e) => set("maxBusinesses", e.target.value)} placeholder={String(maxCap)} className="tnum" />
                  </Field>
                  <p className="t-meta sm:col-span-2">
                    Company size, contact availability, research status and score filters apply to results — use them on the results table once the search has run.
                  </p>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Research depth" id="depth" description="Deeper research visits more sources per company and takes longer." bodyClassName="p-4 space-y-3">
            <DepthSelector value={d.depth} onChange={(v) => set("depth", v)} />
            {d.depth !== "fast" && (tavily?.state === "missing_credentials" || llm?.state === "missing_credentials") && (
              <InlineAlert tone="info" title="Some research features are not configured">
                {[tavily?.state === "missing_credentials" && "Web search (official website lookup, third-party sources)", llm?.state === "missing_credentials" && "Language model (structured summaries and opportunity analysis)"]
                  .filter(Boolean)
                  .join("; ")}{" "}
                will be skipped. Contacts and facts published on company websites are still extracted.
              </InlineAlert>
            )}
          </Panel>
        </div>

        <aside className="xl:sticky xl:top-[calc(var(--header-h)+24px)] xl:self-start">
          <Panel title="Search summary" bodyClassName="p-4">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="t-label">Location</dt>
                <dd className={cn("mt-0.5", !d.location && "text-fg-3")}>{d.location?.label ?? "Not selected"}</dd>
              </div>
              <div className="flex gap-6">
                <div>
                  <dt className="t-label">Radius</dt>
                  <dd className="mt-0.5 tnum">
                    {d.radius} {d.unit}
                  </dd>
                </div>
                <div>
                  <dt className="t-label">Scope</dt>
                  <dd className="mt-0.5">Radius search</dd>
                </div>
              </div>
              <div>
                <dt className="t-label">Industries</dt>
                <dd className="mt-0.5 text-fg-2">{industriesSummary}</dd>
              </div>
              <div>
                <dt className="t-label">Research depth</dt>
                <dd className="mt-0.5">{DEPTH_INFO[d.depth].label}</dd>
              </div>
              <div>
                <dt className="t-label">Result limit</dt>
                <dd className="mt-0.5 tnum">{d.maxBusinesses || maxCap} closest businesses</dd>
              </div>
            </dl>
            {discoveryDown && (
              <div className="mt-4">
                <InlineAlert tone="warning" title="Primary discovery source is unavailable">
                  Searches will fall back to a source with lower coverage.
                </InlineAlert>
              </div>
            )}
            {submitted && !valid && (
              <p className="mt-4 text-xs text-danger" role="alert">
                Fix the highlighted fields to continue.
              </p>
            )}
            <Button variant="primary" className="mt-4 w-full" icon={<Navigation size={15} />} iconRight={<ArrowRight size={15} />} loading={create.isPending} onClick={submit}>
              Find businesses
            </Button>
            <p className="t-meta mt-2 text-center">Creates a background job. You can leave this page while it runs.</p>
          </Panel>
        </aside>
      </div>
    </PageBody>
  );
}

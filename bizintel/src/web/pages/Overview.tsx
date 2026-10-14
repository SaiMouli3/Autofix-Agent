import { Link } from "react-router-dom";
import { ArrowRight, Building2, Compass, Database, Download, FileText, FlaskConical, ListChecks, Mail, Phone, Search, Target, Zap } from "lucide-react";
import { DEPTH_INFO } from "@shared/domain";
import { useConfig, useOverview, type OverviewData } from "@/lib/queries";
import { dateTime, num, relativeTime } from "@/lib/format";
import { useCrumbs } from "@/components/layout/crumbs";
import { Metric, PageBody, PageHeader, Panel } from "@/components/ui/Page";
import { ButtonLink } from "@/components/ui/Button";
import { BlockSkeleton, EmptyState, ErrorState } from "@/components/ui/States";
import { Badge, Dot, Skeleton } from "@/components/ui/primitives";
import { ResearchStatusBadge, SearchStatusBadge } from "@/components/business/badges";

const PROVIDER_TONE = { connected: "success", not_tested: "neutral", missing_credentials: "warning", configuration_error: "danger", unavailable: "danger", rate_limited: "warning" } as const;
const PROVIDER_LABEL = { connected: "Connected", not_tested: "Not used yet", missing_credentials: "Missing credentials", configuration_error: "Configuration error", unavailable: "Unavailable", rate_limited: "Rate limited" } as const;

/** Single-series horizontal bars: one hue, values in text ink, each bar carries a native tooltip. */
function DiscoveredPerSearch({ searches }: { searches: OverviewData["recentSearches"] }) {
  const done = searches.filter((s) => s.status === "completed" || s.status === "completed_with_warnings");
  if (!done.length) return <p className="px-4 py-6 text-center text-sm text-fg-3">Appears after your first completed search.</p>;
  const max = Math.max(1, ...done.map((s) => s.counters.unique));
  return (
    <figure className="px-4 py-3">
      <ul className="space-y-2" aria-label="Businesses discovered per completed search">
        {done.map((s) => (
          <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1" title={`${s.name}: ${s.counters.unique} businesses`}>
            <Link to={`/searches/${s.id}`} className="truncate text-xs text-fg-2 hover:text-fg">
              {s.name}
            </Link>
            <span className="tnum text-xs font-medium text-fg">{s.counters.unique.toLocaleString()}</span>
            <span className="col-span-2 h-2 rounded-r-[4px] bg-primary/80" style={{ width: `${Math.max(2, (s.counters.unique / max) * 100)}%` }} aria-hidden />
          </li>
        ))}
      </ul>
      <figcaption className="t-meta mt-2">Unique businesses kept per search · {done.length} most recent completed</figcaption>
    </figure>
  );
}

export default function Overview() {
  const { data: cfg } = useConfig();
  useCrumbs([{ label: "Overview" }], cfg?.branding.productName);
  const { data, isLoading, isError, error, refetch } = useOverview();

  return (
    <PageBody wide>
      <PageHeader
        title="Overview"
        subtitle="Discover businesses and turn company research into actionable intelligence."
        actions={
          <>
            <ButtonLink to="/lists" icon={<ListChecks size={15} />}>
              View saved leads
            </ButtonLink>
            <ButtonLink to="/discover" variant="primary" icon={<Compass size={15} />}>
              Discover businesses
            </ButtonLink>
          </>
        }
      />

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-5">
          <section aria-label="Key metrics" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3 xl:grid-cols-6 [&>*]:bg-surface">
            {isLoading || !data ? (
              Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="space-y-2 px-4 py-3">
                  <Skeleton className="w-24" />
                  <Skeleton className="h-6 w-14" />
                </div>
              ))
            ) : (
              <>
                <Metric label="Businesses discovered" value={num(data.stats.businesses)} icon={<Building2 size={13} />} />
                <Metric label="Researched" value={num(data.stats.researched)} icon={<FlaskConical size={13} />} />
                <Metric label="With public email" value={num(data.stats.withEmail)} icon={<Mail size={13} />} />
                <Metric label="With public phone" value={num(data.stats.withPhone)} icon={<Phone size={13} />} />
                <Metric label="Qualified leads" value={num(data.stats.qualified)} icon={<Target size={13} />} />
                <Metric label="Active jobs" value={num(data.stats.activeJobs)} icon={<Zap size={13} />} hint={data.stats.activeJobs ? "Updating live" : undefined} />
              </>
            )}
          </section>

          {isLoading || !data ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="panel"><BlockSkeleton lines={6} /></div>
              <div className="panel"><BlockSkeleton lines={6} /></div>
            </div>
          ) : (
            <>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                <div className="space-y-5">
                  <Panel title="Recent searches" id="recent-searches" actions={<Link to="/searches" className="text-xs font-medium text-fg-2 hover:text-fg">View all</Link>}>
                    {data.recentSearches.length === 0 ? (
                      <EmptyState compact icon={<Search size={18} />} title="No searches yet" description="Pick a location, radius and industries to discover businesses." action={<ButtonLink to="/discover" variant="primary" size="sm">Start a search</ButtonLink>} />
                    ) : (
                      <ul className="divide-y divide-border">
                        {data.recentSearches.map((s) => (
                          <li key={s.id}>
                            <Link to={`/searches/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle/60">
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{s.name}</div>
                                <div className="t-meta truncate">
                                  {DEPTH_INFO[s.depth].label} · <span className="tnum">{s.counters.unique.toLocaleString()}</span> businesses · {relativeTime(s.createdAt)}
                                </div>
                              </div>
                              <SearchStatusBadge status={s.status} />
                              <ArrowRight size={14} className="text-fg-3" aria-hidden />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                  <Panel title="Businesses discovered per search" id="per-search">
                    <DiscoveredPerSearch searches={data.recentSearches} />
                  </Panel>
                </div>

                <div className="space-y-5">
                  <Panel title="Research jobs in progress" id="jobs" actions={<Link to="/research" className="text-xs font-medium text-fg-2 hover:text-fg">Research workspace</Link>}>
                    {data.activeResearch.length === 0 ? (
                      <p className="px-4 py-5 text-sm text-fg-3">No research is running. Select businesses in any table and choose “Research” to start.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {data.activeResearch.map((j) => (
                          <li key={j.id} className="flex items-center gap-3 px-4 py-2.5">
                            <Dot tone="info" pulse={j.status === "running"} />
                            <Link to={`/businesses/${j.businessId}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                              {j.businessName}
                            </Link>
                            <span className="t-meta shrink-0">{j.status === "queued" ? "Queued" : (j.stage ?? "Running")}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                  <Panel title="Recently researched" id="recently-researched">
                    {data.recentlyResearched.length === 0 ? (
                      <p className="px-4 py-5 text-sm text-fg-3">Completed research appears here.</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {data.recentlyResearched.map((b) => (
                          <li key={b.id} className="flex items-center gap-3 px-4 py-2.5">
                            <Link to={`/businesses/${b.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                              {b.name}
                            </Link>
                            <ResearchStatusBadge status={b.researchStatus} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <Panel title="Saved lists" id="lists" actions={<Link to="/lists" className="text-xs font-medium text-fg-2 hover:text-fg">All</Link>}>
                      {data.lists.length === 0 ? (
                        <p className="px-4 py-5 text-sm text-fg-3">Organize businesses into lists from any results table.</p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {data.lists.map((l) => (
                            <li key={l.id}>
                              <Link to={`/lists/${l.id}`} className="flex items-center justify-between gap-2 px-4 py-2 text-sm hover:bg-subtle/60">
                                <span className="truncate">{l.name}</span>
                                <span className="tnum text-fg-3">{l.count}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Panel>
                    <Panel title="Data sources" id="sources" actions={<Link to="/data-sources" className="text-xs font-medium text-fg-2 hover:text-fg">Manage</Link>}>
                      <ul className="divide-y divide-border">
                        {data.providers
                          .filter((p) => p.key !== "website_crawler")
                          .map((p) => (
                            <li key={p.key} className="flex items-center justify-between gap-2 px-4 py-2">
                              <span className="truncate text-sm">{p.name}</span>
                              <Badge tone={PROVIDER_TONE[p.state]}>{PROVIDER_LABEL[p.state]}</Badge>
                            </li>
                          ))}
                      </ul>
                    </Panel>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-3">
                <Panel title="Recent business discoveries" id="recent-biz" actions={<Link to="/businesses" className="text-xs font-medium text-fg-2 hover:text-fg">All businesses</Link>}>
                  {data.recentBusinesses.length === 0 ? (
                    <EmptyState compact icon={<Building2 size={18} />} title="Nothing discovered yet" />
                  ) : (
                    <ul className="divide-y divide-border">
                      {data.recentBusinesses.map((b) => (
                        <li key={b.id}>
                          <Link to={`/businesses/${b.id}`} className="block px-4 py-2 hover:bg-subtle/60">
                            <span className="block truncate text-sm font-medium">{b.name}</span>
                            <span className="t-meta block truncate">{[b.category, b.city].filter(Boolean).join(" · ") || "—"}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <Panel title="Recent research reports" id="recent-reports">
                  {data.recentReports.length === 0 ? (
                    <EmptyState compact icon={<FileText size={18} />} title="No reports yet" description="Standard and Deep research produce a company intelligence report." />
                  ) : (
                    <ul className="divide-y divide-border">
                      {data.recentReports.map((r) => (
                        <li key={r.businessId}>
                          <Link to={`/businesses/${r.businessId}/intelligence`} className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-subtle/60">
                            <span className="truncate text-sm font-medium">{r.businessName}</span>
                            <span className="t-meta shrink-0" title={dateTime(r.generatedAt)}>{relativeTime(r.generatedAt)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                <Panel title="Export history" id="recent-exports" actions={<Link to="/exports" className="text-xs font-medium text-fg-2 hover:text-fg">Export Center</Link>}>
                  {data.exports.length === 0 ? (
                    <EmptyState compact icon={<Download size={18} />} title="No exports yet" description="Export any table, list or search to CSV or Excel." />
                  ) : (
                    <ul className="divide-y divide-border">
                      {data.exports.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{e.name}</span>
                            <span className="t-meta">
                              {e.format.toUpperCase()} · {e.recordCount != null ? `${e.recordCount.toLocaleString()} records` : e.status}
                            </span>
                          </span>
                          <span className="t-meta shrink-0">{relativeTime(e.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
              {data.stats.businesses === 0 && (
                <div className="panel flex flex-wrap items-center gap-4 px-5 py-4">
                  <Database size={18} className="text-fg-3" aria-hidden />
                  <p className="min-w-0 flex-1 text-sm text-fg-2">
                    Your workspace is empty. Every number on this page comes from searches and research you run — nothing is pre-filled.
                  </p>
                  <ButtonLink to="/discover" variant="primary" size="sm">
                    Run your first search
                  </ButtonLink>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </PageBody>
  );
}

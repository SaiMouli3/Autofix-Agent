import { useEffect, useState } from "react";
import { AlertTriangle, Ban, Check, ExternalLink, FileText, Globe, MinusCircle, RefreshCw, XCircle } from "lucide-react";
import { domainOf } from "@shared/domain";
import type { Business, PageCategory, WebsitePage } from "@/lib/types";
import { useEvidence, usePages, usePageText } from "@/lib/queries";
import { cn, dateTime } from "@/lib/format";
import { Button } from "../ui/Button";
import { DefinitionList } from "../ui/Page";
import { BlockSkeleton, EmptyState, ErrorState } from "../ui/States";
import { Badge } from "../ui/primitives";
import { EvidenceList } from "./shared";
import type { TabProps } from "@/pages/Company";

const CAT_LABEL: Record<PageCategory, string> = {
  home: "Home",
  about: "About",
  contact: "Contact",
  services: "Services",
  products: "Products",
  team: "Team",
  locations: "Locations",
  careers: "Careers",
  case_studies: "Case studies",
  news: "News",
  other: "Other",
};

function StatusIcon({ p }: { p: WebsitePage }) {
  if (p.status === "retrieved") return <Check size={13} className="text-success" aria-label="Retrieved" />;
  if (p.status === "blocked") return <Ban size={13} className="text-warning" aria-label="Blocked" />;
  if (p.status === "failed") return <XCircle size={13} className="text-danger" aria-label="Failed" />;
  return <MinusCircle size={13} className="text-fg-3" aria-label="Skipped" />;
}

const STATUS_LABEL = { retrieved: "Retrieved", failed: "Failed", blocked: "Blocked", skipped: "Skipped", pending: "Pending" } as const;

export function WebsiteTab({ id, poll, business: b, onEnrich, enriching }: TabProps & { business: Business; onEnrich: () => void; enriching: boolean }) {
  const { data: pages, isLoading, isError, error, refetch } = usePages(id, poll);
  const { data: evidence = [] } = useEvidence(id, poll);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!selected && pages?.length) setSelected(pages[0].id);
  }, [pages, selected]);
  const page = pages?.find((p) => p.id === selected) ?? null;
  const { data: detail, isLoading: textLoading } = usePageText(page?.status === "retrieved" ? page.id : null);

  if (isLoading) return <div className="panel"><BlockSkeleton lines={8} /></div>;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!b.website)
    return (
      <div className="panel">
        <EmptyState icon={<Globe size={18} />} title="No official website identified" description="The map listing has no website and web search did not find a confident match. Research with web search configured, or check the business manually." />
      </div>
    );
  if (!pages?.length)
    return (
      <div className="panel">
        <EmptyState
          icon={<Globe size={18} />}
          title="Website not inspected yet"
          description={`Inspect ${domainOf(b.website)} to discover its key pages and extract published contact details.`}
          action={<Button variant="primary" size="sm" icon={<RefreshCw size={14} />} loading={enriching} onClick={onEnrich}>Inspect website</Button>}
        />
      </div>
    );

  const retrieved = pages.filter((p) => p.status === "retrieved").length;
  const pageEvidence = page ? evidence.filter((e) => e.sourceUrl === page.url) : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)_280px]">
      {/* Left: inventory */}
      <aside className="panel self-start" aria-label="Discovered pages">
        <div className="panel-header">
          <div className="min-w-0">
            <h2 className="t-card-title truncate">{domainOf(b.website)}</h2>
            <p className="t-meta tnum">
              {retrieved} of {pages.length} pages retrieved
            </p>
          </div>
          <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={enriching} onClick={onEnrich} title="Re-crawl the website, including failed pages">
            Retry
          </Button>
        </div>
        <ul className="p-1.5">
          {pages.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => setSelected(p.id)}
                aria-current={p.id === selected ? "true" : undefined}
                className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left", p.id === selected ? "bg-primary-subtle text-fg" : "hover:bg-subtle")}
              >
                <StatusIcon p={p} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{CAT_LABEL[p.category]}</span>
                  <span className="block truncate text-2xs text-fg-3">{new URL(p.url).pathname}</span>
                </span>
                {p.warnings.length > 0 && <AlertTriangle size={12} className="text-warning" aria-label="Has warnings" />}
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-border px-3 py-2 t-meta">Only pages linked from the home page in key categories are retrieved, within your per-company page limit.</p>
      </aside>

      {/* Main: extraction */}
      <section className="panel min-w-0" aria-label="Page details">
        {page && (
          <>
            <div className="panel-header">
              <div className="min-w-0">
                <h2 className="t-card-title truncate">{page.title ?? CAT_LABEL[page.category]}</h2>
                <a href={page.url} target="_blank" rel="noopener noreferrer" className="t-meta inline-flex max-w-full items-center gap-1 hover:text-primary">
                  <span className="truncate">{page.url}</span> <ExternalLink size={10} className="shrink-0" />
                  <span className="sr-only">(opens in new tab)</span>
                </a>
              </div>
              <Badge tone={page.status === "retrieved" ? "success" : page.status === "blocked" ? "warning" : page.status === "failed" ? "danger" : "neutral"}>{STATUS_LABEL[page.status]}</Badge>
            </div>
            <div className="space-y-5 p-4">
              {page.warnings.length > 0 && (
                <ul className="space-y-1">
                  {page.warnings.map((w) => (
                    <li key={w} className="flex items-start gap-2 rounded bg-warning-subtle/70 px-2.5 py-1.5 text-sm text-fg-2">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" /> {w}
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <h3 className="t-label mb-1.5">Extracted fields</h3>
                {page.extractedFields.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {page.extractedFields.map((f) => (
                      <Badge key={f} tone="info">{f}</Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-fg-3">No structured fields found on this page.</p>
                )}
              </div>
              <div>
                <h3 className="t-label mb-1">Key evidence from this page</h3>
                <EvidenceList items={pageEvidence} empty={<p className="text-sm text-fg-3">No research claims cite this page.</p>} />
              </div>
              {page.status === "retrieved" && (
                <div>
                  <h3 className="t-label mb-1.5 flex items-center gap-1.5">
                    <FileText size={13} /> Retrieved text
                  </h3>
                  {textLoading ? (
                    <BlockSkeleton lines={5} />
                  ) : detail?.text ? (
                    <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded border border-border bg-subtle/60 p-3 font-sans text-sm leading-relaxed text-fg-2">{detail.text}</pre>
                  ) : (
                    <p className="text-sm text-fg-3">No readable text was stored for this page.</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* Right: metadata */}
      {page && (
        <aside className="panel self-start lg:col-span-2 2xl:col-span-1" aria-label="Source metadata">
          <div className="panel-header">
            <h2 className="t-card-title">Source metadata</h2>
          </div>
          <div className="p-4">
            <DefinitionList
              items={[
                { label: "Category", value: CAT_LABEL[page.category] },
                { label: "HTTP status", value: <span className="tnum">{page.httpStatus ?? "—"}</span> },
                { label: "Retrieved", value: dateTime(page.retrievedAt) },
                { label: "Text length", value: <span className="tnum">{page.textLength.toLocaleString()} chars</span> },
                { label: "Claims citing", value: <span className="tnum">{pageEvidence.length}</span> },
                { label: "Source type", value: "Official website" },
              ]}
            />
          </div>
        </aside>
      )}
    </div>
  );
}

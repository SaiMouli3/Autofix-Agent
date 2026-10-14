import { ExternalLink, Library } from "lucide-react";
import { domainOf } from "@shared/domain";
import type { Business, Evidence } from "@/lib/types";
import { useEvidence, usePages } from "@/lib/queries";
import { dateTime } from "@/lib/format";
import { BlockSkeleton, EmptyState } from "../ui/States";
import { Badge } from "../ui/primitives";
import { EvidenceList } from "./shared";
import type { TabProps } from "@/pages/Company";

const TYPE_LABEL: Record<Evidence["sourceType"], string> = { official_website: "Official website", third_party: "Third-party", map_provider: "Map provider", model_inference: "Model inference" };

export function SourcesTab({ id, poll, business: b }: TabProps & { business: Business }) {
  const { data: evidence, isLoading } = useEvidence(id, poll);
  const { data: pages = [] } = usePages(id, poll);
  if (isLoading) return <div className="panel"><BlockSkeleton lines={6} /></div>;
  const groups = new Map<string, Evidence[]>();
  for (const e of evidence ?? []) {
    if (!e.sourceUrl) continue;
    groups.set(e.sourceUrl, [...(groups.get(e.sourceUrl) ?? []), e]);
  }
  const unsourced = (evidence ?? []).filter((e) => !e.sourceUrl);

  return (
    <div className="space-y-5">
      <section className="panel" aria-labelledby="listing-src">
        <div className="panel-header">
          <h2 id="listing-src" className="t-card-title">Listing source</h2>
          <Badge>Map provider</Badge>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
          <span>Business name, location, category{b.websiteSource?.startsWith("Map") ? ", website" : ""}{b.phoneSource?.startsWith("Map") ? ", phone" : ""} from OpenStreetMap ({b.sourceRef})</span>
          <a className="link inline-flex items-center gap-1" href={`https://www.openstreetmap.org/${b.sourceRef}`} target="_blank" rel="noopener noreferrer">
            View on OpenStreetMap <ExternalLink size={11} />
          </a>
        </div>
      </section>

      {groups.size === 0 && unsourced.length === 0 ? (
        <div className="panel">
          <EmptyState icon={<Library size={18} />} title="No research sources yet" description="Sources appear here once research has retrieved pages and recorded claims from them." />
        </div>
      ) : (
        [...groups.entries()].map(([url, items]) => {
          const page = pages.find((p) => p.url === url);
          const first = items[0];
          return (
            <section key={url} className="panel" aria-label={`Source ${domainOf(url)}`}>
              <div className="panel-header">
                <div className="min-w-0">
                  <h2 className="t-card-title truncate">{first.sourceTitle ?? domainOf(url)}</h2>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="t-meta inline-flex max-w-full items-center gap-1 hover:text-primary">
                    <span className="truncate">{url}</span> <ExternalLink size={10} className="shrink-0" />
                    <span className="sr-only">(opens in new tab)</span>
                  </a>
                  <p className="t-meta mt-0.5">
                    {first.publishedAt && <>Published {dateTime(first.publishedAt)} · </>}Retrieved {dateTime(page?.retrievedAt ?? first.retrievedAt)}
                  </p>
                </div>
                <Badge tone={first.sourceType === "official_website" ? "success" : "info"}>{TYPE_LABEL[first.sourceType]}</Badge>
              </div>
              <div className="px-4">
                <EvidenceList items={items} />
              </div>
            </section>
          );
        })
      )}

      {unsourced.length > 0 && (
        <section className="panel" aria-labelledby="unsourced">
          <div className="panel-header">
            <h2 id="unsourced" className="t-card-title">Statements without a supporting source ({unsourced.length})</h2>
            <Badge tone="warning">Hypotheses</Badge>
          </div>
          <div className="px-4">
            <EvidenceList items={unsourced} />
          </div>
        </section>
      )}
    </div>
  );
}

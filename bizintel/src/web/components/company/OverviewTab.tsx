import { Link } from "react-router-dom";
import { ExternalLink, Mail, Phone } from "lucide-react";
import { domainOf } from "@shared/domain";
import { industryGroupOf, industryLabel } from "@shared/industries";
import type { Business, ReportSectionKey } from "@/lib/types";
import { useContacts, useEvidence, useReport } from "@/lib/queries";
import { DefinitionList, Panel } from "../ui/Page";
import { BlockSkeleton } from "../ui/States";
import { Button } from "../ui/Button";
import { EvidenceBadge } from "../business/badges";
import { CopyButton } from "../business/CopyButton";
import { SourceReference } from "../business/SourceReference";
import { EvidenceList, NotResearched, Prose } from "./shared";
import { NotesPanel } from "./ActivityTab";
import type { TabProps } from "@/pages/Company";

export function OverviewTab({ id, poll, onResearch, business: b }: TabProps & { business: Business }) {
  const { data: rep, isLoading } = useReport(id, poll);
  const { data: evidence = [] } = useEvidence(id, poll);
  const { data: contacts = [] } = useContacts(id, poll);
  const report = rep?.report;
  const section = (k: ReportSectionKey) => report?.sections.find((s) => s.key === k)?.body ?? null;
  const ev = (k: ReportSectionKey) => evidence.filter((e) => e.section === k && e.classification !== "hypothesis");
  const description = section("executive_summary") ?? section("overview");
  const emails = contacts.filter((c) => c.email);
  const phones = contacts.filter((c) => c.phone);
  const group = industryGroupOf(b.industry);
  const fact = (k: ReportSectionKey, label: string) => {
    const body = section(k);
    const items = ev(k);
    return {
      label,
      value: body ? (
        <span>{body}</span>
      ) : items.length ? (
        <ul className="space-y-1">
          {items.slice(0, 3).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-1.5">
              {e.claim} <SourceReference url={e.sourceUrl} title={e.sourceTitle} retrievedAt={e.retrievedAt} />
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-fg-3">Not found in sources</span>
      ),
    };
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Panel title="Company overview" id="ov" description={report ? `From ${report.depth} research · confidence ${report.confidence}` : undefined}>
          <div className="space-y-5 p-4">
            {isLoading ? (
              <BlockSkeleton lines={3} />
            ) : description ? (
              <Prose text={description} />
            ) : ev("overview").length ? (
              <EvidenceList items={ev("overview")} />
            ) : (
              <NotResearched action={<Button size="sm" variant="primary" onClick={onResearch}>Start research</Button>} />
            )}
            {report && (
              <DefinitionList
                items={[
                  fact("products_services", "Products & services"),
                  fact("target_customers", "Target customers"),
                  fact("geography", "Geographic footprint"),
                  {
                    label: "Company size",
                    value: b.sizeEstimate ? (
                      <span className="flex flex-wrap items-center gap-2">
                        {b.sizeEstimate} {b.sizeEvidenceClass && <EvidenceBadge cls={b.sizeEvidenceClass} />}
                      </span>
                    ) : (
                      <span className="text-fg-3">Not published</span>
                    ),
                  },
                ]}
              />
            )}
          </div>
        </Panel>

        <Panel title="Business categories" id="cats">
          <div className="p-4">
            <DefinitionList
              items={[
                { label: "Industry group", value: group?.label ?? "Uncategorized" },
                { label: "Industry", value: b.industry ? industryLabel(b.industry) : "Uncategorized" },
                { label: "Listing category", value: b.category ?? "—" },
                {
                  label: "Listing source",
                  value: (
                    <a className="link inline-flex items-center gap-1" href={b.sourceProvider === "osm" ? `https://www.openstreetmap.org/${b.sourceRef}` : "#"} target="_blank" rel="noopener noreferrer">
                      OpenStreetMap {b.sourceRef} <ExternalLink size={11} />
                    </a>
                  ),
                },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel title="Public contact information" id="pci" actions={<Link to={`/businesses/${id}/contacts`} className="text-xs font-medium text-fg-2 hover:text-fg">All contacts</Link>}>
          <ul className="divide-y divide-border">
            <li className="flex items-center gap-2.5 px-4 py-2.5">
              <Mail size={14} className="shrink-0 text-fg-3" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{b.email ?? <span className="text-fg-3">No public email found</span>}</div>
                {b.emailSource && <div className="t-meta truncate">{b.emailSource}</div>}
              </div>
              {b.email && <CopyButton value={b.email} label="Copy email" />}
            </li>
            <li className="flex items-center gap-2.5 px-4 py-2.5">
              <Phone size={14} className="shrink-0 text-fg-3" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="tnum truncate text-sm">{b.phone ?? <span className="text-fg-3">No public phone found</span>}</div>
                {b.phoneSource && <div className="t-meta truncate">{b.phoneSource}</div>}
              </div>
              {b.phone && <CopyButton value={b.phone} label="Copy phone" />}
            </li>
          </ul>
          {(emails.length > 1 || phones.length > 1) && (
            <p className="border-t border-border px-4 py-2 t-meta">
              {emails.length} email and {phones.length} phone record(s) found — see Contacts.
            </p>
          )}
          {b.website && (
            <p className="border-t border-border px-4 py-2 t-meta">
              Website: {domainOf(b.website)} · {b.websiteSource}
            </p>
          )}
        </Panel>
        <NotesPanel id={id} />
      </div>
    </div>
  );
}

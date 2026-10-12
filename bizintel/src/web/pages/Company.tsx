import { useState } from "react";
import { useParams } from "react-router-dom";
import { Ban, Bookmark, BookmarkCheck, Download, ExternalLink, FlaskConical, Globe, ListPlus, MapPin, Navigation, RefreshCw } from "lucide-react";
import { domainOf, formatDistance } from "@shared/domain";
import { industryLabel } from "@shared/industries";
import { api, errorMessage } from "@/lib/api";
import { keys, useBusiness, useConfig, useContacts, useEvidence, useInvalidate, usePages } from "@/lib/queries";
import { dateTime, relativeTime } from "@/lib/format";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { RouteTabs } from "@/components/ui/Tabs";
import { BlockSkeleton, ErrorState, InlineAlert } from "@/components/ui/States";
import { Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { QualificationBadge, ResearchStatusBadge, ScorePill } from "@/components/business/badges";
import { AddToListDialog, ExportDialog, ResearchDialog } from "@/components/business/dialogs";
import { OverviewTab } from "@/components/company/OverviewTab";
import { ContactsTab } from "@/components/company/ContactsTab";
import { WebsiteTab } from "@/components/company/WebsiteTab";
import { ProductsTab } from "@/components/company/ProductsTab";
import { IntelligenceTab } from "@/components/company/IntelligenceTab";
import { OpportunityTab } from "@/components/company/OpportunityTab";
import { SourcesTab } from "@/components/company/SourcesTab";
import { ActivityTab } from "@/components/company/ActivityTab";

export type TabProps = { id: string; poll: boolean; onResearch: () => void };

export default function Company() {
  const { id = "", tab = "overview" } = useParams();
  const { data: cfg } = useConfig();
  const { data, isLoading, isError, error, refetch } = useBusiness(id);
  const b = data?.business;
  useCrumbs([{ label: "All Businesses", to: "/businesses" }, { label: b?.name ?? "Company" }], cfg?.branding.productName);
  const poll = Boolean(data?.activeJob);
  const contacts = useContacts(id, poll);
  const pages = usePages(id, poll);
  const evidence = useEvidence(id, poll);
  const inv = useInvalidate();
  const toast = useToast();
  const [dialog, setDialog] = useState<null | "list" | "research" | "export">(null);
  const [enriching, setEnriching] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (isLoading) return <PageBody wide><BlockSkeleton lines={10} /></PageBody>;
  if (isError || !b || !data) return <PageBody><ErrorState error={error} onRetry={() => refetch()} /></PageBody>;

  const unit = b.countryCode === "US" || b.countryCode === "GB" ? "mi" : "km";
  const job = data.activeJob;

  const toggleSaved = async () => {
    try {
      await api.patch(`/businesses/${id}`, { saved: !b.saved });
      await inv(keys.business(id), ["businesses"]);
      toast.success(b.saved ? "Removed from saved leads" : "Saved as a lead");
    } catch (e) {
      toast.error("Couldn’t update", errorMessage(e));
    }
  };

  const enrich = async () => {
    setEnriching(true);
    try {
      const r = await api.post<{ contactsAdded: number; pagesRetrieved: number; warnings: string[] }>(`/businesses/${id}/pages/retry`);
      await inv(keys.business(id), ["businesses"]);
      if (r.pagesRetrieved === 0) toast.error("No pages could be retrieved", r.warnings.join(" ") || undefined);
      else toast.success(`Website inspected: ${r.pagesRetrieved} page(s)`, `${r.contactsAdded} new contact record(s).`);
    } catch (e) {
      toast.error("Contact enrichment failed", errorMessage(e));
    } finally {
      setEnriching(false);
    }
  };

  const cancelJob = async () => {
    if (!job) return;
    setCancelling(true);
    try {
      await api.post(`/research/jobs/${job.id}/cancel`);
      await inv(keys.business(id), keys.jobs);
      toast.info("Research cancelled");
    } catch (e) {
      toast.error("Couldn’t cancel", errorMessage(e));
    } finally {
      setCancelling(false);
    }
  };

  const base = `/businesses/${id}`;
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "contacts", label: "Contacts", count: contacts.data?.length ?? null },
    { key: "website", label: "Website Research", count: pages.data?.length ?? null },
    { key: "products", label: "Products & Services" },
    { key: "intelligence", label: "Company Intelligence" },
    { key: "opportunities", label: "Opportunities" },
    { key: "sources", label: "Sources", count: evidence.data ? new Set(evidence.data.map((e) => e.sourceUrl).filter(Boolean)).size : null },
    { key: "activity", label: "Activity" },
  ];
  const tabProps: TabProps = { id, poll, onResearch: () => setDialog("research") };

  return (
    <div>
      {/* Compact company header */}
      <div className="border-b border-border bg-surface">
        <div className="mx-auto max-w-[1600px] px-4 pt-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="t-page-title">{b.name}</h1>
                <ResearchStatusBadge status={b.researchStatus} />
                <QualificationBadge status={b.qualificationStatus} />
                {b.tags.map((t) => (
                  <Badge key={t}>#{t}</Badge>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-2">
                {b.website ? (
                  <a href={b.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary" title={b.websiteSource ?? undefined}>
                    <Globe size={13} className="text-fg-3" /> {domainOf(b.website)} <ExternalLink size={11} />
                    <span className="sr-only">(opens in new tab)</span>
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 text-fg-3">
                    <Globe size={13} /> No official website identified
                  </span>
                )}
                <span>{b.industry ? industryLabel(b.industry) : "Uncategorized"}{b.category ? ` · ${b.category}` : ""}</span>
                {(b.address || b.country) && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={13} className="text-fg-3" /> {[b.address, b.country].filter(Boolean).join(", ")}
                  </span>
                )}
                {b.distanceMeters != null && (
                  <span className="inline-flex items-center gap-1 tnum">
                    <Navigation size={13} className="text-fg-3" /> {formatDistance(b.distanceMeters, unit)} from search center
                  </span>
                )}
                <span className="text-fg-3" title={dateTime(b.lastResearchedAt)}>
                  {b.lastResearchedAt ? `Researched ${relativeTime(b.lastResearchedAt)}` : "Never researched"}
                </span>
                {b.opportunityScore != null && <ScorePill score={b.opportunityScore} />}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" icon={b.saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />} onClick={toggleSaved} aria-pressed={b.saved}>
                {b.saved ? "Saved lead" : "Save lead"}
              </Button>
              <Button size="sm" icon={<ListPlus size={14} />} onClick={() => setDialog("list")}>
                Add to list
              </Button>
              <Button size="sm" icon={<RefreshCw size={14} />} onClick={enrich} loading={enriching} disabled={!b.website || Boolean(job)} title={!b.website ? "No official website to inspect" : undefined}>
                Enrich contacts
              </Button>
              <Button size="sm" icon={<Download size={14} />} onClick={() => setDialog("export")}>
                Export
              </Button>
              <Button size="sm" variant="primary" icon={<FlaskConical size={14} />} onClick={() => setDialog("research")} disabled={Boolean(job)}>
                {b.lastResearchedAt ? "Research again" : "Start research"}
              </Button>
            </div>
          </div>
          {data.lists.length > 0 && (
            <p className="t-meta mt-2">
              On lists: {data.lists.map((l) => l.name).join(", ")}
            </p>
          )}
          <div className="mt-3">
            <RouteTabs tabs={tabs} base={base} label="Company sections" />
          </div>
        </div>
      </div>

      <PageBody wide>
        {job && (
          <div className="mb-5">
            <InlineAlert tone="info" title={job.status === "queued" ? "Research is queued" : `Research in progress — ${job.stage ?? "working"}`} action={<Button size="sm" icon={<Ban size={14} />} loading={cancelling} onClick={cancelJob}>Cancel</Button>}>
              This page updates automatically as results arrive.
            </InlineAlert>
          </div>
        )}
        {tab === "overview" && <OverviewTab {...tabProps} business={b} />}
        {tab === "contacts" && <ContactsTab {...tabProps} business={b} />}
        {tab === "website" && <WebsiteTab {...tabProps} business={b} onEnrich={enrich} enriching={enriching} />}
        {tab === "products" && <ProductsTab {...tabProps} />}
        {tab === "intelligence" && <IntelligenceTab {...tabProps} business={b} onEnrich={enrich} onExport={() => setDialog("export")} />}
        {tab === "opportunities" && <OpportunityTab {...tabProps} />}
        {tab === "sources" && <SourcesTab {...tabProps} business={b} />}
        {tab === "activity" && <ActivityTab {...tabProps} />}
        {!tabs.some((t) => t.key === tab) && <ErrorState title="Unknown section" error={new Error(`There is no “${tab}” section.`)} />}
      </PageBody>

      <AddToListDialog open={dialog === "list"} onClose={() => setDialog(null)} businessIds={[id]} />
      <ResearchDialog open={dialog === "research"} onClose={() => setDialog(null)} businessIds={[id]} />
      {dialog === "export" && <ExportDialog open onClose={() => setDialog(null)} scope={{ kind: "selected", businessIds: [id] }} scopeLabel={b.name} />}
    </div>
  );
}

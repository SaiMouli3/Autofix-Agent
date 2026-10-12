import { useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Settings2, Target } from "lucide-react";
import type { QualificationStatus } from "@/lib/types";
import { api, errorMessage } from "@/lib/api";
import { keys, useConfig, useEvidence, useInvalidate, useOpportunities } from "@/lib/queries";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader } from "@/components/ui/Page";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Pagination } from "@/components/ui/Pagination";
import { EmptyState, ErrorState, InlineAlert, TableSkeleton } from "@/components/ui/States";
import { Drawer } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { QUALIFICATION_OPTIONS, QualificationBadge, ScorePill } from "@/components/business/badges";
import { ScoreBreakdown } from "@/components/company/ScoreBreakdown";
import { EvidenceList } from "@/components/company/shared";
import type { Opportunity } from "@/lib/types";

function Detail({ opp }: { opp: Opportunity }) {
  const { data: evidence = [] } = useEvidence(opp.businessId);
  return (
    <div>
      <ScoreBreakdown opp={opp} />
      <div className="space-y-4 border-t border-border p-4">
        {opp.opportunity && (
          <div>
            <h3 className="t-label mb-1">Potential opportunity</h3>
            <p className="text-sm">{opp.opportunity}</p>
          </div>
        )}
        <div>
          <h3 className="t-label mb-1">Supporting evidence</h3>
          <EvidenceList items={evidence.filter((e) => opp.evidenceIds.includes(e.id))} empty={<p className="text-sm text-fg-3">None recorded.</p>} />
        </div>
        {opp.gaps.length > 0 && (
          <div>
            <h3 className="t-label mb-1">Information gaps</h3>
            <ul className="list-disc space-y-0.5 pl-4 text-sm">{opp.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
          </div>
        )}
        <ButtonLink to={`/businesses/${opp.businessId}/opportunities`} size="sm">Open company</ButtonLink>
      </div>
    </div>
  );
}

export default function Opportunities() {
  const { data: cfg } = useConfig();
  useCrumbs([{ label: "Opportunities" }], cfg?.branding.productName);
  const [status, setStatus] = useState<QualificationStatus | "">("");
  const [minScore, setMinScore] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Opportunity | null>(null);
  const [rescoring, setRescoring] = useState(false);
  const { data, isLoading, isError, error, refetch } = useOpportunities({ status: status || undefined, minScore: minScore ? Number(minScore) : undefined, page, pageSize: 25 });
  const inv = useInvalidate();
  const toast = useToast();
  const q = cfg?.qualification;
  const unconfigured = q && !q.targetIndustries.length && !q.needKeywords.length && !q.targetCountries.length && !q.targetSizes.length;

  return (
    <PageBody wide>
      <PageHeader
        title="Opportunities"
        subtitle="Businesses scored against your workspace’s qualification criteria. Every score shows why it was assigned."
        actions={
          <>
            <ButtonLink to="/settings/qualification" icon={<Settings2 size={15} />}>Criteria</ButtonLink>
            <Button
              icon={<RefreshCw size={15} />}
              loading={rescoring}
              onClick={async () => {
                setRescoring(true);
                try {
                  const r = await api.post<{ rescored: number }>("/opportunities/rescore");
                  await inv(keys.opportunities, ["businesses"], keys.overview);
                  toast.success(`Rescored ${r.rescored} businesses`);
                } catch (e) {
                  toast.error("Rescoring failed", errorMessage(e));
                } finally {
                  setRescoring(false);
                }
              }}
            >
              Rescore all
            </Button>
          </>
        }
      />
      {unconfigured && (
        <div className="mb-4">
          <InlineAlert tone="info" title="Qualification criteria are not configured" action={<ButtonLink to="/settings/qualification" size="sm">Configure</ButtonLink>}>
            Without target industries, sizes, countries or need keywords, scores mostly reflect contactability and research confidence.
          </InlineAlert>
        </div>
      )}
      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          <Select aria-label="Qualification status" value={status} onChange={(e) => (setStatus(e.target.value as QualificationStatus | ""), setPage(1))} className="h-control-sm w-[170px]">
            <option value="">All statuses</option>
            {QUALIFICATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <Input aria-label="Minimum score" type="number" min={0} max={100} placeholder="Min score" value={minScore} onChange={(e) => (setMinScore(e.target.value), setPage(1))} className="h-control-sm w-[110px] tnum" />
        </div>
        {isLoading ? (
          <TableSkeleton />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data?.items.length ? (
          <EmptyState icon={<Target size={18} />} title="No scored businesses" description="Scores are calculated after Standard or Deep research, or when you rescore a company." action={<ButtonLink to="/discover" variant="primary" size="sm">Discover businesses</ButtonLink>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-subtle/60">
                  <tr className="h-9 border-b border-border">
                    <th scope="col" className="px-4 t-th">Business</th>
                    <th scope="col" className="px-3 t-th">Score</th>
                    <th scope="col" className="hidden px-3 t-th lg:table-cell">Why</th>
                    <th scope="col" className="hidden px-3 t-th md:table-cell">Confidence</th>
                    <th scope="col" className="px-3 t-th">Status</th>
                    <th scope="col" className="hidden px-3 t-th xl:table-cell">Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((o) => {
                    const top = [...o.components].sort((a, b) => b.weight * b.value - a.weight * a.value).slice(0, 2);
                    return (
                      <tr key={o.businessId} className="h-row cursor-pointer border-b border-border last:border-0 hover:bg-subtle/60" onClick={() => setOpen(o)}>
                        <th scope="row" className="max-w-[260px] px-4 font-normal">
                          <button className="block max-w-full truncate text-left text-sm font-medium hover:text-primary" onClick={(e) => (e.stopPropagation(), setOpen(o))}>{o.businessName}</button>
                        </th>
                        <td className="px-3"><ScorePill score={o.score} /></td>
                        <td className="hidden max-w-[360px] truncate px-3 text-sm text-fg-2 lg:table-cell">{top.map((c) => `${c.label}: ${c.rationale}`).join(" · ")}</td>
                        <td className="hidden px-3 text-sm capitalize text-fg-2 md:table-cell">{o.confidence}</td>
                        <td className="px-3"><QualificationBadge status={o.qualificationStatus} /></td>
                        <td className="hidden max-w-[240px] truncate px-3 text-sm text-fg-2 xl:table-cell">{o.nextAction}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />
          </>
        )}
      </div>
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open?.businessName ?? ""}>
        {open && <Detail opp={open} />}
      </Drawer>
      <p className="t-meta mt-3">
        Scores measure fit with your criteria — not proof that a company has a particular need. <Link to="/help#scoring" className="link">How scoring works</Link>
      </p>
    </PageBody>
  );
}

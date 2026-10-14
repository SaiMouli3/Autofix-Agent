import { useState } from "react";
import { Link } from "react-router-dom";
import { Ban, FlaskConical } from "lucide-react";
import { DEPTH_INFO } from "@shared/domain";
import type { ResearchJob } from "@/lib/types";
import { api, errorMessage } from "@/lib/api";
import { keys, useConfig, useInvalidate, useJobs } from "@/lib/queries";
import { dateTime, duration, relativeTime } from "@/lib/format";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader, Panel } from "@/components/ui/Page";
import { Button, ButtonLink } from "@/components/ui/Button";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { Badge, Dot, type Tone } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/Toast";
import { BusinessTable } from "@/components/business/BusinessTable";

const JOB_TONE: Record<ResearchJob["status"], Tone> = { queued: "neutral", running: "info", completed: "success", failed: "danger", cancelled: "neutral" };
const JOB_LABEL: Record<ResearchJob["status"], string> = { queued: "Queued", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };

export default function Research() {
  const { data: cfg } = useConfig();
  useCrumbs([{ label: "Research Workspace" }], cfg?.branding.productName);
  const { data: jobs, isLoading, isError, error, refetch } = useJobs({ limit: 50 });
  const inv = useInvalidate();
  const toast = useToast();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const active = jobs?.filter((j) => j.status === "queued" || j.status === "running") ?? [];
  const history = jobs?.filter((j) => j.status !== "queued" && j.status !== "running") ?? [];

  const cancel = async (j: ResearchJob) => {
    setCancelling(j.id);
    try {
      await api.post(`/research/jobs/${j.id}/cancel`);
      await inv(keys.jobs, ["business"]);
      toast.info("Research cancelled");
    } catch (e) {
      toast.error("Couldn’t cancel", errorMessage(e));
    } finally {
      setCancelling(null);
    }
  };

  const JobRow = ({ j }: { j: ResearchJob }) => (
    <tr className="h-row border-b border-border last:border-0 hover:bg-subtle/60">
      <th scope="row" className="max-w-[260px] px-4 font-normal">
        <Link to={`/businesses/${j.businessId}`} className="block truncate text-sm font-medium hover:text-primary">{j.businessName}</Link>
      </th>
      <td className="px-3 text-sm text-fg-2">{DEPTH_INFO[j.depth].label}</td>
      <td className="px-3">
        <Badge tone={JOB_TONE[j.status]} icon={<Dot tone={JOB_TONE[j.status]} pulse={j.status === "running"} />}>{JOB_LABEL[j.status]}</Badge>
      </td>
      <td className="hidden max-w-[320px] truncate px-3 text-sm text-fg-2 md:table-cell" title={j.error ?? undefined}>
        {j.status === "running" ? j.stage : j.error ? <span className={j.status === "failed" ? "text-danger" : ""}>{j.error}</span> : "—"}
      </td>
      <td className="hidden px-3 text-sm text-fg-2 tnum sm:table-cell" title={dateTime(j.createdAt)}>
        {j.finishedAt ? duration(j.createdAt, j.finishedAt) : relativeTime(j.createdAt)}
      </td>
      <td className="pr-3 text-right">
        {(j.status === "queued" || j.status === "running") && (
          <Button size="sm" variant="ghost" icon={<Ban size={13} />} loading={cancelling === j.id} onClick={() => cancel(j)}>Cancel</Button>
        )}
      </td>
    </tr>
  );

  const table = (rows: ResearchJob[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="bg-subtle/60">
          <tr className="h-8 border-b border-border">
            <th scope="col" className="px-4 t-th">Company</th>
            <th scope="col" className="px-3 t-th">Depth</th>
            <th scope="col" className="px-3 t-th">Status</th>
            <th scope="col" className="hidden px-3 t-th md:table-cell">Stage / notes</th>
            <th scope="col" className="hidden px-3 t-th sm:table-cell">Time</th>
            <th scope="col" className="pr-3"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>{rows.map((j) => <JobRow key={j.id} j={j} />)}</tbody>
      </table>
    </div>
  );

  return (
    <PageBody wide>
      <PageHeader title="Research workspace" subtitle="Follow research jobs and review researched companies. Start research from any business table or company page." />
      <div className="space-y-5">
        <Panel title={`In progress (${active.length})`} id="active-jobs">
          {isLoading ? <TableSkeleton rows={3} /> : isError ? <ErrorState compact error={error} onRetry={() => refetch()} /> : active.length ? table(active) : <p className="px-4 py-5 text-sm text-fg-3">No research is running.</p>}
        </Panel>
        <Panel title="Recent jobs" id="history-jobs">
          {isLoading ? (
            <TableSkeleton rows={4} />
          ) : history.length ? (
            table(history)
          ) : (
            <EmptyState compact icon={<FlaskConical size={18} />} title="No research has run yet" description="Select businesses in a results table and choose Research, or open a company and start research." action={<ButtonLink to="/businesses" size="sm" variant="primary">Browse businesses</ButtonLink>} />
          )}
        </Panel>
        <div>
          <h2 className="t-section-title mb-2">Researched companies</h2>
          <BusinessTable
            fixed={{ researchStatus: ["completed", "completed_with_warnings", "failed"] }}
            exportScope={{ kind: "researched" }}
            emptyState={<EmptyState compact icon={<FlaskConical size={18} />} title="No researched companies yet" />}
          />
        </div>
      </div>
    </PageBody>
  );
}

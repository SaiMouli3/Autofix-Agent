import { useState } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Compass, History, Trash2 } from "lucide-react";
import { DEPTH_INFO, fromMeters } from "@shared/domain";
import { industryLabel } from "@shared/industries";
import { api, errorMessage } from "@/lib/api";
import { keys, useConfig, useInvalidate, useSearches } from "@/lib/queries";
import { dateTime, relativeTime } from "@/lib/format";
import type { SearchRecord } from "@/lib/types";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader } from "@/components/ui/Page";
import { ButtonLink, IconButton } from "@/components/ui/Button";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { SearchStatusBadge } from "@/components/business/badges";

const PAGE = 25;

export default function SearchHistory() {
  const { data: cfg } = useConfig();
  useCrumbs([{ label: "Search History" }], cfg?.branding.productName);
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useSearches(PAGE, (page - 1) * PAGE);
  const [del, setDel] = useState<SearchRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const inv = useInvalidate();
  const toast = useToast();

  return (
    <PageBody wide>
      <PageHeader title="Search history" subtitle="Every discovery search run in this workspace, newest first." actions={<ButtonLink to="/discover" variant="primary" icon={<Compass size={15} />}>New search</ButtonLink>} />
      <div className="panel overflow-hidden">
        {isLoading ? (
          <TableSkeleton />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data?.items.length ? (
          <EmptyState icon={<History size={18} />} title="No searches yet" description="Run your first discovery search to start building a research workspace." action={<ButtonLink to="/discover" variant="primary">Discover businesses</ButtonLink>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-subtle/80">
                  <tr className="h-9 border-b border-border">
                    <th scope="col" className="px-4 t-th">Search</th>
                    <th scope="col" className="hidden px-3 t-th md:table-cell">Location</th>
                    <th scope="col" className="hidden px-3 t-th lg:table-cell">Industries</th>
                    <th scope="col" className="px-3 text-right t-th">Businesses</th>
                    <th scope="col" className="hidden px-3 t-th sm:table-cell">Depth</th>
                    <th scope="col" className="px-3 t-th">Status</th>
                    <th scope="col" className="hidden px-3 t-th md:table-cell">Created</th>
                    <th scope="col" className="w-10 pr-3"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((s) => (
                    <tr key={s.id} className="h-row border-b border-border last:border-0 hover:bg-subtle/60">
                      <th scope="row" className="max-w-[280px] px-4 font-normal">
                        <Link to={`/searches/${s.id}`} className="flex items-center gap-1.5 truncate text-sm font-medium hover:text-primary">
                          {s.saved && <Bookmark size={12} className="shrink-0 text-primary" aria-label="Saved" />}
                          <span className="truncate">{s.name}</span>
                        </Link>
                      </th>
                      <td className="hidden max-w-[220px] truncate px-3 text-sm text-fg-2 md:table-cell">
                        {s.location.label.split(",").slice(0, 2).join(",")} · <span className="tnum">{fromMeters(s.radiusMeters, s.unit).toFixed(1)} {s.unit}</span>
                      </td>
                      <td className="hidden max-w-[220px] truncate px-3 text-sm text-fg-2 lg:table-cell">{s.industries.length ? s.industries.map(industryLabel).join(", ") : "All"}</td>
                      <td className="px-3 text-right text-sm tnum">{s.counters.unique.toLocaleString()}</td>
                      <td className="hidden px-3 text-sm text-fg-2 sm:table-cell">{DEPTH_INFO[s.depth].label}</td>
                      <td className="px-3"><SearchStatusBadge status={s.status} /></td>
                      <td className="hidden px-3 text-sm text-fg-2 md:table-cell" title={dateTime(s.createdAt)}>{relativeTime(s.createdAt)}</td>
                      <td className="pr-3">
                        <IconButton label={`Delete ${s.name}`} size="sm" disabled={s.status === "running" || s.status === "queued"} onClick={() => setDel(s)}>
                          <Trash2 size={14} />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
          </>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(del)}
        onClose={() => setDel(null)}
        tone="danger"
        loading={busy}
        title="Delete this search?"
        description="The search record and its result grouping are removed. Businesses, research and lists are kept and remain under All Businesses."
        confirmLabel="Delete search"
        onConfirm={async () => {
          if (!del) return;
          setBusy(true);
          try {
            await api.del(`/searches/${del.id}`);
            await inv(keys.searches, keys.overview);
            toast.success("Search deleted");
            setDel(null);
          } catch (e) {
            toast.error("Couldn’t delete the search", errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </PageBody>
  );
}

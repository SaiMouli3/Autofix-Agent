import { useState } from "react";
import { Link } from "react-router-dom";
import { ListChecks, Plus } from "lucide-react";
import { useConfig, useLists } from "@/lib/queries";
import { relativeTime } from "@/lib/format";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { NewListDialog } from "@/components/business/dialogs";
import { useNavigate } from "react-router-dom";

export default function Lists() {
  const { data: cfg } = useConfig();
  useCrumbs([{ label: "Saved Lists" }], cfg?.branding.productName);
  const { data, isLoading, isError, error, refetch } = useLists();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  return (
    <PageBody>
      <PageHeader title="Saved lists" subtitle="Organize businesses for follow-up. A business appears at most once per list." actions={<Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>New list</Button>} />
      <div className="panel overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={4} cols={3} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data?.length ? (
          <EmptyState
            icon={<ListChecks size={18} />}
            title="No lists yet"
            description="Create a list, or select businesses in any results table and choose “Save to list”."
            action={<Button variant="primary" size="sm" onClick={() => setCreating(true)}>Create a list</Button>}
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((l) => (
              <li key={l.id}>
                <Link to={`/lists/${l.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-subtle/60">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded bg-subtle text-fg-3" aria-hidden>
                    <ListChecks size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{l.name}</div>
                    <div className="t-meta truncate">{l.description ?? `Updated ${relativeTime(l.updatedAt)}`}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tnum">{l.count.toLocaleString()}</div>
                    <div className="t-meta">{l.count === 1 ? "business" : "businesses"}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <NewListDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/lists/${id}`)} />
    </PageBody>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  Columns3,
  Download,
  ExternalLink,
  FlaskConical,
  ListPlus,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  Tag,
  Target,
  X,
} from "lucide-react";
import { domainOf, formatDistance } from "@shared/domain";
import { industryLabel } from "@shared/industries";
import type { Business, BusinessQuery, BusinessSortKey, DistanceUnit, ExportScope } from "@/lib/types";
import { useBusinesses } from "@/lib/queries";
import { api, errorMessage } from "@/lib/api";
import { useDebounced } from "@/lib/useDebounced";
import { cn, plural } from "@/lib/format";
import { Button, IconButton } from "../ui/Button";
import { Checkbox, Input } from "../ui/Field";
import { Menu } from "../ui/Menu";
import { Pagination } from "../ui/Pagination";
import { ErrorState, TableSkeleton } from "../ui/States";
import { Badge, Spinner } from "../ui/primitives";
import { useToast } from "../ui/Toast";
import { ResearchStatusBadge, ScorePill } from "./badges";
import { BusinessFilters } from "./BusinessFilters";
import { AddToListDialog, ExportDialog, QualificationDialog, ResearchDialog, TagDialog } from "./dialogs";
import { useBusinessQuery } from "./useBusinessQuery";

type ColKey = "industry" | "location" | "distance" | "website" | "phone" | "email" | "size" | "status" | "score";

const COLUMNS: { key: ColKey; label: string; sort?: BusinessSortKey; className?: string; requiresSearch?: boolean }[] = [
  { key: "industry", label: "Industry", sort: "industry", className: "hidden xl:table-cell" },
  { key: "location", label: "Location", className: "hidden 2xl:table-cell" },
  { key: "distance", label: "Distance", sort: "distance", requiresSearch: true, className: "text-right" },
  { key: "website", label: "Website", className: "hidden md:table-cell" },
  { key: "phone", label: "Phone", className: "hidden xl:table-cell" },
  { key: "email", label: "Email", className: "hidden lg:table-cell" },
  { key: "size", label: "Size", className: "hidden 2xl:table-cell" },
  { key: "status", label: "Research status", sort: "researchStatus" },
  { key: "score", label: "Score", sort: "opportunityScore" },
];

const DEFAULT_VISIBLE: ColKey[] = ["industry", "location", "distance", "website", "phone", "email", "status", "score"];

function loadVisible(): ColKey[] {
  try {
    const v = JSON.parse(localStorage.getItem("table-columns") ?? "null");
    return Array.isArray(v) ? v : DEFAULT_VISIBLE;
  } catch {
    return DEFAULT_VISIBLE;
  }
}

const researched = (b: Business) => b.researchStatus === "completed" || b.researchStatus === "completed_with_warnings" || b.researchStatus === "failed";

function Missing({ checked }: { checked: boolean }) {
  return <span className="text-sm text-fg-3">{checked ? "Not found" : "Not checked"}</span>;
}

function Cell({ b, col, unit }: { b: Business; col: ColKey; unit: DistanceUnit }) {
  switch (col) {
    case "industry":
      return <span className="text-sm text-fg-2">{b.industry ? industryLabel(b.industry) : "Uncategorized"}</span>;
    case "location":
      return <span className="block max-w-[200px] truncate text-sm text-fg-2" title={b.address ?? undefined}>{[b.city, b.region].filter(Boolean).join(", ") || b.address || "—"}</span>;
    case "distance":
      return <span className="tnum text-sm text-fg-2">{formatDistance(b.distanceMeters, unit)}</span>;
    case "website":
      return b.website ? (
        <a href={b.website} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[180px] items-center gap-1 text-sm text-fg-2 hover:text-primary" title={b.websiteSource ?? undefined}>
          <span className="truncate">{domainOf(b.website)}</span>
          <ExternalLink size={11} className="shrink-0" aria-hidden />
          <span className="sr-only">(opens in new tab)</span>
        </a>
      ) : (
        <Missing checked={b.researchStatus !== "discovered"} />
      );
    case "phone":
      return b.phone ? (
        <span className="tnum whitespace-nowrap text-sm" title={b.phoneSource ?? undefined}>
          {b.phone}
        </span>
      ) : (
        <Missing checked={researched(b)} />
      );
    case "email":
      return b.email ? (
        <span className="block max-w-[200px] truncate text-sm" title={`${b.email}${b.emailSource ? ` — ${b.emailSource}` : ""}`}>
          {b.email}
        </span>
      ) : (
        <Missing checked={researched(b)} />
      );
    case "size":
      return b.sizeEstimate ? <span className="text-sm text-fg-2">{b.sizeEstimate}</span> : <span className="text-sm text-fg-3">Unknown</span>;
    case "status":
      return <ResearchStatusBadge status={b.researchStatus} />;
    case "score":
      return <ScorePill score={b.opportunityScore} />;
  }
}

function SortHeader({ label, sortKey, query, onSort }: { label: string; sortKey?: BusinessSortKey; query: BusinessQuery; onSort: (k: BusinessSortKey) => void }) {
  if (!sortKey) return <span className="t-th">{label}</span>;
  const active = query.sort === sortKey;
  const Icon = !active ? ArrowUpDown : query.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <button type="button" onClick={() => onSort(sortKey)} className={cn("inline-flex items-center gap-1 t-th hover:text-fg", active && "text-fg")}>
      {label}
      <Icon size={12} aria-hidden />
    </button>
  );
}

function MobileCard({ b, unit, selected, onSelect }: { b: Business; unit: DistanceUnit; selected: boolean; onSelect: (v: boolean) => void }) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <Checkbox aria-label={`Select ${b.name}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/businesses/${b.id}`} className="font-medium hover:text-primary">
            {b.name}
          </Link>
          <ScorePill score={b.opportunityScore} />
        </div>
        <div className="mt-0.5 text-xs text-fg-3">
          {[b.category, b.city, b.distanceMeters != null ? formatDistance(b.distanceMeters, unit) : null].filter(Boolean).join(" · ")}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ResearchStatusBadge status={b.researchStatus} />
          {b.website && <Badge>{domainOf(b.website)}</Badge>}
          {b.phone && <Badge>{b.phone}</Badge>}
          {b.email && <Badge>{b.email}</Badge>}
        </div>
      </div>
    </li>
  );
}

export interface BusinessTableProps {
  fixed?: Partial<BusinessQuery>;
  unit?: DistanceUnit;
  exportScope?: ExportScope;
  exportScopeLabel?: string;
  poll?: boolean;
  emptyState: ReactNode;
  toolbarExtra?: ReactNode;
  rowMenuExtra?: (b: Business) => { label: string; onSelect: () => void }[];
  bulkExtra?: (ids: string[], clear: () => void) => ReactNode;
  defaultSort?: BusinessSortKey;
}

export function BusinessTable({ fixed = {}, unit = "mi", exportScope, exportScopeLabel, poll, emptyState, toolbarExtra, rowMenuExtra, bulkExtra, defaultSort }: BusinessTableProps) {
  const { query, update, activeFilterCount, clearFilters } = useBusinessQuery(fixed, defaultSort ? { sort: defaultSort } : {});
  const { data, isLoading, isError, error, refetch, isFetching } = useBusinesses(query, { poll });
  const [visible, setVisible] = useState<ColKey[]>(loadVisible);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState<string[] | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "list" | "research" | "tags" | "qual" | "export">(null);
  const [searchText, setSearchText] = useState(query.q ?? "");
  const dq = useDebounced(searchText, 300);
  const toast = useToast();
  const navigate = useNavigate();
  const hasDistance = Boolean(fixed.searchId);

  useEffect(() => {
    if ((query.q ?? "") !== dq) update({ q: dq || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  useEffect(() => {
    try {
      localStorage.setItem("table-columns", JSON.stringify(visible));
    } catch {
      /* ignore */
    }
  }, [visible]);

  // Selection resets whenever the filter set changes so bulk actions never act on hidden rows.
  const filterKey = JSON.stringify({ ...query, page: undefined, pageSize: undefined, sort: undefined, dir: undefined });
  useEffect(() => {
    setSelected(new Set());
    setAllMatching(null);
  }, [filterKey]);

  const cols = useMemo(() => COLUMNS.filter((c) => visible.includes(c.key) && (!c.requiresSearch || hasDistance)), [visible, hasDistance]);
  const items = data?.items ?? [];
  const pageIds = items.map((b) => b.id);
  const selectedIds = allMatching ?? [...selected];
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));
  const clear = () => {
    setSelected(new Set());
    setAllMatching(null);
  };

  const onSort = (k: BusinessSortKey) => {
    const dir = query.sort === k ? (query.dir === "desc" ? "asc" : "desc") : k === "opportunityScore" || k === "updatedAt" ? "desc" : "asc";
    update({ sort: k, dir }, false);
  };

  const selectAllMatching = async () => {
    try {
      const { ids } = await api.post<{ ids: string[] }>("/businesses/ids", { ...query, page: undefined, pageSize: undefined });
      setAllMatching(ids);
    } catch (e) {
      toast.error("Couldn’t select all results", errorMessage(e));
    }
  };

  return (
    <div className="panel overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="w-full sm:w-[260px]">
          <Input icon={<Search size={14} />} value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Filter by name, domain, city" aria-label="Filter businesses" className="h-control-sm" />
        </div>
        <Button size="sm" icon={<SlidersHorizontal size={14} />} onClick={() => setFiltersOpen(true)}>
          Filters
          {activeFilterCount > 0 && <span className="tnum ml-0.5 rounded-full bg-primary px-1.5 text-2xs text-primary-fg">{activeFilterCount}</span>}
        </Button>
        {activeFilterCount > 0 && (
          <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={clearFilters}>
            Clear
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isFetching && !isLoading && <Spinner size={14} className="text-fg-3" label="Updating" />}
          {toolbarExtra}
          <Menu
            label="Visible columns"
            items={COLUMNS.filter((c) => !c.requiresSearch || hasDistance).map((c) => ({
              label: `${visible.includes(c.key) ? "✓ " : "   "}${c.label}`,
              onSelect: () => setVisible((v) => (v.includes(c.key) ? v.filter((x) => x !== c.key) : [...v, c.key])),
            }))}
            trigger={(p) => (
              <Button size="sm" icon={<Columns3 size={14} />} {...p}>
                <span className="hidden sm:inline">Columns</span>
              </Button>
            )}
          />
          {exportScope && (
            <Button size="sm" icon={<Download size={14} />} onClick={() => setDialog("export")} disabled={!data?.total}>
              <span className="hidden sm:inline">Export</span>
            </Button>
          )}
        </div>
      </div>

      {/* Bulk bar */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-primary/20 bg-primary-subtle/60 px-3 py-2" role="region" aria-label="Bulk actions">
          <span className="tnum text-sm font-medium">{plural(selectedIds.length, "selected", "selected")}</span>
          {!allMatching && allOnPage && data && data.total > items.length && (
            <button className="text-sm text-primary hover:underline" onClick={selectAllMatching}>
              Select all {data.total.toLocaleString()} matching
            </button>
          )}
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear selection
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button size="sm" icon={<ListPlus size={14} />} onClick={() => setDialog("list")}>
              Save to list
            </Button>
            <Button size="sm" icon={<FlaskConical size={14} />} onClick={() => setDialog("research")}>
              Research
            </Button>
            <Button size="sm" icon={<Download size={14} />} onClick={() => setDialog("export")}>
              Export
            </Button>
            <Button size="sm" icon={<Tag size={14} />} onClick={() => setDialog("tags")}>
              Tags
            </Button>
            <Button size="sm" icon={<Target size={14} />} onClick={() => setDialog("qual")}>
              Qualification
            </Button>
            {bulkExtra?.(selectedIds, clear)}
          </div>
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <TableSkeleton cols={Math.min(6, cols.length + 1)} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        activeFilterCount || query.q ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-semibold">No businesses match these filters</p>
            <p className="mt-1 text-sm text-fg-2">Try removing a filter or broadening the text filter.</p>
            <Button className="mt-4" size="sm" onClick={() => (setSearchText(""), clearFilters())}>
              Clear filters
            </Button>
          </div>
        ) : (
          emptyState
        )
      ) : (
        <>
          <ul className="divide-y divide-border md:hidden" aria-label="Businesses">
            {items.map((b) => (
              <MobileCard
                key={b.id}
                b={b}
                unit={unit}
                selected={allMatching ? allMatching.includes(b.id) : selected.has(b.id)}
                onSelect={(v) => {
                  setAllMatching(null);
                  setSelected((s) => {
                    const n = new Set(s);
                    if (v) n.add(b.id);
                    else n.delete(b.id);
                    return n;
                  });
                }}
              />
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-sticky bg-subtle/80 backdrop-blur">
                <tr className="h-9 border-b border-border">
                  <th scope="col" className="w-10 pl-4">
                    <Checkbox
                      aria-label="Select all on this page"
                      checked={allOnPage}
                      indeterminate={!allOnPage && someOnPage}
                      onChange={(e) => {
                        setAllMatching(null);
                        setSelected((s) => {
                          const n = new Set(s);
                          pageIds.forEach((id) => (e.target.checked ? n.add(id) : n.delete(id)));
                          return n;
                        });
                      }}
                    />
                  </th>
                  <th scope="col" className="px-3" aria-sort={query.sort === "name" ? (query.dir === "desc" ? "descending" : "ascending") : undefined}>
                    <SortHeader label="Business" sortKey="name" query={query} onSort={onSort} />
                  </th>
                  {cols.map((c) => (
                    <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3", c.className)} aria-sort={c.sort && query.sort === c.sort ? (query.dir === "desc" ? "descending" : "ascending") : undefined}>
                      <SortHeader label={c.label} sortKey={c.sort} query={query} onSort={onSort} />
                    </th>
                  ))}
                  <th scope="col" className="w-12 pr-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((b) => {
                  const isSel = allMatching ? allMatching.includes(b.id) : selected.has(b.id);
                  return (
                    <tr key={b.id} className={cn("h-row border-b border-border last:border-0 hover:bg-subtle/60", isSel && "bg-primary-subtle/40")}>
                      <td className="pl-4">
                        <Checkbox
                          aria-label={`Select ${b.name}`}
                          checked={isSel}
                          onChange={(e) => {
                            setAllMatching(null);
                            setSelected((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(b.id);
                              else n.delete(b.id);
                              return n;
                            });
                          }}
                        />
                      </td>
                      <th scope="row" className="max-w-[260px] px-3 py-1.5 font-normal">
                        <Link to={`/businesses/${b.id}`} className="block truncate text-sm font-medium text-fg hover:text-primary">
                          {b.name}
                        </Link>
                        <span className="block truncate text-xs text-fg-3">{[b.category, b.tags.length ? b.tags.map((t) => `#${t}`).join(" ") : null].filter(Boolean).join(" · ") || "—"}</span>
                      </th>
                      {cols.map((c) => (
                        <td key={c.key} className={cn("px-3", c.className)}>
                          <Cell b={b} col={c.key} unit={unit} />
                        </td>
                      ))}
                      <td className="pr-3 text-right">
                        <Menu
                          label={`Actions for ${b.name}`}
                          items={[
                            { label: "Open company workspace", icon: <Building2 size={14} />, onSelect: () => navigate(`/businesses/${b.id}`) },
                            ...(b.website ? [{ label: "Open website", icon: <ExternalLink size={14} />, onSelect: () => window.open(b.website!, "_blank", "noopener") }] : []),
                            { label: "Research…", icon: <FlaskConical size={14} />, onSelect: () => (setSelected(new Set([b.id])), setAllMatching(null), setDialog("research")) },
                            { label: "Save to list…", icon: <ListPlus size={14} />, onSelect: () => (setSelected(new Set([b.id])), setAllMatching(null), setDialog("list")) },
                            ...(rowMenuExtra?.(b) ?? []),
                          ]}
                          trigger={(p) => (
                            <IconButton label={`Actions for ${b.name}`} size="sm" {...p}>
                              <MoreHorizontal size={16} />
                            </IconButton>
                          )}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={query.page ?? 1} pageSize={query.pageSize ?? 50} total={data?.total ?? 0} onPage={(p) => update({ page: p }, false)} onPageSize={(n) => update({ size: n })} />
        </>
      )}

      <BusinessFilters open={filtersOpen} onClose={() => setFiltersOpen(false)} query={query} update={update} onClear={clearFilters} activeCount={activeFilterCount} />
      <AddToListDialog open={dialog === "list"} onClose={() => setDialog(null)} businessIds={selectedIds} onDone={clear} />
      <ResearchDialog open={dialog === "research"} onClose={() => setDialog(null)} businessIds={selectedIds} onDone={clear} />
      <TagDialog open={dialog === "tags"} onClose={() => setDialog(null)} businessIds={selectedIds} onDone={clear} />
      <QualificationDialog open={dialog === "qual"} onClose={() => setDialog(null)} businessIds={selectedIds} onDone={clear} />
      {dialog === "export" && (
        <ExportDialog
          open
          onClose={() => setDialog(null)}
          scope={selectedIds.length ? { kind: "selected", businessIds: selectedIds } : (exportScope ?? { kind: "all" })}
          scopeLabel={selectedIds.length ? undefined : exportScopeLabel}
        />
      )}
    </div>
  );
}

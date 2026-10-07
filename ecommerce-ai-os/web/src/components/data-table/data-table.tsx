"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronDown, Columns3, Download, Inbox, Search, X } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useList } from "@/lib/queries";
import { cn } from "@/lib/cn";
import { qs } from "@/lib/api";
import type { Row } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/overlay";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/states/states";

export interface Column {
  key: string;
  label: string;
  render?: (row: Row) => React.ReactNode;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  hidden?: boolean;
  className?: string;
  minWidth?: number;
}

export interface FilterDef {
  key: string;
  label: string;
  options?: { value: string; label: string }[]; // static; otherwise from facets
  format?: (v: string) => string;
}

export function DataTable({ endpoint, columns, filters = [], defaultSort, defaultDir = "desc", initialParams = {}, searchPlaceholder = "Search…", expand, title, description, dateFilter, toolbarExtra, pageSize: ps = 25, onRowClick }: {
  endpoint: string; columns: Column[]; filters?: FilterDef[]; defaultSort?: string; defaultDir?: "asc" | "desc";
  initialParams?: Record<string, string>; searchPlaceholder?: string; expand?: (row: Row) => React.ReactNode; title?: string; description?: string;
  dateFilter?: boolean; toolbarExtra?: React.ReactNode; pageSize?: number; onRowClick?: (row: Row) => void;
}) {
  const [q, setQ] = useState(initialParams.q ?? "");
  const [dq, setDq] = useState(q);
  const [sort, setSort] = useState(defaultSort);
  const [dir, setDir] = useState<"asc" | "desc">(defaultDir);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ps);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const [k, val] of Object.entries(initialParams)) if (k !== "q" && k !== "tab") v[k] = val;
    return v;
  });
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.hidden).map((c) => c.key)));
  const [expanded, setExpanded] = useState<string | null>(null);
  const storeId = useAppStore((s) => s.storeId);

  useEffect(() => {
    const t = setTimeout(() => { setDq(q); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => ({ ...values, q: dq, sort, dir, page, pageSize }), [values, dq, sort, dir, page, pageSize]);
  const { data, error, isLoading, isFetching, refetch } = useList(endpoint, params as Record<string, string | number | undefined>);
  const visible = columns.filter((c) => !hidden.has(c.key));
  const activeFilters = Object.entries(values).filter(([, v]) => v);

  const setFilter = (k: string, v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    setPage(1);
  };
  const toggleSort = (k: string) => {
    if (sort === k) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(k); setDir("desc"); }
    setPage(1);
  };

  const exportCsv = async () => {
    try {
      const res = await fetch(`/api/${endpoint}/list${qs({ ...values, q: dq, sort, dir, format: "csv" })}`, { headers: storeId ? { "X-Store-ID": storeId } : {} });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${endpoint}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export ready", { description: `${data?.total ?? ""} rows downloaded as CSV.` });
    } catch {
      toast.error("Export failed", { description: "The server couldn't build the file. Try again." });
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const rowKey = (r: Row, i: number) => String(r.id ?? r.productId ?? i);

  return (
    <div className="card overflow-hidden">
      {(title || description) && (
        <div className="px-5 pt-4">
          {title && <h3 className="text-[14px] font-semibold">{title}</h3>}
          {description && <p className="text-[12.5px] text-fg-3">{description}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="h-8 pl-8 text-[12.5px]" aria-label="Search table" />
          {q && <button onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg" aria-label="Clear search"><X className="size-3.5" /></button>}
        </div>
        {filters.map((f) => {
          const opts = f.options ?? (data?.facets?.[f.key] ?? []).map((x) => ({ value: x.value, label: `${f.format ? f.format(x.value) : x.value} (${x.count})` }));
          const current = values[f.key] ?? "";
          const withCurrent = current && !opts.some((o) => o.value === current) ? [{ value: current, label: f.format ? f.format(current) : current }, ...opts] : opts;
          return (
            <Select key={f.key} value={current} onChange={(e) => setFilter(f.key, e.target.value)} aria-label={f.label} className="max-w-[180px]">
              <option value="">{f.label}: All</option>
              {withCurrent.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          );
        })}
        {dateFilter && (
          <div className="flex items-center gap-1">
            <Input type="date" aria-label="From date" value={values.from ?? ""} onChange={(e) => setFilter("from", e.target.value)} className="h-8 w-[132px] px-2 text-[12px]" />
            <span className="text-fg-3">–</span>
            <Input type="date" aria-label="To date" value={values.to ?? ""} onChange={(e) => setFilter("to", e.target.value)} className="h-8 w-[132px] px-2 text-[12px]" />
          </div>
        )}
        {toolbarExtra}
        <div className="ml-auto flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost"><Columns3 /> <span className="hidden sm:inline">Columns</span></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              {columns.map((c) => (
                <DropdownMenuCheckboxItem key={c.key} checked={!hidden.has(c.key)} onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(v) => setHidden((h) => { const n = new Set(h); if (v) n.delete(c.key); else n.add(c.key); return n; })}>
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="secondary" onClick={exportCsv}><Download /> <span className="hidden sm:inline">Export</span></Button>
        </div>
      </div>
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface-2 px-4 py-2 text-[12px]">
          <span className="text-fg-3">Filtered by</span>
          {activeFilters.map(([k, v]) => (
            <button key={k} onClick={() => setFilter(k, "")} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-fg-2 hover:border-border-strong">
              {filters.find((f) => f.key === k)?.label ?? k}: <span className="font-medium text-fg">{filters.find((f) => f.key === k)?.format?.(v) ?? v}</span> <X className="size-3" />
            </button>
          ))}
          <button onClick={() => { setValues({}); setPage(1); }} className="ml-1 text-fg-3 hover:text-fg">Clear all</button>
        </div>
      )}
      {error && !data ? (
        <ErrorState error={error} onRetry={() => refetch()} compact />
      ) : isLoading ? (
        <RowsSkeleton cols={Math.min(visible.length, 7)} />
      ) : data && data.rows.length === 0 ? (
        <EmptyState icon={Inbox} title="No matching records" description="Try clearing a filter or widening the search — the agents analysed every record in this store." />
      ) : (
        <div className={cn("scrollbar-thin overflow-x-auto transition-opacity", isFetching && "opacity-70")}>
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-2 text-left text-[11.5px] text-fg-3">
              <tr>
                {expand && <th className="w-8" aria-label="Expand" />}
                {visible.map((c) => (
                  <th key={c.key} scope="col" className={cn("whitespace-nowrap px-4 py-2.5 font-medium", c.align === "right" && "text-right", c.align === "center" && "text-center")} style={{ minWidth: c.minWidth }}
                    aria-sort={sort === c.key ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                    {c.sortable !== false ? (
                      <button onClick={() => toggleSort(c.key)} className={cn("inline-flex items-center gap-1 hover:text-fg", sort === c.key && "text-fg", c.align === "right" && "flex-row-reverse")}>
                        {c.label}
                        {sort === c.key ? (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.rows.map((r, i) => {
                const k = rowKey(r, i);
                const open = expanded === k;
                return (
                  <Fragment key={k}>
                    <tr
                      className={cn("transition-colors hover:bg-surface-2", (expand || onRowClick) && "cursor-pointer", open && "bg-surface-2")}
                      onClick={() => (onRowClick ? onRowClick(r) : expand && setExpanded(open ? null : k))}
                      tabIndex={expand || onRowClick ? 0 : undefined}
                      onKeyDown={(e) => { if (e.key === "Enter") (onRowClick ? onRowClick(r) : expand && setExpanded(open ? null : k)); }}
                      aria-expanded={expand ? open : undefined}
                    >
                      {expand && (
                        <td className="pl-3 text-fg-3">{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</td>
                      )}
                      {visible.map((c) => (
                        <td key={c.key} className={cn("whitespace-nowrap px-4 py-2.5 tabular", c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}>
                          {c.render ? c.render(r) : (r[c.key] ?? "—")}
                        </td>
                      ))}
                    </tr>
                    {expand && open && (
                      <tr className="bg-surface-2">
                        <td colSpan={visible.length + 1} className="px-4 pb-4 pt-1">{expand(r)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-[12px] text-fg-3">
          <span className="tabular">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)} of {data.total.toLocaleString("en-US")}
          </span>
          <div className="flex items-center gap-2">
            <Select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} aria-label="Rows per page" className="h-7">
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </Select>
            <Button size="icon-sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft /></Button>
            <span className="tabular">{page} / {totalPages}</span>
            <Button size="icon-sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

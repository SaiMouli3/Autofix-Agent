"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { X } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/states/states";
import { ProductGrid, ProductGridSkeleton } from "@/components/shop/shop-ui";
import { cn } from "@/lib/cn";
import { useCatalog, useShopHome } from "@/lib/shop";

const SORTS = [
  { value: "popular", label: "Best selling" },
  { value: "rating", label: "Top rated" },
  { value: "new", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="pt-10"><ProductGridSkeleton /></div>}>
      <Catalog />
    </Suspense>
  );
}

function Catalog() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const category = sp.get("category") ?? "";
  const q = sp.get("q") ?? "";
  const sort = sp.get("sort") ?? "popular";
  const page = Math.max(1, Number(sp.get("page") ?? 1) || 1);
  const home = useShopHome();
  const { data, isLoading, isFetching, error, refetch } = useCatalog({ category, q, sort, page });

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!("page" in patch)) next.delete("page");
    const s = next.toString();
    router.push(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const title = q ? `Results for “${q}”` : category || "Shop all";

  return (
    <div className="flex flex-col gap-8 pt-10">
      <div className="flex flex-col gap-1">
        <nav className="text-[12px] text-fg-3" aria-label="Breadcrumb">
          <Link href="/shop" className="hover:text-fg">Home</Link> / <span>{category || "All products"}</span>
        </nav>
        <h1 className="text-[32px] font-semibold tracking-[-0.04em]">{title}</h1>
        <p className="text-[13px] text-fg-3 tabular">{data ? `${data.total} products` : " "}</p>
      </div>

      <div className="flex flex-col gap-4 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          <FilterChip active={!category} onClick={() => set({ category: null })}>All</FilterChip>
          {(home.data?.categories ?? []).map((c) => (
            <FilterChip key={c.name} active={category === c.name} onClick={() => set({ category: c.name })}>
              {c.name}
            </FilterChip>
          ))}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-[13px] text-fg-2">
          Sort
          <select
            value={sort}
            onChange={(e) => set({ sort: e.target.value === "popular" ? null : e.target.value })}
            className="h-9 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-fg"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      {q && (
        <button type="button" onClick={() => set({ q: null })} className="inline-flex w-fit items-center gap-1.5 rounded-full bg-surface-3 px-3 py-1 text-[12px] font-medium">
          Search: {q} <X className="size-3.5" aria-label="Clear search" />
        </button>
      )}

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <ProductGridSkeleton count={12} />
      ) : data.items.length === 0 ? (
        <EmptyState title="No products match" description="Try another category or a different search." action={<Link href="/shop/products" className="text-[13px] font-medium underline">Clear filters</Link>} />
      ) : (
        <div className={cn("transition-opacity", isFetching && "opacity-60")}>
          <ProductGrid products={data.items} />
        </div>
      )}

      {data && pages > 1 && (
        <nav className="flex items-center justify-center gap-2" aria-label="Pagination">
          <PageBtn disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Previous</PageBtn>
          <span className="px-3 text-[13px] text-fg-2 tabular">Page {page} of {pages}</span>
          <PageBtn disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Next</PageBtn>
        </nav>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
        active ? "border-fg bg-fg text-bg" : "border-border bg-surface text-fg-2 hover:border-border-strong hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function PageBtn({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="h-9 rounded-lg border border-border bg-surface px-3.5 text-[13px] font-medium disabled:opacity-40">
      {children}
    </button>
  );
}

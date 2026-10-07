"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { RotateCcw, Truck } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { EmptyState, ErrorState } from "@/components/states/states";
import { ProductArt, ProductGrid, QtyStepper, Stars, stockLabel } from "@/components/shop/shop-ui";
import { cn } from "@/lib/cn";
import { shortDate, usd } from "@/lib/format";
import { MAX_QTY, useCart, useShopProduct } from "@/lib/shop";

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useShopProduct(id);
  const add = useCart((s) => s.add);
  const [qty, setQty] = useState(1);

  if (error instanceof ApiError && error.status === 404) {
    return <EmptyState className="my-24" title="This product isn't available" description="It may have been removed from the collection." action={<Link href="/shop/products" className="text-[13px] font-medium underline">Browse all products</Link>} />;
  }
  if (error) return <ErrorState error={error} onRetry={() => refetch()} className="my-24" />;
  if (isLoading || !data) {
    return (
      <div className="grid gap-10 pt-10 md:grid-cols-2">
        <div className="aspect-[4/5] animate-pulse rounded-xl bg-surface-3" />
        <div className="flex flex-col gap-3">
          <div className="h-4 w-24 animate-pulse rounded bg-surface-3" />
          <div className="h-8 w-3/4 animate-pulse rounded bg-surface-3" />
          <div className="h-6 w-20 animate-pulse rounded bg-surface-3" />
        </div>
      </div>
    );
  }

  const p = data.product;
  const stock = stockLabel(p);
  const soldOut = p.available <= 0;
  const maxQty = Math.max(1, Math.min(MAX_QTY, p.available));
  const total = data.distribution.reduce((a, b) => a + b, 0);

  const addToBag = (goToBag: boolean) => {
    add(p, Math.min(qty, maxQty));
    if (goToBag) router.push("/shop/cart");
    else toast.success(`${qty} × ${p.name} added to your bag`, { action: { label: "View bag", onClick: () => router.push("/shop/cart") } });
  };

  return (
    <div className="flex flex-col gap-20 pt-8">
      <div className="flex flex-col gap-6">
      <nav className="text-[12px] text-fg-3" aria-label="Breadcrumb">
        <Link href="/shop" className="hover:text-fg">Home</Link> /{" "}
        <Link href={`/shop/products?category=${encodeURIComponent(p.category)}`} className="hover:text-fg">{p.category}</Link> / <span className="text-fg-2">{p.name}</span>
      </nav>

      <section className="grid gap-10 md:grid-cols-2">
        <ProductArt product={p} large />
        <div className="flex flex-col gap-5 md:pt-6">
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-fg-3">{p.category}</span>
            <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.04em]">{p.name}</h1>
            {p.reviewCount > 0 && (
              <a href="#reviews" className="flex w-fit items-center gap-2 text-[13px] text-fg-2 hover:text-fg">
                <Stars rating={p.rating} size="md" />
                <span className="tabular">{p.rating.toFixed(1)} · {p.reviewCount} reviews</span>
              </a>
            )}
          </div>
          <div className="text-[26px] font-semibold tabular">{usd(p.price, { compact: false })}</div>
          <p className="text-[15px] leading-relaxed text-fg-2">{data.description}</p>

          <div className="flex flex-col gap-3 border-t border-border pt-5">
            {stock && <p className={cn("text-[13px] font-medium", stock.tone)}>{soldOut ? "Sold out — check back soon." : `${stock.text} in stock`}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <QtyStepper value={Math.min(qty, maxQty)} onChange={setQty} max={maxQty} label="Quantity" />
              <button type="button" disabled={soldOut} onClick={() => addToBag(false)} className="h-10 flex-1 rounded-lg border border-fg bg-surface px-5 text-[14px] font-medium hover:bg-surface-3 disabled:opacity-40 sm:flex-none">
                Add to bag
              </button>
              <button type="button" disabled={soldOut} onClick={() => addToBag(true)} className="h-10 flex-1 rounded-lg bg-fg px-5 text-[14px] font-medium text-bg hover:opacity-90 disabled:opacity-40 sm:flex-none">
                Buy now
              </button>
            </div>
          </div>

          <ul className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-4 text-[13px] text-fg-2">
            <li className="flex items-center gap-2.5">
              <Truck className="size-4 text-fg-3" aria-hidden />
              {p.price >= data.freeShipping ? "Ships free" : `Free shipping on orders over ${usd(data.freeShipping, { compact: false })}`} · arrives in about 5 days
            </li>
            <li className="flex items-center gap-2.5">
              <RotateCcw className="size-4 text-fg-3" aria-hidden />
              Easy returns
            </li>
          </ul>
          <p className="text-[12px] text-fg-3">SKU {p.sku}</p>
        </div>
      </section>
      </div>

      <section id="reviews" aria-labelledby="reviews-h" className="grid scroll-mt-28 gap-10 md:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-4">
          <h2 id="reviews-h" className="text-[22px] font-semibold tracking-[-0.03em]">Customer reviews</h2>
          {total > 0 ? (
            <>
              <div className="flex items-center gap-3">
                <span className="text-[40px] font-semibold tabular leading-none">{p.rating.toFixed(1)}</span>
                <div className="flex flex-col gap-1 text-[12px] text-fg-3">
                  <Stars rating={p.rating} size="md" />
                  {total} reviews
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {[5, 4, 3, 2, 1].map((s) => {
                  const n = data.distribution[s - 1];
                  return (
                    <div key={s} className="flex items-center gap-2 text-[12px] text-fg-2">
                      <span className="w-10 tabular">{s} star</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <div className="h-full rounded-full bg-[#d99a1e]" style={{ width: `${(n / total) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right tabular text-fg-3">{n}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-[13px] text-fg-3">No reviews yet.</p>
          )}
        </div>
        <div className="flex flex-col divide-y divide-border">
          {data.reviews.map((r) => (
            <article key={r.id} className="flex flex-col gap-2 py-5 first:pt-0">
              <div className="flex items-center gap-2">
                <Stars rating={r.rating} />
                <span className="text-[14px] font-medium">{r.title}</span>
              </div>
              <p className="text-[14px] leading-relaxed text-fg-2">{r.body}</p>
              <div className="text-[12px] text-fg-3">
                {r.author}
                {r.verified && " · Verified buyer"} · {shortDate(r.createdAt, true)}
              </div>
              {r.response && (
                <div className="mt-1 rounded-lg border-l-2 border-accent bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
                  <span className="font-medium text-fg">Response from Loomline: </span>
                  {r.response}
                </div>
              )}
            </article>
          ))}
          {data.reviews.length > 0 && data.reviews.length < total && <p className="pt-4 text-[12px] text-fg-3">Showing the {data.reviews.length} most recent reviews.</p>}
        </div>
      </section>

      {data.related.length > 0 && (
        <section className="flex flex-col gap-6">
          <h2 className="text-[22px] font-semibold tracking-[-0.03em]">More in {p.category}</h2>
          <ProductGrid products={data.related} />
        </section>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { ArrowRight, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { ErrorState } from "@/components/states/states";
import { ProductArt, ProductGrid, ProductGridSkeleton } from "@/components/shop/shop-ui";
import { num } from "@/lib/format";
import { useShopHome } from "@/lib/shop";

export default function ShopHomePage() {
  const { data, isLoading, error, refetch } = useShopHome();
  if (error) return <ErrorState error={error} onRetry={() => refetch()} className="my-24" />;

  const hero = data?.bestSellers[0];
  return (
    <div className="flex flex-col gap-20 pt-10">
      {/* Hero */}
      <section className="grid items-center gap-8 md:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-5">
          <span className="text-[12px] font-semibold uppercase tracking-[0.16em] text-accent-text">The everyday edit</span>
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.04em] sm:text-[56px]">Clothes you&apos;ll reach for every day.</h1>
          <p className="max-w-md text-[16px] leading-relaxed text-fg-2">
            Linen shirts, soft tees, easy dresses and denim, chosen by{" "}
            {data ? `${num(data.customerCount)} customers and rated in ${num(data.reviewCount)} reviews` : "thousands of customers"}.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/shop/products" className="inline-flex h-11 items-center gap-2 rounded-lg bg-fg px-5 text-[14px] font-medium text-bg hover:opacity-90">
              Shop all <ArrowRight className="size-4" />
            </Link>
            <Link href="/shop/products?sort=new" className="inline-flex h-11 items-center rounded-lg border border-border bg-surface px-5 text-[14px] font-medium hover:border-border-strong">
              New arrivals
            </Link>
          </div>
        </div>
        {hero ? (
          <Link href={`/shop/products/${hero.id}`} className="group relative block">
            <ProductArt product={hero} large className="aspect-[5/4] md:aspect-[4/5]" />
            <div className="absolute bottom-4 right-4 rounded-xl bg-surface/95 px-4 py-3 shadow-card backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-3">Best seller</div>
              <div className="text-[14px] font-medium group-hover:underline">{hero.name}</div>
            </div>
          </Link>
        ) : (
          <div className="aspect-[4/5] animate-pulse rounded-xl bg-surface-3" />
        )}
      </section>

      {/* Promises */}
      <section className="grid gap-4 rounded-2xl border border-border bg-surface p-6 sm:grid-cols-3">
        {[
          { icon: Truck, title: "Free shipping over $35", text: "Otherwise a flat $4.99." },
          { icon: RotateCcw, title: "Easy returns", text: "Changed your mind? Send it back." },
          { icon: ShieldCheck, title: "Rated by real buyers", text: "Every review comes from a customer order." },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex items-start gap-3">
            <Icon className="mt-0.5 size-5 shrink-0 text-accent-text" aria-hidden />
            <div>
              <div className="text-[14px] font-medium">{title}</div>
              <div className="text-[13px] text-fg-3">{text}</div>
            </div>
          </div>
        ))}
      </section>

      {/* Categories */}
      <section aria-labelledby="cat-h" className="flex flex-col gap-5">
        <h2 id="cat-h" className="text-[24px] font-semibold tracking-[-0.03em]">Shop by category</h2>
        <div className="flex flex-wrap gap-2">
          {(data?.categories ?? []).map((c) => (
            <Link
              key={c.name}
              href={`/shop/products?category=${encodeURIComponent(c.name)}`}
              className="rounded-full border border-border bg-surface px-4 py-2 text-[13px] font-medium hover:border-fg"
            >
              {c.name} <span className="ml-1 text-fg-3 tabular">{c.count}</span>
            </Link>
          ))}
        </div>
      </section>

      <Section title="Best sellers" subtitle="What customers bought most in the last 30 days" href="/shop/products">
        {isLoading || !data ? <ProductGridSkeleton /> : <ProductGrid products={data.bestSellers} />}
      </Section>

      <div className="grid gap-16 lg:grid-cols-2">
        <Section title="Top rated" subtitle="Highest average rating, with at least 5 reviews" href="/shop/products?sort=rating">
          {data && <ProductGrid products={data.topRated} className="lg:grid-cols-2" />}
        </Section>
        <Section title="New arrivals" subtitle="Just added to the collection" href="/shop/products?sort=new">
          {data && <ProductGrid products={data.newArrivals} className="lg:grid-cols-2" />}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, subtitle, href, children }: { title: string; subtitle: string; href: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[24px] font-semibold tracking-[-0.03em]">{title}</h2>
          <p className="text-[13px] text-fg-3">{subtitle}</p>
        </div>
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-fg-2 hover:text-fg">
          View all <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {children}
    </section>
  );
}

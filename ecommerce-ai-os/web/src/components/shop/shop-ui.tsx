"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Dumbbell,
  Footprints,
  Gem,
  Headphones,
  Minus,
  Package,
  Plus,
  Scissors,
  Search,
  Shirt,
  ShoppingBag,
  Sparkles,
  Star,
  Watch,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { usd } from "@/lib/format";
import { MAX_QTY, cartTotals, useCart, type ShopProduct } from "@/lib/shop";

// ---------------------------------------------------------------- product art

const ICONS: [RegExp, LucideIcon][] = [
  [/foot|shoe|sneaker|sandal|loafer/i, Footprints],
  [/active|sport|fitness/i, Dumbbell],
  [/denim|jean/i, Scissors],
  [/accessor|bag|tote|wallet|belt/i, ShoppingBag],
  [/shirt|tee|dress|ethnic|kurta|top/i, Shirt],
  [/audio|speaker|headphone/i, Headphones],
  [/wear|watch/i, Watch],
  [/skin|hair|makeup|fragrance|beauty|bath|sun/i, Sparkles],
  [/gift|jewel/i, Gem],
];

// Muted swatches: readable in light and dark themes, never a status colour.
const SWATCHES = [
  ["#efe7dc", "#8a6a4a"],
  ["#e3e9e4", "#4f6f5c"],
  ["#e5e6ef", "#545a8a"],
  ["#f0e3e3", "#8a5252"],
  ["#e6ecef", "#4d6b7c"],
  ["#ece8e0", "#6d6450"],
  ["#eae3ec", "#73547c"],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Generated product imagery: the demo catalog has no photos. */
export function ProductArt({ product, className, large }: { product: Pick<ShopProduct, "id" | "name" | "category">; className?: string; large?: boolean }) {
  const Icon = ICONS.find(([re]) => re.test(product.category) || re.test(product.name))?.[1] ?? Package;
  const [bg, fg] = SWATCHES[hash(product.id) % SWATCHES.length];
  const word = product.name.split(" ")[0];
  return (
    <div className={cn("relative grid aspect-[4/5] place-items-center overflow-hidden rounded-xl", className)} style={{ background: bg, color: fg }} aria-hidden>
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{ backgroundImage: `repeating-linear-gradient(135deg, ${fg} 0 1px, transparent 1px 14px)` }}
      />
      <Icon className={cn("relative", large ? "size-28" : "size-14")} strokeWidth={1.25} />
      <span className={cn("absolute bottom-3 left-3 font-semibold uppercase tracking-[0.18em] opacity-60", large ? "text-[13px]" : "text-[10px]")}>{word}</span>
    </div>
  );
}

// ---------------------------------------------------------------- rating

export function Stars({ rating, size = "sm", className }: { rating: number; size?: "sm" | "md"; className?: string }) {
  const s = size === "md" ? "size-4" : "size-3.5";
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, rating - i));
        return (
          <span key={i} className={cn("relative inline-block", s)}>
            <Star className={cn("absolute inset-0 text-border-strong", s)} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className={cn("fill-[#d99a1e] text-[#d99a1e]", s)} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------- product card

export function stockLabel(p: Pick<ShopProduct, "available">) {
  if (p.available <= 0) return { text: "Sold out", tone: "text-fg-3" };
  if (p.available <= 10) return { text: `Only ${p.available} left`, tone: "text-warn-text" };
  return null;
}

export function ProductCard({ product }: { product: ShopProduct }) {
  const add = useCart((s) => s.add);
  const stock = stockLabel(product);
  const soldOut = product.available <= 0;
  return (
    <div className="group flex flex-col gap-3">
      <Link href={`/shop/products/${product.id}`} className="relative block rounded-xl focus-visible:outline-2 focus-visible:outline-accent">
        <ProductArt product={product} className="transition-transform duration-300 group-hover:scale-[1.015]" />
        <div className="absolute left-2.5 top-2.5 flex gap-1.5">
          {product.isNew && <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-fg shadow-xs">New</span>}
          {soldOut && <span className="rounded-full bg-fg px-2 py-0.5 text-[11px] font-semibold text-bg">Sold out</span>}
        </div>
      </Link>
      <div className="flex flex-col gap-1">
        <div className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-fg-3">{product.category}</div>
        <Link href={`/shop/products/${product.id}`} className="text-[14px] font-medium leading-snug text-fg hover:underline underline-offset-4">
          {product.name}
        </Link>
        {product.reviewCount > 0 && (
          <div className="flex items-center gap-1.5 text-[12px] text-fg-3">
            <Stars rating={product.rating} />
            <span className="tabular">({product.reviewCount})</span>
          </div>
        )}
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="text-[15px] font-semibold tabular text-fg">{usd(product.price, { compact: false })}</span>
          {stock && <span className={cn("text-[12px] font-medium", stock.tone)}>{stock.text}</span>}
        </div>
      </div>
      <button
        type="button"
        disabled={soldOut}
        onClick={() => {
          add(product);
          toast.success(`${product.name} added to your bag`);
        }}
        className="h-9 rounded-lg border border-border bg-surface text-[13px] font-medium text-fg transition-colors hover:border-fg hover:bg-fg hover:text-bg disabled:pointer-events-none disabled:opacity-50"
      >
        {soldOut ? "Sold out" : "Add to bag"}
      </button>
    </div>
  );
}

export function ProductGrid({ products, className }: { products: ShopProduct[]; className?: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4", className)}>
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="aspect-[4/5] animate-pulse rounded-xl bg-surface-3" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-surface-3" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-surface-3" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- quantity

export function QtyStepper({ value, onChange, max = MAX_QTY, label }: { value: number; onChange: (v: number) => void; max?: number; label: string }) {
  return (
    <div className="inline-flex h-10 items-center rounded-lg border border-border bg-surface" role="group" aria-label={label}>
      <button type="button" className="grid size-10 place-items-center text-fg-2 hover:text-fg disabled:opacity-40" onClick={() => onChange(value - 1)} disabled={value <= 1} aria-label="Decrease quantity">
        <Minus className="size-4" />
      </button>
      <span className="w-8 text-center text-[14px] font-medium tabular" aria-live="polite">
        {value}
      </span>
      <button type="button" className="grid size-10 place-items-center text-fg-2 hover:text-fg disabled:opacity-40" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="Increase quantity">
        <Plus className="size-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- header / footer

function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}

export function ShopHeader({ storeName = "Loomline", categories = [] }: { storeName?: string; categories?: string[] }) {
  const router = useRouter();
  const lines = useCart((s) => s.lines);
  const hydrated = useHydrated();
  const count = hydrated ? cartTotals(lines).count : 0;
  const [q, setQ] = useState("");
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
      <div className="bg-fg px-4 py-2 text-center text-[12px] font-medium text-bg">Free shipping on orders over $35</div>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Link href="/shop" className="text-[22px] font-semibold tracking-[-0.04em] text-fg">
          {storeName.toLowerCase()}
        </Link>
        <nav className="hidden items-center gap-5 text-[13px] text-fg-2 md:flex" aria-label="Categories">
          <Link href="/shop/products" className="hover:text-fg">
            Shop all
          </Link>
          {categories.slice(0, 5).map((c) => (
            <Link key={c} href={`/shop/products?category=${encodeURIComponent(c)}`} className="hover:text-fg">
              {c}
            </Link>
          ))}
        </nav>
        <form
          className="ml-auto hidden items-center gap-2 rounded-lg border border-border bg-surface px-2.5 sm:flex"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/shop/products${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
          }}
        >
          <Search className="size-4 text-fg-3" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" className="h-9 w-44 bg-transparent text-[13px] outline-none placeholder:text-fg-3" />
        </form>
        <Link href="/shop/cart" className="relative ml-auto inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-fg hover:bg-surface-3 sm:ml-0" aria-label={`Shopping bag, ${count} items`}>
          <ShoppingBag className="size-5" />
          <span className="hidden sm:inline">Bag</span>
          {count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold tabular text-white dark:text-[#0b0b10]">{count}</span>}
        </Link>
      </div>
    </header>
  );
}

export function ShopFooter({ storeName = "Loomline" }: { storeName?: string }) {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 text-[13px] text-fg-2 sm:grid-cols-3">
        <div>
          <div className="text-[18px] font-semibold tracking-[-0.03em] text-fg">{storeName.toLowerCase()}</div>
          <p className="mt-2 max-w-xs text-fg-3">Everyday clothing and accessories, made in small batches.</p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-medium text-fg">Shop</span>
          <Link href="/shop/products" className="hover:text-fg">Shop all</Link>
          <Link href="/shop/products?sort=new" className="hover:text-fg">New arrivals</Link>
          <Link href="/shop/products?sort=rating" className="hover:text-fg">Top rated</Link>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-medium text-fg">Good to know</span>
          <span>Free shipping over $35</span>
          <span>This is a demo store: no payment is taken and nothing ships.</span>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------- summary

export function OrderSummary({ subtotal, shipping, total, free, children }: { subtotal: number; shipping: number; total: number; free: number; children?: React.ReactNode }) {
  const toFree = free - subtotal;
  return (
    <aside className="flex h-fit flex-col gap-3 rounded-2xl border border-border bg-surface p-5 lg:sticky lg:top-32" aria-label="Order summary">
      <h2 className="text-[16px] font-semibold">Order summary</h2>
      <dl className="flex flex-col gap-2 text-[14px]">
        <div className="flex justify-between"><dt className="text-fg-2">Subtotal</dt><dd className="tabular">{usd(subtotal, { compact: false })}</dd></div>
        <div className="flex justify-between"><dt className="text-fg-2">Shipping</dt><dd className="tabular">{shipping === 0 ? "Free" : usd(shipping, { compact: false })}</dd></div>
        <div className="flex justify-between border-t border-border pt-2 text-[16px] font-semibold"><dt>Total</dt><dd className="tabular">{usd(total, { compact: false })}</dd></div>
      </dl>
      {toFree > 0 && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-fg-2">
          Add {usd(toFree, { compact: false })} more for free shipping.
        </p>
      )}
      {children}
    </aside>
  );
}

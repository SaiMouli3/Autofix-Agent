"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShoppingBag, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/states/states";
import { OrderSummary, ProductArt, QtyStepper } from "@/components/shop/shop-ui";
import { usd } from "@/lib/format";
import { cartTotals, useCart, useShopHome } from "@/lib/shop";

export default function CartPage() {
  const { lines, setQty, remove } = useCart();
  const home = useShopHome();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const free = home.data?.freeShipping ?? 35;
  const t = cartTotals(lines, free, home.data?.shippingFee);

  if (!hydrated) return <div className="min-h-[50vh]" />;
  if (lines.length === 0) {
    return (
      <EmptyState
        className="my-24"
        icon={ShoppingBag}
        title="Your bag is empty"
        description="Find something you'll wear every day."
        action={<Link href="/shop/products" className="inline-flex h-10 items-center rounded-lg bg-fg px-5 text-[14px] font-medium text-bg">Start shopping</Link>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8 pt-10">
      <h1 className="text-[32px] font-semibold tracking-[-0.04em]">Your bag</h1>
      <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {lines.map((l) => (
            <li key={l.id} className="flex gap-4 py-5">
              <Link href={`/shop/products/${l.id}`} className="w-24 shrink-0 sm:w-28">
                <ProductArt product={l} />
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-fg-3">{l.category}</div>
                    <Link href={`/shop/products/${l.id}`} className="text-[15px] font-medium hover:underline underline-offset-4">{l.name}</Link>
                  </div>
                  <span className="shrink-0 text-[15px] font-semibold tabular">{usd(l.price * l.qty, { compact: false })}</span>
                </div>
                <div className="text-[13px] text-fg-3 tabular">{usd(l.price, { compact: false })} each</div>
                <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                  <QtyStepper value={l.qty} onChange={(v) => setQty(l.id, v)} label={`Quantity of ${l.name}`} />
                  <button type="button" onClick={() => remove(l.id)} className="inline-flex items-center gap-1.5 text-[13px] text-fg-3 hover:text-crit-text">
                    <Trash2 className="size-4" /> Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <OrderSummary subtotal={t.subtotal} shipping={t.shipping} total={t.total} free={free}>
          <Link href="/shop/checkout" className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-lg bg-fg text-[14px] font-medium text-bg hover:opacity-90">
            Checkout
          </Link>
          <Link href="/shop/products" className="text-center text-[13px] text-fg-2 hover:text-fg">Continue shopping</Link>
        </OrderSummary>
      </div>
    </div>
  );
}

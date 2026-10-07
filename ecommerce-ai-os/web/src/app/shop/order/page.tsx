"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";
import { EmptyState } from "@/components/states/states";
import { shortDate, usd } from "@/lib/format";
import { lastOrder, type PlacedOrder } from "@/lib/shop";

export default function OrderConfirmationPage() {
  const [order, setOrder] = useState<PlacedOrder | null | undefined>(undefined);
  useEffect(() => setOrder(lastOrder.load()), []);

  if (order === undefined) return <div className="min-h-[50vh]" />;
  if (!order) {
    return <EmptyState className="my-24" title="No recent order" description="Orders you place will be confirmed here." action={<Link href="/shop" className="text-[13px] font-medium underline">Back to the shop</Link>} />;
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 pt-14">
      <div className="flex flex-col items-center gap-3 text-center">
        <CircleCheck className="size-12 text-good" aria-hidden />
        <h1 className="text-[30px] font-semibold tracking-[-0.04em]">Thank you — your order is in</h1>
        <p className="text-[14px] text-fg-2">
          Order <span className="font-semibold text-fg">{order.number}</span> · confirmation for {order.email}
        </p>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-5">
        <ul className="flex flex-col gap-2 text-[14px]">
          {order.items.map((it) => (
            <li key={it.productId} className="flex justify-between gap-3">
              <span className="text-fg-2">{it.qty} × {it.name}</span>
              <span className="tabular">{usd(it.unitPrice * it.qty, { compact: false })}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 flex flex-col gap-1.5 border-t border-border pt-4 text-[14px]">
          <div className="flex justify-between"><dt className="text-fg-2">Subtotal</dt><dd className="tabular">{usd(order.subtotal, { compact: false })}</dd></div>
          <div className="flex justify-between"><dt className="text-fg-2">Shipping</dt><dd className="tabular">{order.shippingFee ? usd(order.shippingFee, { compact: false }) : "Free"}</dd></div>
          <div className="flex justify-between text-[16px] font-semibold"><dt>Total</dt><dd className="tabular">{usd(order.total, { compact: false })}</dd></div>
        </dl>
        <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">
          {order.payment === "cod" ? "Pay on delivery" : "Paid by card"} · estimated delivery by {shortDate(order.estimatedDelivery, true)}
        </p>
      </div>
      <p className="text-center text-[12px] text-fg-3">This is a demo store: no payment was taken and nothing will ship.</p>
      <Link href="/shop/products" className="mx-auto inline-flex h-11 items-center rounded-lg bg-fg px-6 text-[14px] font-medium text-bg hover:opacity-90">
        Continue shopping
      </Link>
    </div>
  );
}

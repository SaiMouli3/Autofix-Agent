"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { usd, pct, relativeTime, shortDate } from "@/lib/format";
import type { Row } from "@/lib/types";
import { DataTable } from "@/components/data-table/data-table";
import { HealthPill, OrderStatus, RiskBadge, SegmentBadge, SentimentBadge, Stars, money } from "@/components/data-table/cells";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChangePill } from "@/components/agents/primitives";
import { InventoryRisk } from "./inventory-view";
import { ResponseComposer } from "./reviews-view";

type P = { params: Record<string, string> };

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function OrdersTable({ params }: P) {
  return (
    <DataTable
      endpoint="orders"
      initialParams={params}
      defaultSort="createdAt"
      searchPlaceholder="Search order #, customer, product, city…"
      dateFilter
      filters={[
        { key: "status", label: "Status", format: (v) => ({ in_transit: "In transit", ndr: "NDR", rto: "RTO" } as Record<string, string>)[v] ?? titleCase(v) },
        { key: "courier", label: "Courier" },
        { key: "region", label: "Region" },
        { key: "payment", label: "Payment", format: (v) => (v === "cod" ? "COD" : "Prepaid") },
        { key: "risk", label: "Risk", format: titleCase },
      ]}
      columns={[
        { key: "number", label: "Order ID", render: (r) => <span className="font-medium">{r.number}</span> },
        { key: "customer", label: "Customer", render: (r) => <div><div>{r.customer}</div><div className="text-[11px] text-fg-3">{r.city}</div></div> },
        { key: "product", label: "Product", render: (r) => <span className="block max-w-[220px] truncate">{r.product}</span>, sortable: false },
        { key: "amount", label: "Amount", align: "right", render: (r) => money(r.amount) },
        { key: "status", label: "Status", render: (r) => <OrderStatus status={r.status} /> },
        { key: "payment", label: "Payment", render: (r) => (r.payment === "cod" ? "COD" : "Prepaid"), hidden: true },
        { key: "courier", label: "Courier" },
        { key: "region", label: "Region", hidden: true },
        { key: "createdAt", label: "Placed", render: (r) => shortDate(r.createdAt) },
        { key: "expectedDelivery", label: "Expected delivery", render: (r) => (r.expectedDelivery ? shortDate(r.expectedDelivery) : "—") },
        { key: "risk", label: "Risk", render: (r) => (r.risk === "none" ? <span className="text-fg-3">—</span> : <RiskBadge risk={r.risk} />) },
      ]}
      expand={(r) => (
        <div className="grid gap-4 rounded-lg border border-border bg-surface p-4 text-[12.5px] md:grid-cols-3">
          <div>
            <div className="eyebrow mb-1.5">Items</div>
            {(r.items as Row[]).map((it) => <div key={it.productId} className="flex justify-between gap-3"><span className="truncate">{it.qty}× {it.name}</span><span className="tabular">{usd(it.price, { compact: false })}</span></div>)}
            <div className="mt-2 flex justify-between border-t border-border pt-2 text-fg-3"><span>Discount</span><span className="tabular">−{usd(r.discount, { compact: false })}</span></div>
            <div className="flex justify-between text-fg-3"><span>Shipping</span><span className="tabular">{usd(r.shippingFee, { compact: false })}</span></div>
          </div>
          <div>
            <div className="eyebrow mb-1.5">Fulfilment</div>
            <div className="space-y-1 text-fg-2">
              <div>Shipped: <span className="text-fg">{r.shippedAt ? shortDate(r.shippedAt) : "Not yet"}</span></div>
              <div>Promised: <span className="text-fg">{r.expectedDelivery ? shortDate(r.expectedDelivery) : "—"}</span></div>
              <div>Delivered: <span className="text-fg">{r.deliveredAt ? shortDate(r.deliveredAt) : "—"}</span></div>
              <div>Failed attempts: <span className="text-fg">{r.ndrAttempts ?? 0}</span></div>
              <div>Channel: <span className="text-fg capitalize">{r.channel}</span></div>
            </div>
          </div>
          <div>
            <div className="eyebrow mb-1.5">Returns</div>
            {(r.returns as Row[] | null)?.length ? (r.returns as Row[]).map((x) => (
              <div key={x.id} className="mb-1"><Badge tone="warn">{x.status}</Badge> <span className="text-fg-2">{x.reason}</span></div>
            )) : <span className="text-fg-3">No returns</span>}
          </div>
        </div>
      )}
    />
  );
}

export function CustomersTable({ params }: P) {
  const router = useRouter();
  return (
    <DataTable
      endpoint="customers"
      initialParams={params}
      defaultSort="ltv"
      searchPlaceholder="Search name, email, city…"
      filters={[
        { key: "segment", label: "Segment", options: ["VIP", "Loyal", "Growing", "New", "At Risk", "Churn Risk", "One-time", "repurchase"].map((v) => ({ value: v, label: v === "repurchase" ? "Likely to repurchase" : v })) },
        { key: "region", label: "Region" },
      ]}
      onRowClick={(r) => router.push(`/agents/orders?tab=data&customer=${r.id}`)}
      columns={[
        { key: "name", label: "Customer", render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-[11px] text-fg-3">{r.email}</div></div> },
        { key: "segment", label: "Segment", render: (r) => <SegmentBadge segment={r.segment} /> },
        { key: "city", label: "City", render: (r) => `${r.city}, ${r.state}` },
        { key: "orders", label: "Orders", align: "right" },
        { key: "ltv", label: "Lifetime value", align: "right", render: (r) => money(r.ltv) },
        { key: "aov", label: "AOV", align: "right", render: (r) => usd(r.aov, { compact: false }), hidden: true },
        { key: "lastOrder", label: "Last order", render: (r) => relativeTime(r.lastOrder) },
        { key: "repurchaseScore", label: "Repurchase likelihood", align: "right", render: (r) => (r.repurchaseScore ? <span className={cn("font-medium", r.repurchaseScore >= 0.5 && "text-good-text")}>{Math.round(r.repurchaseScore * 100)}%</span> : <span className="text-fg-3">—</span>) },
        { key: "returns", label: "Returns", align: "right", hidden: true },
        { key: "tickets", label: "Tickets", align: "right", hidden: true },
      ]}
    />
  );
}

export function ProductsTable({ params }: P) {
  const router = useRouter();
  return (
    <DataTable
      endpoint="products"
      initialParams={params}
      defaultSort="revenue"
      searchPlaceholder="Search product or SKU…"
      filters={[{ key: "category", label: "Category" }]}
      onRowClick={(r) => router.push(`/agents/products?product=${r.id}`)}
      columns={[
        { key: "name", label: "Product", render: (r) => <div><div className="max-w-[240px] truncate font-medium">{r.name}</div><div className="text-[11px] text-fg-3">{r.sku} · {r.category}</div></div> },
        { key: "health", label: "Health", align: "right", render: (r) => <HealthPill v={r.health} /> },
        { key: "revenue", label: "Revenue", align: "right", render: (r) => money(r.revenue) },
        { key: "growth", label: "Growth", align: "right", render: (r) => <ChangePill change={r.growth} unit="number" direction="up" /> },
        { key: "units", label: "Units", align: "right" },
        { key: "margin", label: "Margin", align: "right", render: (r) => pct(r.margin) },
        { key: "returnRate", label: "Return rate", align: "right", render: (r) => <span className={cn(r.returnRate > 12 && "font-medium text-crit-text")}>{pct(r.returnRate)}</span> },
        { key: "rating", label: "Rating", align: "right", render: (r) => (r.rating ? `${r.rating.toFixed(2)}★` : "—") },
        { key: "complaints", label: "Complaints", align: "right", hidden: true },
        { key: "stock", label: "Stock", align: "right", hidden: true },
      ]}
    />
  );
}

export function InventoryTable({ params }: P) {
  const router = useRouter();
  return (
    <DataTable
      endpoint="inventory"
      initialParams={params}
      defaultSort="riskRank"
      defaultDir="asc"
      searchPlaceholder="Search product or SKU…"
      filters={[
        { key: "risk", label: "Risk", options: [["stockout", "Out of stock"], ["critical", "Critical"], ["low", "Low stock"], ["healthy", "Healthy"], ["overstock", "Overstock"], ["dead", "Dead stock"]].map(([value, label]) => ({ value, label })) },
        { key: "category", label: "Category" },
      ]}
      onRowClick={(r) => router.push(`/agents/products?product=${r.productId}`)}
      columns={[
        { key: "name", label: "Product", render: (r) => <div><div className="max-w-[240px] truncate font-medium">{r.name}</div><div className="text-[11px] text-fg-3">{r.sku} · {r.warehouse}</div></div> },
        { key: "available", label: "Stock", align: "right" },
        { key: "dailySales", label: "Daily sales", align: "right", render: (r) => r.dailySales.toFixed(1) },
        { key: "daysLeft", label: "Days left", align: "right", render: (r) => <span className={cn((r.risk === "critical" || r.risk === "stockout") && "font-semibold text-crit-text")}>{r.daysLeft >= 999 ? "—" : Math.round(r.daysLeft)}</span> },
        { key: "riskRank", label: "Risk", render: (r) => <InventoryRisk risk={r.risk} /> },
        { key: "reorderQty", label: "Suggested reorder", align: "right", render: (r) => (r.reorderQty ? <span className="font-medium">{r.reorderQty} units</span> : <span className="text-fg-3">—</span>) },
        { key: "leadTimeDays", label: "Lead time", align: "right", render: (r) => `${r.leadTimeDays}d` },
        { key: "value", label: "Value (cost)", align: "right", render: (r) => usd(r.value), hidden: true },
        { key: "reserved", label: "Reserved", align: "right", hidden: true },
      ]}
    />
  );
}

export function ReviewsTable({ params }: P) {
  const [composer, setComposer] = useState<Row | null>(null);
  return (
    <>
      <DataTable
        endpoint="reviews"
        initialParams={params}
        defaultSort="createdAt"
        searchPlaceholder="Search reviews, products, customers…"
        dateFilter
        filters={[
          { key: "sentiment", label: "Sentiment", format: titleCase },
          { key: "rating", label: "Rating", format: (v) => `${v}★` },
          { key: "source", label: "Source" },
          { key: "unanswered", label: "Response", options: [{ value: "1", label: "Awaiting response" }] },
        ]}
        columns={[
          { key: "rating", label: "Rating", render: (r) => <Stars rating={r.rating} /> },
          { key: "title", label: "Review", sortable: false, render: (r) => <div className="max-w-[360px] whitespace-normal"><div className="font-medium">{r.title}</div><div className="line-clamp-2 text-[12px] text-fg-2">{r.body}</div></div> },
          { key: "product", label: "Product", render: (r) => <span className="block max-w-[180px] truncate">{r.product}</span> },
          { key: "sentiment", label: "Sentiment", render: (r) => <SentimentBadge s={r.sentiment} /> },
          { key: "theme", label: "Themes", sortable: false },
          { key: "customer", label: "Customer", hidden: true },
          { key: "source", label: "Source" },
          { key: "createdAt", label: "Date", render: (r) => shortDate(r.createdAt) },
          { key: "answered", label: "", sortable: false, render: (r) => r.answered ? <Badge tone="good">Responded</Badge> : (
            <Button size="xs" variant={r.sentiment === "negative" ? "primary" : "secondary"} onClick={(e) => { e.stopPropagation(); setComposer(r); }}>
              <Sparkles className={r.sentiment === "negative" ? "" : "!text-accent"} /> Generate response
            </Button>
          ) },
        ]}
      />
      <ResponseComposer review={composer} open={!!composer} onOpenChange={(o) => !o && setComposer(null)} />
    </>
  );
}

export function TicketsTable({ params }: P) {
  return (
    <DataTable
      endpoint="complaints"
      initialParams={params}
      defaultSort="createdAt"
      searchPlaceholder="Search subject, customer, order…"
      dateFilter
      filters={[
        { key: "status", label: "Status", options: [["open", "Open (unresolved)"], ["pending", "Pending"], ["resolved", "Resolved"]].map(([value, label]) => ({ value, label })) },
        { key: "category", label: "Category" },
        { key: "channel", label: "Channel" },
        { key: "complaint", label: "Type", options: [{ value: "1", label: "Complaints only" }] },
      ]}
      columns={[
        { key: "id", label: "Ticket", render: (r) => <span className="font-medium">{r.id}</span> },
        { key: "subject", label: "Subject", render: (r) => <div className="max-w-[300px]"><div className="truncate font-medium">{r.subject}</div><div className="truncate text-[11.5px] text-fg-3">{r.customer}{r.product ? ` · ${r.product}` : ""}</div></div> },
        { key: "category", label: "Category" },
        { key: "channel", label: "Channel" },
        { key: "priority", label: "Priority", render: (r) => <Badge tone={r.priority === "high" ? "crit" : r.priority === "low" ? "outline" : "neutral"}>{titleCase(r.priority)}</Badge> },
        { key: "status", label: "Status", render: (r) => <Badge tone={r.status === "resolved" ? "good" : r.status === "open" ? "crit" : "warn"} dot>{titleCase(r.status)}</Badge> },
        { key: "firstResponseHours", label: "First response", align: "right", render: (r) => (r.firstResponseHours ? `${r.firstResponseHours < 1 ? `${Math.round(r.firstResponseHours * 60)}m` : `${r.firstResponseHours.toFixed(1)}h`}` : "—") },
        { key: "slaBreached", label: "SLA", render: (r) => (r.slaBreached ? <Badge tone="crit">Breached</Badge> : <Badge tone="good">Met</Badge>) },
        { key: "createdAt", label: "Created", render: (r) => relativeTime(r.createdAt) },
        { key: "escalated", label: "Escalated", hidden: true, render: (r) => (r.escalated ? "Yes" : "No") },
      ]}
      expand={(r) => (
        <div className="rounded-lg border border-border bg-surface p-4 text-[13px] leading-relaxed">
          <p>{r.message}</p>
          <p className="mt-2 text-[12px] text-fg-3">Order {r.orderNumber || "—"} · {r.channel} · resolution {r.resolutionHours ? `${r.resolutionHours}h` : "pending"}{r.cluster ? ` · cluster: ${r.cluster}` : ""}</p>
        </div>
      )}
    />
  );
}

export function CampaignsTable() {
  return null;
}

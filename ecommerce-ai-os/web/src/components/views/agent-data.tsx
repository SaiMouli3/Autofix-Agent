"use client";

import { usd, pct, shortDate } from "@/lib/format";
import type { Row, View } from "@/lib/types";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CustomersTable, InventoryTable, OrdersTable, ProductsTable, ReviewsTable, TicketsTable } from "./tables";

function StaticTable({ title, description, cols, rows }: { title: string; description?: string; cols: { label: string; render: (r: Row) => React.ReactNode; right?: boolean }[]; rows: Row[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} description={description} />
      <div className="scrollbar-thin mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-[12.5px]">
          <thead className="bg-surface-2 text-left text-[11.5px] text-fg-3">
            <tr>{cols.map((c) => <th key={c.label} className={`px-5 py-2.5 font-medium ${c.right ? "text-right" : ""}`}>{c.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-surface-2">{cols.map((c) => <td key={c.label} className={`whitespace-nowrap px-5 py-2.5 tabular ${c.right ? "text-right" : ""}`}>{c.render(r)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** The "Data" tab: the underlying records each agent analyses. */
export function AgentData({ id, view, params }: { id: string; view: View; params: Record<string, string> }) {
  switch (id) {
    case "orders":
      return <OrdersTable params={params} />;
    case "customers":
      return <CustomersTable params={params} />;
    case "products":
      return <ProductsTable params={params} />;
    case "inventory":
      return <InventoryTable params={params} />;
    case "reviews":
      return <ReviewsTable params={params} />;
    case "support":
      return <TicketsTable params={params} />;
    case "pricing": {
      const rows = (view.products as Row[]).flatMap((p) => (p.competitors as Row[]).map((c) => ({ ...c, product: p.name, ourPrice: p.ourPrice })));
      return (
        <StaticTable title="Competitor listings" description="Latest captured price for every matched competitor product" rows={rows} cols={[
          { label: "Your product", render: (r) => <span className="font-medium">{r.product}</span> },
          { label: "Competitor", render: (r) => r.competitor },
          { label: "Listing", render: (r) => <span className="block max-w-[220px] truncate text-fg-2">{r.title}</span> },
          { label: "Their price", right: true, render: (r) => usd(r.price, { compact: false }) },
          { label: "Your price", right: true, render: (r) => usd(r.ourPrice, { compact: false }) },
          { label: "Discount", right: true, render: (r) => (r.discount > 0 ? pct(r.discount) : "—") },
          { label: "7d change", right: true, render: (r) => (r.change7d ? `${r.change7d > 0 ? "+" : ""}${r.change7d}%` : "—") },
          { label: "Rating", right: true, render: (r) => `${r.rating.toFixed(1)}★` },
          { label: "Stock", render: (r) => (r.inStock ? <Badge tone="good">In stock</Badge> : <Badge tone="neutral">Out</Badge>) },
        ]} />
      );
    }
    case "marketing":
      return (
        <StaticTable title="Campaign data" description="Spend and delivery metrics from ad platforms; revenue from attributed orders" rows={view.campaigns} cols={[
          { label: "Campaign", render: (r) => <span className="font-medium">{r.channelLabel} · {r.name}</span> },
          { label: "Status", render: (r) => <Badge tone="good">{r.status}</Badge> },
          { label: "Impressions", right: true, render: (r) => Number(r.impressions).toLocaleString("en-US") },
          { label: "Clicks", right: true, render: (r) => Number(r.clicks).toLocaleString("en-US") },
          { label: "Spend", right: true, render: (r) => usd(r.spend, { compact: false }) },
          { label: "Orders", right: true, render: (r) => r.orders },
          { label: "Revenue", right: true, render: (r) => usd(r.revenue, { compact: false }) },
          { label: "ROAS", right: true, render: (r) => `${r.roas.toFixed(2)}x` },
        ]} />
      );
    case "finance": {
      const p = view.pnl as Record<string, number>;
      const pp = view.prevPnl as Record<string, number>;
      const lines: [string, string, boolean?][] = [
        ["Gross sales", "grossSales"], ["Refunds", "refunds", true], ["Net revenue", "netRevenue"], ["Cost of goods sold", "cogs", true], ["Gross profit", "grossProfit"],
        ["Marketing", "marketing", true], ["Shipping", "shipping", true], ["Payment fees", "paymentFees", true], ["Overheads", "opex", true], ["Net profit", "netProfit"],
      ];
      return (
        <StaticTable title="Profit & loss statement" description="Deterministic P&L for the selected period vs the previous period" rows={lines.map(([label, key, neg]) => ({ label, cur: p[key], prev: pp[key], neg }))} cols={[
          { label: "Line", render: (r) => <span className={["Net revenue", "Gross profit", "Net profit"].includes(r.label) ? "font-semibold" : "text-fg-2"}>{r.label}</span> },
          { label: "Previous period", right: true, render: (r) => <span className="text-fg-3">{usd(r.neg ? -r.prev : r.prev, { compact: false })}</span> },
          { label: "Current period", right: true, render: (r) => usd(r.neg ? -r.cur : r.cur, { compact: false }) },
          { label: "Change", right: true, render: (r) => (r.prev ? `${(((r.cur - r.prev) / Math.abs(r.prev)) * 100).toFixed(1)}%` : "—") },
        ]} />
      );
    }
    case "market":
      return (
        <StaticTable title="Monitored articles" description="Articles the Market & News agent judged relevant to your business" rows={view.articles} cols={[
          { label: "Published", render: (r) => shortDate(r.publishedAt) },
          { label: "Title", render: (r) => <span className="block max-w-[420px] truncate font-medium">{r.title}</span> },
          { label: "Source", render: (r) => r.source },
          { label: "Category", render: (r) => r.category },
          { label: "Impact", render: (r) => <Badge tone={r.impact === "high" ? "crit" : r.impact === "medium" ? "warn" : "neutral"}>{r.impact}</Badge> },
          { label: "Relevance", right: true, render: (r) => r.relevance },
        ]} />
      );
  }
  return null;
}

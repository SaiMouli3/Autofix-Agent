"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { inr, relativeTime } from "@/lib/format";
import type { Insight, Range, View } from "@/lib/types";
import { BarChart, CohortHeatmap, TrendChart } from "@/components/charts/charts";
import { IndiaTileMap } from "@/components/charts/special";
import { SegmentBadge } from "@/components/data-table/cells";
import { AiCallout, ChartCard, KpiStrip } from "./common";

const SEG_DESC: Record<string, string> = {
  VIP: "Top 5% lifetime value, active", Loyal: "3+ orders, active in 60 days", Growing: "2nd order in last 45 days",
  New: "First order in last 30 days", "At Risk": "Repeat buyers quiet for 60–120 days", "Churn Risk": "Repeat buyers gone 120+ days", "One-time": "Single order, not returned",
};

export function CustomersView({ view, insights, range }: { view: View; insights: Insight[]; range: Range }) {
  const router = useRouter();
  const repurchase = insights.find((i) => i.severity === "opportunity");
  const segments = view.segments as { segment: string; customers: number; revenue: number; share: number; avgOrders: number; avgLtv: number }[];
  const maxC = Math.max(...segments.map((s) => s.customers), 1);
  return (
    <div className="space-y-4">
      <KpiStrip kpis={view.kpis} cols={6} />
      <AiCallout insight={repurchase} />
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Customer growth" question="Is growth coming from new or returning customers?" className="lg:col-span-7">
          <TrendChart data={view.growth} granularity={range.granularity} height={260} stacked
            series={[
              { key: "returning", label: "Returning", color: "var(--series-1)", type: "bar" },
              { key: "new", label: "New", color: "var(--series-3)", type: "bar" },
            ]} />
        </ChartCard>
        <ChartCard title="Customer segments" question="Who are your customers, and where does revenue come from?" className="lg:col-span-5">
          <ul className="space-y-1">
            {segments.map((s) => (
              <li key={s.segment}>
                <button onClick={() => router.push(`/agents/customers?tab=data&segment=${encodeURIComponent(s.segment)}`)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-surface-3">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span className="w-[88px] shrink-0"><SegmentBadge segment={s.segment} /></span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div className={cn("h-full rounded-full", s.segment === "At Risk" || s.segment === "Churn Risk" ? "bg-warn" : "bg-[var(--series-1)]")} style={{ width: `${(s.customers / maxC) * 100}%` }} />
                    </div>
                    <span className="w-14 text-right font-medium tabular">{s.customers.toLocaleString("en-IN")}</span>
                    <span className="w-12 text-right tabular text-fg-3">{s.share}%</span>
                  </div>
                  <div className="mt-0.5 pl-[96px] text-[11px] text-fg-3">{SEG_DESC[s.segment]} · avg LTV {inr(s.avgLtv)}</div>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 px-2 text-[11px] text-fg-3">Right column: share of lifetime revenue.</p>
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Cohort retention" question="What share of each monthly cohort comes back to buy again?" className="lg:col-span-7">
          <CohortHeatmap rows={view.cohorts} />
        </ChartCard>
        <ChartCard title="Lifetime value distribution" question="How is customer value spread?" className="lg:col-span-5">
          <BarChart data={view.ltvDistribution} labelKey="bucket" valueKey="customers" horizontal={false} height={240} tooltipLabel="Customers" valueLabels={false} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Purchase frequency" question="How many customers come back for a 2nd, 3rd, 4th order?" className="lg:col-span-4">
          <BarChart data={view.frequency} labelKey="bucket" valueKey="customers" tooltipLabel="Customers" />
        </ChartCard>
        <ChartCard title="Where your customers are" question="Customer concentration by state" className="lg:col-span-8">
          <IndiaTileMap data={view.geo} valueKey="customers" label="Customers"
            extra={(d) => <div className="mt-1 text-fg-2">Revenue: <span className="tabular text-fg">{inr(Number(d.revenue))}</span> · avg LTV {inr(Number(d.avgLtv))}</div>} />
        </ChartCard>
      </div>
      <ChartCard title="Most valuable customers" question="Your highest lifetime-value customers">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead className="text-left text-[11.5px] text-fg-3">
              <tr><th className="py-2 font-medium">Customer</th><th className="font-medium">Segment</th><th className="text-right font-medium">Orders</th><th className="text-right font-medium">Lifetime value</th><th className="text-right font-medium">Last order</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(view.topCustomers as Record<string, string & number>[]).map((c) => (
                <tr key={c.id} className="hover:bg-surface-2">
                  <td className="py-2.5"><div className="font-medium">{c.name}</div><div className="text-[11.5px] text-fg-3">{c.city}, {c.state}</div></td>
                  <td><SegmentBadge segment={c.segment} /></td>
                  <td className="text-right tabular">{c.orders}</td>
                  <td className="text-right font-medium tabular">{inr(c.ltv, { compact: false })}</td>
                  <td className="text-right text-fg-3">{relativeTime(c.lastOrder)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}

"use client";

import { cn } from "@/lib/cn";
import { inr } from "@/lib/format";
import type { Insight, Range, Row, View } from "@/lib/types";
import { Donut, TrendChart, Waterfall } from "@/components/charts/charts";
import { AiCallout, ChartCard, KpiStrip } from "./common";

export function FinanceView({ view, insights, range }: { view: View; insights: Insight[]; range: Range }) {
  const margin = insights.find((i) => i.title.toLowerCase().includes("margin"));
  const pay = insights.find((i) => i.title.startsWith("Payment"));
  const kpis = view.kpis as Row[];
  const rev = kpis.find((k) => k.key === "revenue");
  const np = kpis.find((k) => k.key === "netProfit");
  const diverging = rev && np && rev.change > 0 && np.change < 0;
  const per = view.perOrder as Record<string, number>;
  return (
    <div className="space-y-4">
      <KpiStrip kpis={view.kpis} cols={4} />
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Revenue vs profit" question="Is growth translating into profit? The gap between the lines is your total cost base." className="lg:col-span-8">
          {diverging && (
            <div className="mb-3 rounded-lg bg-crit-soft px-3 py-2 text-[12.5px] font-medium text-crit-text">
              Revenue is up {rev.change.toFixed(1)}% but net profit is down {Math.abs(np.change).toFixed(1)}% — growth is getting more expensive.
            </div>
          )}
          <TrendChart data={view.trend} granularity={range.granularity} unit="currency" height={280} refLines={[{ y: 0, label: "Break-even" }]}
            series={[
              { key: "revenue", label: "Net revenue", color: "var(--series-1)", type: "area", unit: "currency" },
              { key: "grossProfit", label: "Gross profit", color: "var(--series-3)", unit: "currency" },
              { key: "netProfit", label: "Net profit", color: "var(--series-7)", type: "bar", unit: "currency" },
            ]} />
        </ChartCard>
        <ChartCard title="Margin trend" question="Gross and net margin over time" className="lg:col-span-4">
          <TrendChart data={view.trend} granularity={range.granularity} unit="percent" height={280}
            series={[
              { key: "grossMargin", label: "Gross margin", color: "var(--series-3)", unit: "percent" },
              { key: "netMargin", label: "Net margin", color: "var(--series-7)", unit: "percent" },
            ]} />
        </ChartCard>
      </div>
      <AiCallout insight={margin} />
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="From sales to profit" question="Where does each rupee of gross sales go?" className="lg:col-span-7">
          <Waterfall steps={view.waterfall} />
        </ChartCard>
        <ChartCard title="Expense breakdown" question="Cost lines as a share of gross sales" className="lg:col-span-5">
          <Donut data={view.expenses} valueKey="value" labelKey="label" unit="currency" centerLabel="total costs" height={170} />
          <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-[12px]">
            {(view.expenses as Row[]).map((e) => {
              const d = e.shareOfRevenue - e.prevShare;
              return (
                <div key={e.key} className="flex items-center justify-between">
                  <span className="text-fg-2">{e.label}</span>
                  <span className="tabular">{e.shareOfRevenue}% of sales <span className={cn("ml-1", d > 0.3 ? "text-crit-text" : d < -0.3 ? "text-good-text" : "text-fg-3")}>{d > 0 ? "+" : ""}{d.toFixed(1)} pts</span></span>
                </div>
              );
            })}
          </div>
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Cash flow" question="Cash in (prepaid + COD remittances) vs cash out (stock, ads, shipping, overheads)" className="lg:col-span-8">
          <TrendChart data={view.trend} granularity={range.granularity} unit="currency" height={240}
            series={[
              { key: "cashIn", label: "Cash in", color: "var(--series-3)", type: "bar", unit: "currency" },
              { key: "cashOut", label: "Cash out", color: "var(--series-2)", type: "bar", unit: "currency" },
              { key: "netCash", label: "Net cash", color: "var(--series-7)", unit: "currency" },
            ]} />
        </ChartCard>
        <ChartCard title="Unit economics per order" question="What does an average order really earn?" className="lg:col-span-4">
          <dl className="space-y-2 text-[13px]">
            {[["Average order value", per.aov, false], ["Cost of goods", -per.cogs, true], ["Shipping", -per.shipping, true], ["Marketing", -per.marketing, true], ["Refunds", -per.refunds, true]].map(([l, v, neg]) => (
              <div key={String(l)} className="flex justify-between"><dt className="text-fg-2">{String(l)}</dt><dd className={cn("tabular", neg && "text-fg-2")}>{inr(Number(v), { compact: false })}</dd></div>
            ))}
            <div className="flex justify-between border-t border-border pt-2 font-semibold"><dt>Contribution / order</dt><dd className={cn("tabular", per.contribution < 0 ? "text-crit-text" : "text-good-text")}>{inr(per.contribution, { compact: false })}</dd></div>
          </dl>
        </ChartCard>
      </div>
      <div id="payments" className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Payment failures" question="Prepaid payment attempts that failed">
          <TrendChart data={view.trend} granularity={range.granularity} height={200} series={[{ key: "paymentFailures", label: "Failed payments", color: "var(--series-8)", type: "bar" }]} />
          <AiCallout insight={pay} className="mt-4" />
        </ChartCard>
        <ChartCard title="Refunds" question="Money returned to customers">
          <TrendChart data={view.trend} granularity={range.granularity} unit="currency" height={200} series={[{ key: "refunds", label: "Refunds", color: "var(--series-2)", type: "bar", unit: "currency" }]} />
        </ChartCard>
      </div>
    </div>
  );
}

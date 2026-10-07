"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { usd } from "@/lib/format";
import type { Insight, Range, Row, StockRow, View } from "@/lib/types";
import { BarChart, Donut, TrendChart } from "@/components/charts/charts";
import { SERIES } from "@/components/charts/kit";
import { RiskBadge } from "@/components/data-table/cells";
import { AiCallout, ChartCard, KpiStrip } from "./common";

const RISK_LABEL: Record<string, string> = { stockout: "Out of stock", critical: "Critical", low: "Low stock", healthy: "Healthy", overstock: "Overstock", dead: "Dead stock" };
const RISK_COLOR: Record<string, string> = { stockout: "var(--crit)", critical: "var(--series-8)", low: "var(--warn)", healthy: "var(--series-3)", overstock: "var(--series-1)", dead: "var(--series-muted)" };

export function InventoryRisk({ risk }: { risk: string }) {
  if (risk === "low") return <span className="inline-flex h-5 items-center rounded-md bg-warn-soft px-1.5 text-[11px] font-medium text-warn-text">Low stock</span>;
  return <RiskBadge risk={risk} />;
}

export function InventoryView({ view, insights, range }: { view: View; insights: Insight[]; range: Range }) {
  const router = useRouter();
  const crit = insights.find((i) => i.severity === "critical");
  const table = (view.table as StockRow[]).slice(0, 12);
  const proj = view.projection as { rows: Row[]; series: { key: string; name: string; reorderPoint: number }[] };
  const riskMix: Row[] = (view.riskMix as Row[]).filter((r) => r.count > 0).map((r) => ({ ...r, label: RISK_LABEL[r.risk] }));
  return (
    <div className="space-y-4">
      <KpiStrip kpis={view.kpis} cols={6} />
      <AiCallout insight={crit} />
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Stock-out risk" question="Which products run out first, and how urgent is it?" className="lg:col-span-7" bodyClassName="px-0 pb-2">
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[620px] text-[12.5px]">
              <thead className="bg-surface-2 text-left text-[11.5px] text-fg-3">
                <tr><th className="px-5 py-2 font-medium">Product</th><th className="text-right font-medium">Stock</th><th className="text-right font-medium">Daily sales</th><th className="text-right font-medium">Days left</th><th className="px-5 font-medium">Risk</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {table.map((r) => (
                  <tr key={r.productId} className="cursor-pointer hover:bg-surface-2" onClick={() => router.push(`/agents/products?product=${r.productId}`)}>
                    <td className="px-5 py-2.5"><div className="max-w-[220px] truncate font-medium">{r.name}</div><div className="text-[11px] text-fg-3">{r.sku}</div></td>
                    <td className="text-right tabular">{r.available}</td>
                    <td className="text-right tabular">{r.dailySales.toFixed(1)}</td>
                    <td className="text-right">
                      <div className="ml-auto flex w-[110px] items-center justify-end gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (Math.min(r.daysLeft, 60) / 60) * 100)}%`, background: RISK_COLOR[r.risk] }} />
                        </div>
                        <span className={cn("w-8 tabular", (r.risk === "critical" || r.risk === "stockout") && "font-semibold text-crit-text")}>{r.daysLeft >= 999 ? "—" : Math.round(r.daysLeft)}</span>
                      </div>
                    </td>
                    <td className="px-5"><InventoryRisk risk={r.risk} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => router.push("/agents/inventory?tab=data")} className="mx-5 mt-2 text-[12.5px] font-medium text-accent-text hover:underline">View all {(view.table as StockRow[]).length} SKUs →</button>
        </ChartCard>
        <ChartCard title="Stock-out prediction" question="Projected units for at-risk products over the next 21 days" className="lg:col-span-5">
          <TrendChart data={proj.rows} height={260} refLines={[{ y: 0, label: "Stock-out" }]}
            series={proj.series.map((s, i) => ({ key: s.key, label: s.name, color: SERIES[[7, 3, 1, 4][i % 4]] }))} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Demand forecast" question="Total units per day: last 60 days and the next 30 (shaded = 80% range)" className="lg:col-span-8">
          <TrendChart data={view.forecast} height={260}
            series={[
              { key: "actual", label: "Actual units", color: "var(--series-1)" },
              { key: "forecast", label: "Forecast", color: "var(--series-7)", dashed: true },
              { key: "high", label: "Upper bound", color: "var(--series-muted)", muted: true },
              { key: "low", label: "Lower bound", color: "var(--series-muted)", muted: true },
            ]} />
        </ChartCard>
        <ChartCard title="Inventory health mix" question="Where is your stock value sitting?" className="lg:col-span-4">
          <Donut data={riskMix} valueKey="value" labelKey="label" unit="currency" colors={riskMix.map((r) => RISK_COLOR[r.risk])} centerLabel="at cost" height={160}
            onSelect={(d) => router.push(`/agents/inventory?tab=data&risk=${d.risk}`)} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Inventory value trend" question="Is capital tied up in stock rising or falling?">
          <TrendChart data={view.trend} granularity={range.granularity === "hour" ? "day" : range.granularity} unit="currency" height={220}
            series={[
              { key: "value", label: "Inventory value (cost)", color: "var(--series-1)", type: "area", unit: "currency" },
              { key: "restocked", label: "Restocked", color: "var(--series-3)", type: "bar", unit: "currency" },
            ]} />
        </ChartCard>
        <ChartCard title="Inventory velocity" question="Fastest-moving SKUs (units sold per day)">
          <BarChart data={view.velocity} labelKey="name" valueKey="dailySales" tooltipLabel="Units / day"
            colorFor={(d) => (d.risk === "critical" || d.risk === "stockout" ? "var(--crit)" : "var(--series-1)")}
            onSelect={(d) => router.push(`/agents/products?product=${d.productId}`)} />
          <p className="mt-2 text-[11.5px] text-fg-3">Red: at risk of stocking out. Total value on hand {usd((view.kpis[0]?.value as number) ?? 0)}.</p>
        </ChartCard>
      </div>
    </div>
  );
}

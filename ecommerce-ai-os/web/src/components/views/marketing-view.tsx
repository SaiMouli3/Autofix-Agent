"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { inr, pct } from "@/lib/format";
import type { Insight, Range, Row, View } from "@/lib/types";
import { BarChart, Funnel, TrendChart } from "@/components/charts/charts";
import { Badge } from "@/components/ui/badge";
import { ChangePill } from "@/components/agents/primitives";
import { AiCallout, ChartCard, KpiStrip } from "./common";

export function MarketingView({ view, insights, range }: { view: View; insights: Insight[]; range: Range }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const drop = insights.find((i) => i.severity === "critical" || i.severity === "important");
  const highlighted = sp.get("campaign");
  const channels = view.channels as Row[];
  const paid = channels.filter((c) => c.spend > 0);
  return (
    <div className="space-y-4">
      <KpiStrip kpis={view.kpis} cols={7} />
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Spend vs attributed revenue" question="Is every rupee of spend still returning revenue?" className="lg:col-span-7">
          <TrendChart data={view.trend} granularity={range.granularity} unit="currency" height={260}
            series={[
              { key: "revenue", label: "Attributed revenue", color: "var(--series-3)", type: "area", unit: "currency" },
              { key: "spend", label: "Ad spend", color: "var(--series-2)", type: "bar", unit: "currency" },
            ]} />
        </ChartCard>
        <ChartCard title="ROAS trend" question={`Blended return on ad spend vs the ${view.targetRoas}x target`} className="lg:col-span-5">
          <TrendChart data={view.trend} granularity={range.granularity} unit="ratio" height={260} refLines={[{ y: view.targetRoas, label: `Target ${view.targetRoas}x` }]}
            series={[{ key: "roas", label: "ROAS", color: "var(--series-7)", unit: "ratio" }]} />
        </ChartCard>
      </div>
      <AiCallout insight={drop} />
      <ChartCard title="Campaign performance" question="Which campaigns create profitable growth, and which burn budget?" bodyClassName="px-0 pb-1">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12.5px]">
            <thead className="bg-surface-2 text-left text-[11.5px] text-fg-3">
              <tr>
                <th className="px-5 py-2 font-medium">Campaign</th><th className="text-right font-medium">Spend</th><th className="text-right font-medium">Revenue</th>
                <th className="text-right font-medium">ROAS</th><th className="text-right font-medium">CTR</th><th className="text-right font-medium">CPC</th>
                <th className="text-right font-medium">Orders</th><th className="px-5 text-right font-medium">CAC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(view.campaigns as Row[]).map((c) => (
                <tr key={c.id} className={cn("hover:bg-surface-2", highlighted === c.id && "bg-crit-soft")}>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2"><Badge tone="outline">{c.channelLabel}</Badge><span className="max-w-[260px] truncate font-medium">{c.name}</span></div>
                    <div className="mt-0.5 text-[11px] text-fg-3">{c.objective} · budget {inr(c.dailyBudget)}/day</div>
                  </td>
                  <td className="text-right tabular">{inr(c.spend)}</td>
                  <td className="text-right tabular">{inr(c.revenue)}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className={cn("font-semibold tabular", c.roas < view.targetRoas * 0.75 ? "text-crit-text" : c.roas >= view.targetRoas ? "text-good-text" : "")}>{c.roas.toFixed(2)}x</span>
                      <ChangePill change={c.roasChange} unit="number" direction="up" size="xs" />
                    </div>
                  </td>
                  <td className="text-right tabular">{pct(c.ctr, 2)}</td>
                  <td className="text-right tabular">₹{c.cpc}</td>
                  <td className="text-right tabular">{c.orders}</td>
                  <td className="px-5 text-right tabular">{c.cac ? inr(c.cac) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Channel comparison" question="Revenue by channel this period" className="lg:col-span-4">
          <BarChart data={channels} labelKey="label" valueKey="revenue" unit="currency" tooltipLabel="Revenue" />
        </ChartCard>
        <ChartCard title="ROAS by paid channel" question="Efficiency of each paid channel" className="lg:col-span-4">
          <BarChart data={paid} labelKey="label" valueKey="roas" unit="ratio" tooltipLabel="ROAS" refLine={{ y: view.targetRoas, label: "Target" }}
            colorFor={(d) => (Number(d.roas) < view.targetRoas ? "var(--series-2)" : "var(--series-3)")} />
        </ChartCard>
        <ChartCard title="Conversion funnel" question="Where do shoppers drop off?" className="lg:col-span-4">
          <Funnel stages={view.funnel} />
        </ChartCard>
      </div>
      <span className="hidden" onClick={() => router.push(pathname)} />
    </div>
  );
}

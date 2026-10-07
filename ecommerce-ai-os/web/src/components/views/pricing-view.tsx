"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { usd, relativeTime } from "@/lib/format";
import type { Insight, Range, Row, View } from "@/lib/types";
import { BarChart, TrendChart } from "@/components/charts/charts";
import { SERIES } from "@/components/charts/kit";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states/states";
import { Tag } from "lucide-react";
import { AiCallout, ChartCard, KpiStrip } from "./common";

export function PricingView({ view, insights }: { view: View; insights: Insight[]; range: Range }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const products = view.products as Row[];
  if (!products.length) {
    return <EmptyState icon={Tag} title="No competitor data yet" description="Connect competitor monitoring to compare your prices, discounts and ratings against the market." />;
  }
  const featured = view.featured as Row;
  const cut = insights.find((i) => i.severity === "market");
  const selected = sp.get("product");
  const bars = (featured?.bars ?? []) as Row[];
  return (
    <div className="space-y-4">
      <KpiStrip kpis={view.kpis} cols={4} />
      {featured?.productId && (
        <div className="grid gap-4 lg:grid-cols-12">
          <ChartCard title={`Price comparison · ${featured.name}`} question="Where does your price sit against each competitor today?" className="lg:col-span-5">
            <BarChart data={bars} labelKey="name" valueKey="price" unit="currency" tooltipLabel="Price" refLine={{ y: featured.median, label: `Median ${usd(featured.median)}` }}
              colorFor={(d) => (d.ours ? "var(--series-7)" : "var(--series-muted)")} />
            <AiCallout insight={cut} className="mt-4" />
          </ChartCard>
          <ChartCard title="Price history" question="How have competitor prices moved over the last 45 days?" className="lg:col-span-7">
            <TrendChart data={featured.history} unit="currency" height={300}
              series={[
                { key: "ours", label: "Your price", color: "var(--series-7)", unit: "currency" },
                ...(featured.series as { key: string; name: string }[]).map((s, i) => ({ key: s.key, label: s.name, color: SERIES[[0, 1, 2, 3][i % 4]], unit: "currency" })),
              ]} />
          </ChartCard>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Market positioning" question="Your price vs market median for every tracked product" className="lg:col-span-8" bodyClassName="px-0 pb-1">
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[680px] text-[12.5px]">
              <thead className="bg-surface-2 text-left text-[11.5px] text-fg-3">
                <tr><th className="px-5 py-2 font-medium">Product</th><th className="text-right font-medium">Your price</th><th className="text-right font-medium">Market median</th><th className="text-right font-medium">Gap</th><th className="text-right font-medium">Rating (you vs them)</th><th className="px-5 font-medium">Position</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((p) => (
                  <tr key={p.productId} className={cn("cursor-pointer hover:bg-surface-2", selected === p.productId && "bg-accent-soft")}
                    onClick={() => router.push(`/agents/products?product=${p.productId}`)}>
                    <td className="px-5 py-2.5"><div className="max-w-[220px] truncate font-medium">{p.name}</div><div className="text-[11px] text-fg-3">{(p.competitors as Row[]).length} competitors</div></td>
                    <td className="text-right tabular">{usd(p.ourPrice, { compact: false })}</td>
                    <td className="text-right tabular text-fg-2">{usd(p.marketMedian, { compact: false })}</td>
                    <td className={cn("text-right font-medium tabular", p.gapPct > 4 ? "text-warn-text" : p.gapPct < -4 ? "text-info-text" : "text-fg-2")}>{p.gapPct > 0 ? "+" : ""}{p.gapPct}%</td>
                    <td className="text-right tabular">
                      <span className={cn(p.ourRating >= p.competitorRating ? "text-good-text" : "text-crit-text")}>{p.ourRating ? p.ourRating.toFixed(1) : "—"}</span>
                      <span className="text-fg-3"> vs {p.competitorRating.toFixed(1)}</span>
                    </td>
                    <td className="px-5"><Badge tone={p.position === "Premium" ? "accent" : p.position === "Value" ? "info" : "neutral"}>{p.position}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
        <ChartCard title="Competitor price moves" question="Price changes of 5%+ in the last 14 days" className="lg:col-span-4">
          {(view.changes as Row[]).length === 0 ? <p className="py-6 text-center text-[12.5px] text-fg-3">No significant competitor moves.</p> : (
            <ul className="space-y-2.5">
              {(view.changes as Row[]).slice(0, 8).map((c, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", c.change < 0 ? "bg-crit-soft text-crit-text" : "bg-good-soft text-good-text")}>
                    {c.change < 0 ? <ArrowDownRight className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                  </span>
                  <div className="min-w-0 text-[12.5px]">
                    <div className="truncate"><span className="font-medium">{c.competitor}</span> · {c.product}</div>
                    <div className="tabular text-fg-3">{usd(c.from, { compact: false })} → {usd(c.to, { compact: false })} ({c.change > 0 ? "+" : ""}{c.change}%) · {relativeTime(c.at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Competitor discounts" question="Average live discount depth by competitor">
          <BarChart data={view.competitors} labelKey="name" valueKey="avgDiscount" unit="percent" tooltipLabel="Avg discount" color="var(--series-2)" />
        </ChartCard>
        <ChartCard title="Competitor ratings" question="How do competitors' ratings compare?">
          <BarChart data={view.competitors} labelKey="name" valueKey="rating" unit="rating" tooltipLabel="Rating" color="var(--series-4)" />
          <p className="mt-2 text-[11.5px] text-fg-3">{(view.competitors as Row[]).map((c) => `${c.name}: avg price ${c.avgPriceVsOurs > 0 ? "+" : ""}${c.avgPriceVsOurs}% vs yours`).join(" · ")}</p>
        </ChartCard>
      </div>
      <span className="hidden">{pathname}</span>
    </div>
  );
}

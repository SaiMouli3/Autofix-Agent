"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usd, pct, relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useProduct } from "@/lib/queries";
import type { Insight, ProductStats, Range, Row, View } from "@/lib/types";
import { BubbleScatter, TrendChart } from "@/components/charts/charts";
import { ScoreBars } from "@/components/charts/special";
import { Stars } from "@/components/data-table/cells";
import { Sheet } from "@/components/ui/overlay";
import { Badge } from "@/components/ui/badge";
import { CardSkeleton } from "@/components/states/states";
import { ChangePill } from "@/components/agents/primitives";
import { AiCallout, ChartCard, KpiStrip, RankList } from "./common";

function HealthScorecard({ p, className }: { p: ProductStats; className?: string }) {
  const s = p.scores;
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{p.name}</div>
          <div className="text-[12px] text-fg-3">{p.sku} · {p.category} · {usd(p.price, { compact: false })}</div>
        </div>
        <div className="text-right">
          <div className="text-[28px] font-semibold leading-none tracking-tight tabular">{Math.round(p.health)}<span className="text-[13px] font-medium text-fg-3"> / 100</span></div>
          <div className="text-[11px] text-fg-3">Product health</div>
        </div>
      </div>
      <ScoreBars className="mt-4" items={[
        { label: "Sales", score: s.sales }, { label: "Quality", score: s.quality }, { label: "Reviews", score: s.reviews },
        { label: "Returns", score: s.returns }, { label: "Profit", score: s.profit },
      ]} />
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-[12px]">
        <div><div className="text-fg-3">Revenue</div><div className="font-semibold tabular">{usd(p.revenue)}</div></div>
        <div><div className="text-fg-3">Return rate</div><div className={cn("font-semibold tabular", p.returnRate > 12 && "text-crit-text")}>{pct(p.returnRate)}</div></div>
        <div><div className="text-fg-3">Rating</div><div className="font-semibold tabular">{p.rating ? `${p.rating.toFixed(2)}★` : "—"}</div></div>
      </div>
    </div>
  );
}

export function ProductSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useProduct(id ?? undefined);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()} title={data?.product?.name ?? "Product"} description={data ? `${data.product.sku} · supplied by ${data.product.supplier}` : undefined} width="max-w-2xl">
      {isLoading || !data ? <div className="p-5"><CardSkeleton lines={6} /></div> : (
        <div className="space-y-6 p-5">
          <HealthScorecard p={data.stats} />
          <div>
            <div className="eyebrow mb-2">Last 12 weeks · units sold vs return rate</div>
            <TrendChart data={data.trend} granularity="week" height={200}
              series={[{ key: "units", label: "Units sold", color: "var(--series-1)", type: "bar" }]} />
            <TrendChart data={data.trend} granularity="week" height={140} unit="percent" className="mt-2"
              series={[{ key: "returnRate", label: "Return rate", color: "var(--series-8)", unit: "percent" }]} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="eyebrow mb-2">Return reasons (30d)</div>
              {(data.returnReasons as Row[]).length === 0 ? <p className="text-[12.5px] text-fg-3">No returns in the last 30 days.</p> :
                <RankList items={data.returnReasons} label="reason" value="count" />}
            </div>
            <div>
              <div className="eyebrow mb-2">Stock position</div>
              {data.stock ? (
                <div className="space-y-1.5 text-[12.5px]">
                  <div className="flex justify-between"><span className="text-fg-3">Available</span><span className="font-medium tabular">{data.stock.available}</span></div>
                  <div className="flex justify-between"><span className="text-fg-3">Daily sales</span><span className="font-medium tabular">{data.stock.dailySales}/day</span></div>
                  <div className="flex justify-between"><span className="text-fg-3">Days left</span><span className="font-medium tabular">{data.stock.daysLeft >= 999 ? "—" : Math.round(data.stock.daysLeft)}</span></div>
                  <div className="flex justify-between"><span className="text-fg-3">Lead time</span><span className="font-medium tabular">{data.stock.leadTimeDays} days</span></div>
                </div>
              ) : <p className="text-[12.5px] text-fg-3">Not stocked.</p>}
            </div>
          </div>
          <div>
            <div className="eyebrow mb-2">Recent reviews</div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {(data.reviews as Row[]).map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-center gap-2"><Stars rating={r.rating} /><span className="text-[12.5px] font-medium">{r.title}</span></div>
                  <p className="mt-1 text-[12.5px] text-fg-2">{r.body}</p>
                  <p className="mt-1 text-[11px] text-fg-3">{r.customer} · {relativeTime(r.createdAt)}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function ProductsView({ view, insights, range }: { view: View; insights: Insight[]; range: Range }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const openId = sp.get("product");
  const open = (id: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (id) p.set("product", id); else p.delete("product");
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const sel = (d: Record<string, unknown>) => open(String(d.id));
  const featured = view.featured as ProductStats | undefined;
  const spike = insights.find((i) => i.severity === "critical");
  const growthSub = (d: Record<string, unknown>) => <ChangePill change={Number(d.growth)} unit="number" direction="up" size="xs" />;
  return (
    <div className="space-y-4">
      <KpiStrip kpis={view.kpis} cols={5} />
      <div className="grid gap-4 lg:grid-cols-12">
        {featured && (
          <ChartCard title="Product health spotlight" question="The product your agents are most concerned about" className="lg:col-span-5">
            <HealthScorecard p={featured} />
            <AiCallout insight={spike} className="mt-4" />
            <button onClick={() => open(featured.id)} className="mt-3 text-[12.5px] font-medium text-accent-text hover:underline">Open full product analysis →</button>
          </ChartCard>
        )}
        <ChartCard title="Margin vs return rate" question="Which products earn well but leak value through returns? Bubble size = revenue." className="lg:col-span-7">
          <BubbleScatter data={view.scatter} x="returnRate" y="margin" z="revenue" xLabel="Return rate" yLabel="Gross margin" height={320}
            colorFor={(d) => (Number(d.returnRate) > 12 ? "var(--series-8)" : Number(d.health) >= 72 ? "var(--series-3)" : "var(--series-1)")}
            onSelect={sel} refX={8} />
          <p className="mt-2 text-[11.5px] text-fg-3">Red: return rate above 12%. Green: product health ≥ 72. Dashed line: 8% catalogue return benchmark.</p>
        </ChartCard>
      </div>
      {view.featuredTrend && featured && (
        <ChartCard title={`${featured.name} · weekly trend`} question="Did returns rise while sales held steady? (12 weeks)">
          <div className="grid gap-4 lg:grid-cols-2">
            <TrendChart data={view.featuredTrend} granularity="week" height={200} series={[{ key: "units", label: "Units sold", color: "var(--series-1)", type: "bar" }]} />
            <TrendChart data={view.featuredTrend} granularity="week" height={200} unit="percent" refLines={[{ y: 8, label: "Benchmark 8%" }]}
              series={[{ key: "returnRate", label: "Return rate", color: "var(--series-8)", unit: "percent" }]} />
          </div>
        </ChartCard>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ChartCard title="Top products" question="Highest revenue this period">
          <RankList items={view.top} label="name" value="revenue" unit="currency" sub={growthSub} onSelect={sel} />
        </ChartCard>
        <ChartCard title="Fastest-growing" question="Revenue growth vs previous period">
          <RankList items={view.fastest} label="name" value="revenue" unit="currency" sub={growthSub} onSelect={sel} empty="No products are growing significantly." />
        </ChartCard>
        <ChartCard title="Declining products" question="Biggest revenue drops vs previous period">
          <RankList items={view.declining} label="name" value="revenue" unit="currency" sub={growthSub} onSelect={sel} />
        </ChartCard>
        <ChartCard title="Return-heavy products" question="Highest return rates (min. 8 units)">
          <RankList items={view.returnHeavy} label="name" value="returnRate" unit="percent" sub={(d) => `${d.returns} returns`} onSelect={sel} />
        </ChartCard>
        <ChartCard title="High-profit products" question="Largest gross profit contribution">
          <RankList items={view.highProfit} label="name" value="grossProfit" unit="currency" sub={(d) => `${d.margin}% margin`} onSelect={sel} />
        </ChartCard>
        <ChartCard title="Worst-performing" question="Lowest product health score">
          <RankList items={view.worst} label="name" value="health" unit="score" sub={(d) => <Badge tone="crit">{String(d.health)}</Badge>} onSelect={sel} />
        </ChartCard>
      </div>
      <ChartCard title="Category performance" question="Revenue, margin and returns by category">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead className="text-left text-[11.5px] text-fg-3"><tr><th className="py-1.5 font-medium">Category</th><th className="text-right font-medium">Revenue</th><th className="text-right font-medium">Units</th><th className="text-right font-medium">Margin</th><th className="text-right font-medium">Return rate</th></tr></thead>
            <tbody className="divide-y divide-border">
              {(view.categories as Row[]).map((c) => (
                <tr key={c.category} className="cursor-pointer hover:bg-surface-2" onClick={() => router.push(`/agents/products?tab=data&category=${encodeURIComponent(c.category)}`)}>
                  <td className="py-2.5 font-medium">{c.category}</td>
                  <td className="text-right tabular">{usd(c.revenue)}</td>
                  <td className="text-right tabular">{Number(c.units).toLocaleString("en-US")}</td>
                  <td className="text-right tabular">{pct(c.margin)}</td>
                  <td className={cn("text-right tabular", c.returnRate > 10 && "text-crit-text")}>{pct(c.returnRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
      <ProductSheet id={openId} onClose={() => open(null)} />
      <span className="hidden">{range.key}</span>
    </div>
  );
}

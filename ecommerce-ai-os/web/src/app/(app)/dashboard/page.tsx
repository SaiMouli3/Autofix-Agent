"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, Sparkles } from "lucide-react";
import { SEVERITY } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { clockTime, greeting, usd } from "@/lib/format";
import { useDashboard, useMe } from "@/lib/queries";
import { useAppStore } from "@/lib/store";
import type { Severity } from "@/lib/types";
import { AgentCard } from "@/components/agents/agent-card";
import { ActivityFeed, PriorityItem } from "@/components/agents/insights";
import { KpiCard } from "@/components/agents/primitives";
import { TrendChart } from "@/components/charts/charts";
import { HealthRing } from "@/components/charts/special";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { AnalysisState, CardSkeleton, ChartSkeleton, ErrorState } from "@/components/states/states";

const SEV_ORDER: Severity[] = ["critical", "important", "opportunity", "market"];

export default function DashboardPage() {
  const { data, error, isLoading, refetch, isFetching } = useDashboard();
  const { data: me } = useMe();
  const ask = useAppStore((s) => s.setAssistantOpen);
  const [trendMetric, setTrendMetric] = useState<"revenue" | "orders">("revenue");
  const [hoverSeg, setHoverSeg] = useState<string | null>(null);
  const firstName = me?.user.name.split(" ")[0];

  if (error && !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const counts = data?.priorityCounts ?? {};
  const totalAttention = SEV_ORDER.reduce((s, k) => s + (counts[k] ?? 0), 0);
  const critical = counts.critical ?? 0;

  return (
    <div className={cn("space-y-6 transition-opacity", isFetching && !isLoading && "opacity-[0.85]")}>
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.03em] sm:text-[30px]">
            {greeting()}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-[14px] text-fg-2">
            Here&apos;s what changed in your business {data?.range.key === "today" ? "today" : `· ${data?.range.label.toLowerCase() ?? "last 30 days"}`}.
            {data && (
              <span className="text-fg-3"> Analysed {clockTime(data.generatedAt)} · {data.agents.length} agents monitoring</span>
            )}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => ask(true, "What should I focus on today?")}>
          <Sparkles className="!text-accent" /> What should I focus on today?
        </Button>
      </div>

      {/* Health + KPIs */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5 xl:col-span-4">
          {data ? (
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center lg:flex-col lg:items-stretch 2xl:flex-row 2xl:items-center">
              <div className="mx-auto shrink-0">
                <HealthRing score={data.health.score} segments={data.health.segments} size={196} onHover={setHoverSeg} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] font-semibold">{data.health.label}</span>
                  <span className={cn("text-[12px] font-medium tabular", data.health.change >= 0 ? "text-good-text" : "text-crit-text")}>
                    {data.health.change >= 0 ? "▲" : "▼"} {Math.abs(data.health.change).toFixed(1)} pts vs prior
                  </span>
                </div>
                <ul className="mt-3 space-y-1">
                  {data.health.segments.map((s) => {
                    const d = s.score - s.prev;
                    return (
                      <li key={s.key}>
                        <Link href={s.href}
                          className={cn("flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] transition-colors hover:bg-surface-3", hoverSeg === s.key && "bg-surface-3")}>
                          <span className={cn("size-1.5 rounded-full", s.score >= 72 ? "bg-good" : s.score >= 58 ? "bg-warn" : "bg-crit")} />
                          <span className="flex-1 text-fg-2">{s.label}</span>
                          <span className="font-semibold tabular">{Math.round(s.score)}</span>
                          <span className={cn("w-8 text-right text-[11px] tabular", d >= 0 ? "text-good-text" : "text-crit-text")}>{d >= 0 ? "+" : ""}{Math.round(d)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-6 p-5"><Skeleton className="size-[196px] rounded-full" /><div className="flex-1 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-4" />)}</div></div>
          )}
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-7 xl:col-span-8">
          {data
            ? data.kpis.map((k, i) => <KpiCard key={k.key} kpi={k} featured={i === 0} className="animate-rise" />)
            : Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} lines={3} />)}
        </div>
      </div>

      {/* Priority center + activity */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="overflow-hidden lg:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-md bg-accent-soft text-accent"><Sparkles className="size-3.5" /></span>
                <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
                  {data ? (totalAttention ? `AI detected ${totalAttention} things that need your attention` : "Nothing needs your attention") : "AI Priority Center"}
                </h2>
              </div>
              <p className="mt-1 text-[12.5px] text-fg-3">Ranked by severity and estimated monthly impact, across every agent.</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SEV_ORDER.filter((k) => counts[k]).map((k) => (
                <span key={k} className={cn("inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium", SEVERITY[k].soft, SEVERITY[k].text)}>
                  <span className={cn("size-1.5 rounded-full", SEVERITY[k].dot)} />
                  {counts[k]} {SEVERITY[k].label.toLowerCase()}
                </span>
              ))}
            </div>
          </div>
          {!data ? (
            <div className="p-5"><AnalysisState /></div>
          ) : data.priority.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-fg-3">All agents report healthy operation. They&apos;ll flag the next issue the moment it appears.</div>
          ) : (
            <div className="divide-y divide-border">
              {data.priority.map((p, i) => <PriorityItem key={p.id} insight={p} index={i} />)}
            </div>
          )}
          {data && (
            <Link href="/insights" className="flex items-center justify-between border-t border-border px-5 py-3 text-[13px] font-medium text-fg-2 hover:bg-surface-2 hover:text-fg">
              Open Business Insights {critical > 0 && <span className="text-crit-text">· {critical} critical</span>}
              <ArrowRight className="size-4" />
            </Link>
          )}
        </Card>

        <Card className="flex flex-col lg:col-span-4">
          <CardHeader title="Agent activity" description="Live log of what your agents are doing"
            action={<Link href="/agents" className="text-[12px] font-medium text-fg-3 hover:text-fg">View all</Link>} />
          <div className="relative mt-2 max-h-[560px] flex-1 overflow-hidden pb-2">
            {data ? <ActivityFeed items={data.activity} limit={12} /> : <div className="space-y-4 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent" />
          </div>
        </Card>
      </div>

      {/* Revenue trend */}
      <Card>
        <CardHeader
          title={trendMetric === "revenue" ? "Revenue vs previous period" : "Orders over time"}
          description={data ? `${data.range.label} · dashed line shows the previous period for comparison` : undefined}
          action={<Segmented value={trendMetric} onChange={setTrendMetric} ariaLabel="Trend metric" options={[{ value: "revenue", label: "Revenue" }, { value: "orders", label: "Orders" }]} />}
        />
        <CardBody>
          {data ? (
            <TrendChart
              data={data.trend}
              granularity={data.range.granularity}
              unit={trendMetric === "revenue" ? "currency" : "number"}
              height={260}
              series={
                trendMetric === "revenue"
                  ? [
                      { key: "revenue", label: "This period", color: "var(--series-1)", type: "area", unit: "currency" },
                      { key: "prevRevenue", label: "Previous period", color: "var(--series-muted)", dashed: true, muted: true, unit: "currency" },
                    ]
                  : [{ key: "orders", label: "Orders", color: "var(--series-1)", type: "bar" }]
              }
            />
          ) : (
            <ChartSkeleton height={260} />
          )}
        </CardBody>
      </Card>

      {/* AI team */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Your AI Team</h2>
            <p className="text-[12.5px] text-fg-3">Each agent owns one domain and monitors it continuously.</p>
          </div>
          <Link href="/agents" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-fg-2 hover:text-fg">Manage agents <ArrowUpRight className="size-3.5" /></Link>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {data ? data.agents.map((a, i) => <AgentCard key={a.id} agent={a} index={i} />) : Array.from({ length: 10 }).map((_, i) => <CardSkeleton key={i} lines={4} />)}
        </div>
        {data && data.business && (
          <Link href="/insights" className="mt-3 flex items-center gap-4 rounded-xl border border-accent-border bg-accent-soft p-4 transition-colors hover:border-accent">
            <span className="grid size-10 place-items-center rounded-xl bg-accent text-white dark:text-[#0b0b10]"><Sparkles className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">Business Insights Agent</div>
              <div className="text-[12.5px] text-fg-2">Connects findings from all ten agents · {data.business.issues} issues · {data.business.opportunities} opportunities · {usd(data.priority.reduce((s, p) => s + Math.abs(p.impactValue), 0))}/mo at stake in top priorities</div>
            </div>
            <ArrowRight className="size-4 text-accent-text" />
          </Link>
        )}
      </section>
    </div>
  );
}

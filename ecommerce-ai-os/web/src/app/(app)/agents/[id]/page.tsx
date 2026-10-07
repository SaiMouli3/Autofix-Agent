"use client";

import { notFound, usePathname, useRouter, useSearchParams } from "next/navigation";
import { use, useMemo } from "react";
import { Sparkles } from "lucide-react";
import { AGENTS } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { formatValue, usd } from "@/lib/format";
import { useAgent } from "@/lib/queries";
import { useAppStore } from "@/lib/store";
import type { AgentDetail, Insight } from "@/lib/types";
import { AgentIcon, AgentStatusBadge, LastAnalysis } from "@/components/agents/primitives";
import { ActivityFeed, InsightActions, InsightCard } from "@/components/agents/insights";
import { AgentSettingsForm } from "@/components/agents/settings-form";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Meter } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalysisState, CardSkeleton, ChartSkeleton, EmptyState, ErrorState } from "@/components/states/states";
import { AgentData } from "@/components/views/agent-data";
import { ChangesTable, HealthBreakdown } from "@/components/views/common";
import { CustomersView } from "@/components/views/customers-view";
import { FinanceView } from "@/components/views/finance-view";
import { InventoryView } from "@/components/views/inventory-view";
import { MarketView } from "@/components/views/market-view";
import { MarketingView } from "@/components/views/marketing-view";
import { OrdersView } from "@/components/views/orders-view";
import { PricingView } from "@/components/views/pricing-view";
import { ProductsView } from "@/components/views/products-view";
import { ReviewsView } from "@/components/views/reviews-view";
import { SupportView } from "@/components/views/support-view";
import { CircleCheck, Lightbulb } from "lucide-react";

const VIEWS = {
  orders: OrdersView, customers: CustomersView, reviews: ReviewsView, support: SupportView, products: ProductsView,
  inventory: InventoryView, pricing: PricingView, marketing: MarketingView, finance: FinanceView, market: MarketView,
} as const;

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "findings", label: "What I found" },
  { key: "changes", label: "What changed" },
  { key: "recommendations", label: "Recommendations" },
  { key: "activity", label: "Activity" },
  { key: "data", label: "Data" },
  { key: "settings", label: "Settings" },
];

function Recommendations({ insights }: { insights: Insight[] }) {
  const recs = insights.filter((i) => i.recommendation && i.status !== "dismissed");
  if (!recs.length) return <EmptyState icon={CircleCheck} title="No recommendations right now" description="The agent will recommend actions as soon as it detects something worth acting on." />;
  return (
    <ol className="space-y-3">
      {recs.map((r, i) => (
        <li key={r.id} className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3 text-[12px] font-semibold">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold leading-snug">{r.recommendation}</p>
            <p className="mt-1 text-[12.5px] text-fg-3">Because: {r.title}</p>
            {r.impact && <p className={cn("mt-1 text-[12.5px] font-medium", r.impactValue < 0 ? "text-crit-text" : "text-good-text")}>{r.impactValue !== 0 ? `${r.impactValue > 0 ? "+" : ""}${usd(r.impactValue)}/mo · ` : ""}{r.impact}</p>}
            <div className="mt-3"><InsightActions insight={r} size="xs" /></div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Header({ data, id }: { data?: AgentDetail; id: string }) {
  const ask = useAppStore((s) => s.setAssistantOpen);
  const meta = AGENTS.find((a) => a.id === id)!;
  const s = data?.summary;
  return (
    <div className="mb-5 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 gap-4">
        <AgentIcon id={id} size="lg" />
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.025em] sm:text-[26px]">{meta.name}</h1>
          <p className="mt-0.5 text-[14px] text-fg-2">{s?.question ?? " "}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-fg-3">
            {s && <AgentStatusBadge status={s.status} />}
            {s && <span>Last analysis <LastAnalysis at={s.lastAnalysis} /></span>}
            {s && <span className="hidden sm:inline">Data sources: {s.dataSources.join(" · ")}</span>}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {s && (
          <div className="w-44 rounded-xl border border-border bg-surface p-3 shadow-xs">
            <div className="flex items-baseline justify-between">
              <span className="text-[11.5px] text-fg-3">Domain health</span>
              <span className={cn("text-[11.5px] tabular", s.health >= s.healthPrev ? "text-good-text" : "text-crit-text")}>{s.health >= s.healthPrev ? "+" : ""}{Math.round(s.health - s.healthPrev)}</span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-[24px] font-semibold tracking-tight tabular">{Math.round(s.health)}</span>
              <span className="text-[12px] text-fg-3">{s.healthLabel}</span>
            </div>
            <Meter value={s.health} className="mt-1.5" label="Domain health" />
          </div>
        )}
        <Button variant="secondary" onClick={() => ask(true, `Summarise what the ${meta.name} found and what I should do.`)}>
          <Sparkles className="!text-accent" /> Ask
        </Button>
      </div>
    </div>
  );
}

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const valid = AGENTS.some((a) => a.id === id);
  const { data, error, isLoading, refetch, isFetching } = useAgent(id);
  const tab = sp.get("tab") ?? "overview";
  const tableParams = useMemo(() => {
    const p: Record<string, string> = {};
    sp.forEach((v, k) => { if (!["tab", "insight", "product", "cluster", "article", "campaign"].includes(k)) p[k] = v; });
    return p;
  }, [sp]);
  if (!valid) notFound();
  const setTab = (t: string) => {
    const p = new URLSearchParams();
    p.set("tab", t);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const View = VIEWS[id as keyof typeof VIEWS];
  const findings = data?.insights.filter((i) => i.status !== "dismissed") ?? [];
  return (
    <div>
      <Header data={data} id={id} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-5">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
              {t.key === "findings" && findings.length > 0 && <span className="rounded-full bg-surface-3 px-1.5 text-[11px] tabular text-fg-2">{findings.length}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        {error && !data ? <ErrorState error={error} onRetry={() => refetch()} /> : (
          <div className={cn("transition-opacity", isFetching && !isLoading && "opacity-80")}>
            <TabsContent value="overview">
              {data ? <View view={data.view} insights={data.insights} range={data.range} /> : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}</div>
                  <AnalysisState label={`${AGENTS.find((a) => a.id === id)?.short} agent is analysing`} />
                  <Card><CardBody className="pt-5"><ChartSkeleton /></CardBody></Card>
                </div>
              )}
            </TabsContent>
            <TabsContent value="findings">
              {!data ? <AnalysisState /> : findings.length === 0 ? (
                <EmptyState icon={CircleCheck} title="Nothing unusual detected" description="This agent checked every record in its domain and found no anomalies. It keeps monitoring continuously." />
              ) : (
                <div className="grid gap-4 xl:grid-cols-2">{findings.map((i) => <InsightCard key={i.id} insight={i} defaultOpen={sp.get("insight") === i.id} />)}</div>
              )}
            </TabsContent>
            <TabsContent value="changes">
              {data && (
                <div className="grid gap-4 lg:grid-cols-12">
                  <div className="lg:col-span-8">
                    {data.changes?.length ? <ChangesTable changes={data.changes} /> : <EmptyState icon={Lightbulb} title="No period comparison for this agent" description="This agent tracks point-in-time signals; see the Overview for the latest state." />}
                  </div>
                  <div className="lg:col-span-4">
                    <HealthBreakdown items={data.view.healthBreakdown} />
                    <Card className="mt-4">
                      <CardHeader title="Headline metric" />
                      <CardBody>
                        <div className="text-[26px] font-semibold tabular">{formatValue(data.summary.headline.value, data.summary.headline.unit)}</div>
                        <div className="text-[12.5px] text-fg-3">{data.summary.headline.label} · {data.range.label}</div>
                      </CardBody>
                    </Card>
                  </div>
                </div>
              )}
            </TabsContent>
            <TabsContent value="recommendations">{data && <Recommendations insights={data.insights} />}</TabsContent>
            <TabsContent value="activity">
              {data && (
                <Card className="py-3"><ActivityFeed items={data.activity} showAgent={false} /></Card>
              )}
            </TabsContent>
            <TabsContent value="data">{data && <AgentData key={sp.toString()} id={id} view={data.view} params={tableParams} />}</TabsContent>
            <TabsContent value="settings">{data && <AgentSettingsForm agent={data.summary} settings={data.settings} />}</TabsContent>
          </div>
        )}
      </Tabs>
    </div>
  );
}

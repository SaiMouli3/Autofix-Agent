"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Layers, MessageSquare } from "lucide-react";
import { relativeTime } from "@/lib/format";
import { useList } from "@/lib/queries";
import type { Insight, Range, Row, View } from "@/lib/types";
import { BarChart, TrendChart } from "@/components/charts/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/overlay";
import { RowsSkeleton } from "@/components/states/states";
import { AiCallout, ChartCard, KpiStrip } from "./common";

function ClusterSheet({ cluster, onClose }: { cluster: Row | null; onClose: () => void }) {
  const { data, isLoading } = useList("complaints", { cluster: cluster?.key, pageSize: 50, sort: "createdAt" }, !!cluster);
  return (
    <Sheet open={!!cluster} onOpenChange={(o) => !o && onClose()} title={cluster?.title ?? ""} description={cluster ? `${cluster.count} complaints · ${cluster.open} open · ${cluster.escalated} escalated` : ""}>
      {cluster && (
        <div className="space-y-5 p-5">
          <div className="rounded-xl border border-accent-border bg-accent-soft p-4">
            <div className="eyebrow mb-1 !text-accent-text">AI root cause</div>
            <p className="text-[13.5px] leading-relaxed">{cluster.rootCause}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(cluster.channels as Record<string, number>).map(([k, v]) => <Badge key={k} tone="outline">{k}: {v}</Badge>)}
          </div>
          <div>
            <div className="eyebrow mb-2">Tickets in this cluster</div>
            {isLoading ? <RowsSkeleton rows={5} cols={3} /> : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {data?.rows.map((t) => (
                  <li key={t.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{t.subject}</span>
                      <Badge tone={t.status === "resolved" ? "good" : t.status === "open" ? "crit" : "warn"}>{t.status}</Badge>
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-fg-2">{t.message}</p>
                    <p className="mt-1 text-[11.5px] text-fg-3">{t.customer} · {t.channel} · {relativeTime(t.createdAt)}{t.escalated ? " · Escalated" : ""}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function SupportView({ view, insights, range }: { view: View; insights: Insight[]; range: Range }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const clusters = view.clusters as Row[];
  const openKey = sp.get("cluster");
  const openCluster = clusters.find((c) => c.key === openKey) ?? null;
  const setCluster = (k: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (k) p.set("cluster", k); else p.delete("cluster");
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const top = clusters[0];
  const frt = insights.find((i) => i.title.startsWith("First response"));
  return (
    <div className="space-y-4">
      <KpiStrip kpis={view.kpis} cols={6} />
      {top && (
        <div className="card flex flex-col gap-4 overflow-hidden p-5 sm:flex-row sm:items-center">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-crit-soft text-crit-text"><Layers className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="eyebrow">AI root-cause analysis</div>
            <p className="mt-1 text-[16px] font-semibold tracking-[-0.01em]">{top.count} complaints share the same underlying issue</p>
            <p className="mt-0.5 text-[13px] text-fg-2">{top.title} — {top.rootCause}</p>
          </div>
          <Button variant="primary" onClick={() => setCluster(top.key)}>Open cluster</Button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Complaint volume" question="Are complaints rising faster than general enquiries?" className="lg:col-span-8">
          <TrendChart data={view.trend} granularity={range.granularity} height={250} stacked
            series={[
              { key: "complaints", label: "Complaints", color: "var(--series-8)", type: "bar" },
              { key: "inquiries", label: "Enquiries", color: "var(--series-muted)", type: "bar" },
            ]} />
        </ChartCard>
        <ChartCard title="Complaint categories" question="What are customers contacting you about?" className="lg:col-span-4">
          <BarChart data={view.categories} labelKey="category" valueKey="count" tooltipLabel="Tickets"
            onSelect={(d) => router.push(`/agents/support?tab=data&category=${encodeURIComponent(String(d.category))}`)} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Recurring issue clusters" question="Which complaints share one root cause? Fix the cause once." className="lg:col-span-7">
          <ul className="divide-y divide-border">
            {clusters.map((c) => (
              <li key={c.key}>
                <button onClick={() => setCluster(c.key)} className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-surface-2">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-[13px] font-semibold tabular">{c.count}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{c.title}</span>
                    <span className="block truncate text-[12px] text-fg-3">{c.open} open · {c.escalated} escalated · {Object.keys(c.channels).join(", ")}</span>
                  </span>
                  <MessageSquare className="size-4 text-fg-3" />
                </button>
              </li>
            ))}
          </ul>
        </ChartCard>
        <ChartCard title="SLA performance by channel" question={`Share of tickets answered within ${view.sla.firstResponseHours}h and resolved within ${view.sla.resolutionHours}h`} className="lg:col-span-5">
          <BarChart data={view.channels} labelKey="channel" valueKey="withinSla" unit="percent" tooltipLabel="Within SLA"
            colorFor={(d) => (Number(d.withinSla) < 75 ? "var(--crit)" : "var(--series-1)")} refLine={{ y: 90, label: "Target" }} />
          <AiCallout insight={frt} className="mt-4" />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Resolution rate" question="What share of tickets raised each period are already resolved?">
          <TrendChart data={view.trend} granularity={range.granularity} unit="percent" height={220} refLines={[{ y: 90, label: "Target 90%" }]}
            series={[{ key: "resolutionRate", label: "Resolved", color: "var(--series-3)", unit: "percent" }]} />
        </ChartCard>
        <ChartCard title="Support workload" question="How old is the open backlog?">
          <BarChart data={view.backlogAge} labelKey="age" valueKey="count" horizontal={false} height={220} tooltipLabel="Open tickets"
            colorFor={(d) => (d.age === "3+ days" ? "var(--crit)" : d.age === "1–3 days" ? "var(--warn)" : "var(--series-1)")} />
        </ChartCard>
      </div>
      <ClusterSheet cluster={openCluster} onClose={() => setCluster(null)} />
    </div>
  );
}

"use client";

import { cn } from "@/lib/cn";
import { formatChange, formatValue, changeTone } from "@/lib/format";
import type { Change, Insight, KPI } from "@/lib/types";
import { KpiCard } from "@/components/agents/primitives";
import { ScoreBars } from "@/components/charts/special";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Lightbulb } from "lucide-react";

export function KpiStrip({ kpis, cols = 4, className }: { kpis: KPI[]; cols?: 3 | 4 | 6 | 8 | 7 | 5; className?: string }) {
  const grid = {
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-3 lg:grid-cols-5",
    6: "sm:grid-cols-3 xl:grid-cols-6",
    7: "sm:grid-cols-4 xl:grid-cols-7",
    8: "sm:grid-cols-4 xl:grid-cols-8",
  }[cols];
  return (
    <div className={cn("grid grid-cols-2 gap-3", grid, className)}>
      {kpis.map((k) => <KpiCard key={k.key} kpi={k} className="animate-rise" />)}
    </div>
  );
}

/** A chart card whose title states the business question it answers. */
export function ChartCard({ title, question, children, action, className, bodyClassName, id }: {
  title: string; question?: string; children: React.ReactNode; action?: React.ReactNode; className?: string; bodyClassName?: string; id?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)} id={id}>
      <CardHeader title={title} description={question} action={action} />
      <CardBody className={cn("flex-1", bodyClassName)}>{children}</CardBody>
    </Card>
  );
}

/** Inline AI callout that sits beside the chart it explains. */
export function AiCallout({ insight, fallback, className }: { insight?: Insight; fallback?: string; className?: string }) {
  if (!insight && !fallback) return null;
  return (
    <div className={cn("flex gap-3 rounded-xl border border-accent-border bg-accent-soft p-4", className)}>
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface text-accent shadow-xs"><Lightbulb className="size-3.5" /></span>
      <div className="min-w-0 text-[13px] leading-relaxed">
        {insight ? (
          <>
            <p className="font-semibold text-fg">{insight.title}</p>
            {insight.likelyCause && <p className="mt-0.5 text-fg-2">Main contributor: {insight.likelyCause}</p>}
            <p className="mt-1 text-fg-2"><span className="font-medium text-fg">Recommended:</span> {insight.recommendation}</p>
          </>
        ) : (
          <p className="text-fg-2">{fallback}</p>
        )}
      </div>
    </div>
  );
}

export function HealthBreakdown({ items, title = "Health breakdown", className }: { items?: { label: string; score: number }[]; title?: string; className?: string }) {
  if (!items?.length) return null;
  return (
    <Card className={className}>
      <CardHeader title={title} description="How this agent scores its domain (0–100)" />
      <CardBody><ScoreBars items={items} /></CardBody>
    </Card>
  );
}

export function ChangesTable({ changes }: { changes: Change[] }) {
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-[13px]">
        <thead className="bg-surface-2 text-left text-[11.5px] text-fg-3">
          <tr>
            <th className="px-5 py-2.5 font-medium">Metric</th>
            <th className="px-5 py-2.5 text-right font-medium">Previous</th>
            <th className="px-5 py-2.5 text-right font-medium">Current</th>
            <th className="px-5 py-2.5 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {changes.map((c) => {
            const tone = changeTone(c.change, c.direction);
            return (
              <tr key={c.label} className="hover:bg-surface-2">
                <td className="px-5 py-3 font-medium">{c.label}</td>
                <td className="px-5 py-3 text-right tabular text-fg-3">{formatValue(c.prev, c.unit)}</td>
                <td className="px-5 py-3 text-right tabular">{formatValue(c.cur, c.unit)}</td>
                <td className={cn("px-5 py-3 text-right font-medium tabular", tone === "good" && "text-good-text", tone === "bad" && "text-crit-text", tone === "neutral" && "text-fg-3")}>
                  {formatChange(c.change, c.unit)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function find(insights: Insight[], pred: (i: Insight) => boolean) {
  return insights.find(pred);
}

/** A ranked list with a mini bar, used for top/worst product lists etc. */
export function RankList({ items, value, label, unit = "number", sub, onSelect, empty = "Nothing to show." }: {
  items: Record<string, unknown>[]; value: string; label: string; unit?: string; sub?: (d: Record<string, unknown>) => React.ReactNode;
  onSelect?: (d: Record<string, unknown>) => void; empty?: string;
}) {
  if (!items.length) return <p className="py-6 text-center text-[12.5px] text-fg-3">{empty}</p>;
  const max = Math.max(...items.map((d) => Math.abs(Number(d[value] ?? 0))), 1);
  return (
    <ul className="space-y-0.5">
      {items.map((d, i) => (
        <li key={i}>
          <button type="button" onClick={onSelect ? () => onSelect(d) : undefined} className={cn("w-full rounded-lg px-2 py-2 text-left hover:bg-surface-3", !onSelect && "cursor-default")}>
            <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="min-w-0 truncate font-medium">{String(d[label])}</span>
              <span className="shrink-0 tabular">{formatValue(Number(d[value] ?? 0), unit)}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${(Math.abs(Number(d[value] ?? 0)) / max) * 100}%` }} />
              </div>
              {sub && <span className="shrink-0 text-[11px] text-fg-3">{sub(d)}</span>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, ArrowDownRight, Lightbulb, Sparkles, TrendingUp } from "lucide-react";
import { agentHref, agentMeta, SEVERITY } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { clockTime, formatChange, formatValue, usd } from "@/lib/format";
import { useInsights } from "@/lib/queries";
import type { BusinessInsight, Severity } from "@/lib/types";
import { AgentIcon } from "@/components/agents/primitives";
import { InsightCard, InsightSheet } from "@/components/agents/insights";
import { PageHeader } from "@/components/layout/topbar";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { AnalysisState, ErrorState } from "@/components/states/states";

type Group = "all" | "critical" | "important" | "opportunity" | "info";

function groupOf(s: Severity): Group {
  if (s === "market" || s === "info") return "info";
  return s;
}

function ActionRow({ b, i }: { b: BusinessInsight; i: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button onClick={() => setOpen(true)} className="flex w-full gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-surface-3">
        <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold text-white", SEVERITY[b.severity].dot)}>{i + 1}</span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium leading-snug">{b.recommendation}</span>
          <span className="mt-0.5 block text-[11.5px] text-fg-3">{b.title}{b.impactValue ? ` · ${usd(Math.abs(b.impactValue))}/mo` : ""}</span>
        </span>
      </button>
      <InsightSheet insight={b} open={open} onOpenChange={setOpen} />
    </li>
  );
}

export default function InsightsPage() {
  const { data, error, refetch } = useInsights();
  const [group, setGroup] = useState<Group>("all");
  const [showDismissed, setShowDismissed] = useState(false);
  if (error && !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const all = data?.insights ?? [];
  const active = all.filter((b) => b.status !== "dismissed" && b.status !== "resolved");
  const list = (showDismissed ? all : active).filter((b) => group === "all" || groupOf(b.severity) === group);
  const counts = { critical: 0, important: 0, opportunity: 0, info: 0 } as Record<Exclude<Group, "all">, number>;
  for (const b of active) counts[groupOf(b.severity) as Exclude<Group, "all">]++;
  const risks = active.filter((b) => b.category !== "opportunity" && b.chain.length > 1);
  const opps = active.filter((b) => b.severity === "opportunity");
  const actions = active.filter((b) => b.severity !== "opportunity").slice(0, 5);

  return (
    <div>
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-text"><Sparkles className="size-3" /> Business Insights Agent</span>}
        title="What should you do next?"
        description="The CEO-level layer. It reads every agent's findings, connects related signals, reasons about cause and effect, and ranks actions by business impact."
      />

      {/* Executive brief */}
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-accent-border bg-surface p-6 shadow-xs">
        <div className="pointer-events-none absolute inset-0 [background:radial-gradient(80%_100%_at_100%_0%,var(--accent-soft),transparent_60%)]" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <div className="eyebrow mb-2">Executive brief · {data ? `${data.range.label}` : "…"}</div>
            {data ? <p className="text-[16px] leading-relaxed tracking-[-0.005em] text-fg sm:text-[17px]">{data.brief}</p> : <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-3/5" /></div>}
            {data && <p className="mt-2 text-[11.5px] text-fg-3">{data.briefEngine === "deterministic" ? "Composed from agent findings" : `Written by ${data.briefEngine} from agent findings`} · updated {clockTime(new Date())}</p>}
          </div>
          <div className="grid shrink-0 grid-cols-4 gap-2 lg:grid-cols-2">
            {(["critical", "important", "opportunity", "info"] as const).map((k) => (
              <button key={k} onClick={() => setGroup(k)} className={cn("rounded-xl border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong", group === k && "border-fg")}>
                <div className={cn("text-[20px] font-semibold tabular", k === "critical" && counts[k] > 0 && "text-crit-text")}>{data ? counts[k] : "–"}</div>
                <div className="text-[11px] text-fg-3">{k === "info" ? "Informational" : SEVERITY[k].label}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The four questions */}
      <div className="mb-8 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <Card>
          <CardHeader title="What changed?" description="Largest moves across all agents" />
          <CardBody>
            {!data ? <AnalysisState label="Comparing periods" /> : (
              <ul className="space-y-2">
                {data.changes.map((c, i) => (
                  <li key={i} className="flex items-center gap-2.5 text-[12.5px]">
                    <AgentIcon id={c.agentId} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-fg-2">{c.label}</span>
                    <span className="tabular text-fg-3">{formatValue(c.cur, c.unit)}</span>
                    <span className={cn("inline-flex w-[68px] items-center justify-end gap-0.5 font-medium tabular", c.good ? "text-good-text" : "text-crit-text")}>
                      {c.change > 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{formatChange(c.change, c.unit).replace(/^[+−]/, "")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Why did it change?" description="Causes the agent connected across domains" />
          <CardBody>
            {!data ? <AnalysisState label="Reasoning" /> : (
              <ul className="space-y-3">
                {risks.slice(0, 4).map((b) => (
                  <li key={b.id} className="text-[12.5px]">
                    <div className="font-medium leading-snug">{b.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-fg-3">
                      {b.chain.map((s, i) => (
                        <span key={s.insightId} className="inline-flex items-center gap-1">
                          {i > 0 && <ArrowRight className="size-3" />}
                          <span style={{ color: agentMeta(s.agentId).hue }}>●</span>{agentMeta(s.agentId).short}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1 text-fg-2">{b.whyChanged}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What should you do?" description="Prioritised by severity and impact" />
          <CardBody className="px-3">
            {!data ? <div className="px-2"><AnalysisState label="Prioritising" /></div> : <ol className="space-y-0.5">{actions.map((b, i) => <ActionRow key={b.id} b={b} i={i} />)}</ol>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What opportunities exist?" description="Upside the agents found" />
          <CardBody>
            {!data ? <AnalysisState label="Searching for upside" /> : opps.length === 0 ? <p className="text-[12.5px] text-fg-3">No new opportunities this period.</p> : (
              <ul className="space-y-3">
                {opps.slice(0, 4).map((b) => (
                  <li key={b.id} className="flex gap-2.5 text-[12.5px]">
                    <TrendingUp className="mt-0.5 size-4 shrink-0 text-good-text" />
                    <div className="min-w-0">
                      <div className="font-medium leading-snug">{b.title}</div>
                      {b.impactValue > 0 && <div className="mt-0.5 font-medium text-good-text">+{usd(b.impactValue)}/mo potential</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Full list */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">All insights</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={group} onChange={setGroup} ariaLabel="Filter by priority"
            options={[{ value: "all", label: "All" }, { value: "critical", label: "Critical" }, { value: "important", label: "Important" }, { value: "opportunity", label: "Opportunity" }, { value: "info", label: "Informational" }]} />
          <label className="flex items-center gap-1.5 text-[12.5px] text-fg-2">
            <input type="checkbox" className="accent-[var(--accent)]" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} /> Show dismissed
          </label>
        </div>
      </div>
      {!data ? (
        <div className="grid gap-4 xl:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <AnalysisState key={i} />)}</div>
      ) : list.length === 0 ? (
        <Card className="py-12 text-center text-[13px] text-fg-3"><Lightbulb className="mx-auto mb-2 size-5" />No insights in this group.</Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {list.map((b) => (
            <div key={b.id} className="flex flex-col">
              {b.chain.length > 1 && (
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-fg-3">
                  Connected from
                  {b.chain.map((s) => (
                    <Link key={s.insightId} href={`${agentHref(s.agentId)}?tab=findings`} className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5 hover:border-border-strong">
                      <span style={{ color: agentMeta(s.agentId).hue }}>●</span> {agentMeta(s.agentId).short}
                    </Link>
                  ))}
                </div>
              )}
              <InsightCard insight={b} className="flex-1" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

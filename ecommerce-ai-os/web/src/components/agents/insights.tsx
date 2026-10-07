"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, ArrowUpRight, Check, ChevronRight, CircleDot, Lightbulb, Search, Sparkles, Undo2, UserPlus, X, Zap } from "lucide-react";
import { agentHref, agentMeta, SEVERITY } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { clockTime, inr, relativeTime } from "@/lib/format";
import { useCreateAction, useUpdateInsight } from "@/lib/queries";
import type { Action, BusinessInsight, Evidence, Insight } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, Sheet } from "@/components/ui/overlay";
import { Input, Label } from "@/components/ui/input";
import { AgentIcon, SeverityBadge } from "./primitives";

const actionKind: Record<string, string> = { inventory: "purchase_order", marketing: "budget_shift", customers: "campaign", insights: "campaign" };

function applyKind(insight: Insight, label: string): string {
  if (/purchase order/i.test(label)) return "purchase_order";
  if (/budget/i.test(label)) return "budget_shift";
  if (/campaign/i.test(label)) return "campaign";
  return actionKind[insight.agentId] ?? "investigate";
}

/** Shared handlers for insight CTAs: navigate, assign, dismiss, apply. */
export function useInsightActions(insight: Insight) {
  const router = useRouter();
  const update = useUpdateInsight();
  const create = useCreateAction();
  const [assignOpen, setAssignOpen] = useState(false);

  const run = (a: Action) => {
    switch (a.intent) {
      case "assign":
        setAssignOpen(true);
        return;
      case "dismiss":
        update.mutate(
          { id: insight.id, status: "dismissed", agentId: insight.agentId, title: insight.title },
          {
            onSuccess: () =>
              toast("Insight dismissed", {
                description: "The agent will keep monitoring and resurface it if the signal grows.",
                action: { label: "Undo", onClick: () => update.mutate({ id: insight.id, status: "new", agentId: insight.agentId, title: insight.title }) },
              }),
          },
        );
        return;
      case "apply": {
        const kind = applyKind(insight, a.label);
        create.mutate(
          { kind, agentId: insight.agentId, insightId: insight.id, detail: insight.entity?.name ?? insight.title },
          {
            onSuccess: () =>
              toast.success(
                { purchase_order: "Purchase order drafted", budget_shift: "Budget shift queued for approval", campaign: "Campaign draft created", investigate: "Investigation opened" }[kind] ?? "Done",
                { description: `Logged to the ${agentMeta(insight.agentId).short} agent's activity. The agent will measure the result.` },
              ),
            onError: (e) => toast.error((e as Error).message),
          },
        );
        return;
      }
      default:
        if (a.href) router.push(a.href);
        else router.push(`${agentHref(insight.agentId)}?tab=findings`);
    }
  };

  const assignDialog = (
    <AssignDialog
      open={assignOpen}
      onOpenChange={setAssignOpen}
      onAssign={(who) =>
        update.mutate(
          { id: insight.id, status: "assigned", assignee: who, agentId: insight.agentId, title: insight.title },
          { onSuccess: () => { setAssignOpen(false); toast.success(`Assigned to ${who}`); } },
        )
      }
      pending={update.isPending}
      title={insight.title}
    />
  );
  return { run, assignDialog, pending: update.isPending || create.isPending };
}

const TEAM = ["Operations team", "Marketing team", "CX team", "Procurement", "Finance team"];

function AssignDialog({ open, onOpenChange, onAssign, pending, title }: { open: boolean; onOpenChange: (o: boolean) => void; onAssign: (w: string) => void; pending: boolean; title: string }) {
  const [who, setWho] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Assign insight" description={title}>
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (who.trim()) onAssign(who.trim());
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="assignee">Owner</Label>
            <Input id="assignee" autoFocus value={who} maxLength={80} onChange={(e) => setWho(e.target.value)} placeholder="Name or team" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TEAM.map((t) => (
              <button type="button" key={t} onClick={() => setWho(t)} className={cn("rounded-full border border-border px-2.5 py-1 text-[12px] text-fg-2 hover:bg-surface-3", who === t && "border-accent text-accent-text")}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!who.trim() || pending}>Assign</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const intentIcon = { investigate: Search, view: ArrowUpRight, assign: UserPlus, dismiss: X, apply: Zap, generate: Sparkles } as const;

export function InsightActions({ insight, size = "sm", max = 3, onAction }: { insight: Insight; size?: "sm" | "xs"; max?: number; onAction?: () => void }) {
  const { run, assignDialog, pending } = useInsightActions(insight);
  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {insight.actions.slice(0, max).map((a, i) => {
        const Icon = intentIcon[a.intent] ?? ArrowRight;
        return (
          <Button key={a.label} size={size} variant={i === 0 ? "primary" : "secondary"} disabled={pending}
            onClick={() => { run(a); onAction?.(); }}>
            <Icon /> {a.label}
          </Button>
        );
      })}
      {assignDialog}
    </div>
  );
}

export function EvidenceList({ evidence, className }: { evidence: Evidence[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2", className)}>
      {evidence.map((e) => (
        <div key={e.label} className="bg-surface px-3 py-2.5">
          <dt className="text-[11.5px] text-fg-3">{e.label}</dt>
          <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[13.5px] font-semibold tabular">
            {e.value}
            {e.change !== undefined && (
              <span className={cn("text-[11.5px] font-medium", e.tone === "bad" ? "text-crit-text" : e.tone === "good" ? "text-good-text" : "text-fg-3")}>
                {e.change > 0 ? "+" : ""}
                {e.change}
                {e.unit === "pct" ? "%" : e.unit === "pts" ? " pts" : ""}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StatusChip({ insight }: { insight: Insight }) {
  if (insight.status === "assigned")
    return <span className="inline-flex items-center gap-1 text-[11.5px] text-accent-text"><UserPlus className="size-3" /> {insight.assignee}</span>;
  if (insight.status === "resolved") return <span className="inline-flex items-center gap-1 text-[11.5px] text-good-text"><Check className="size-3" /> Resolved</span>;
  return null;
}

/** Compact priority item used on the dashboard. */
export function PriorityItem({ insight, index }: { insight: BusinessInsight | Insight; index: number }) {
  const [open, setOpen] = useState(false);
  const agent = agentMeta((insight.sources?.[0] as string) ?? insight.agentId);
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen(true))}
        className="group relative flex cursor-pointer gap-4 px-5 py-4 transition-colors hover:bg-surface-2 animate-rise"
        style={{ animationDelay: `${index * 40}ms` }}
      >
        <span className={cn("absolute inset-y-3 left-0 w-[3px] rounded-r-full", SEVERITY[insight.severity].dot)} aria-hidden />
        <AgentIcon id={agent.id} size="md" className="mt-0.5 hidden sm:grid" />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="eyebrow !text-[10.5px]">{insight.sources && insight.sources.length > 1 ? `${insight.sources.length} agents` : agent.short}</span>
            <SeverityBadge severity={insight.severity} />
            <span className="text-[11.5px] text-fg-3">{relativeTime(insight.detectedAt)}</span>
            <StatusChip insight={insight} />
          </div>
          <p className="text-[14px] font-semibold leading-snug tracking-[-0.005em]">{insight.title}</p>
          <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-fg-2">{insight.summary}</p>
          {insight.likelyCause && (
            <p className="mt-1.5 line-clamp-1 text-[12.5px] text-fg-3">
              <span className="font-medium text-fg-2">Likely cause:</span> {insight.likelyCause}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <InsightActions insight={insight} size="xs" max={2} />
            {insight.impactValue !== 0 && (
              <span className={cn("text-[12px] font-medium tabular", insight.impactValue < 0 ? "text-crit-text" : "text-good-text")}>
                {insight.impactValue < 0 ? "" : "+"}
                {inr(insight.impactValue)}/mo impact
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <InsightSheet insight={insight} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Full insight card used in agent "Findings" and recommendations lists. */
export function InsightCard({ insight, className, defaultOpen }: { insight: Insight | BusinessInsight; className?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <>
      <article
        className={cn("card group relative cursor-pointer overflow-hidden p-5 transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-card", insight.status === "dismissed" && "opacity-60", className)}
        onClick={() => setOpen(true)}
      >
        <span className={cn("absolute inset-x-0 top-0 h-[2px]", SEVERITY[insight.severity].dot)} aria-hidden />
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={insight.severity} />
          <span className="text-[11.5px] text-fg-3">Detected {clockTime(insight.detectedAt)} · {Math.round(insight.confidence * 100)}% confidence</span>
          <StatusChip insight={insight} />
        </div>
        <h4 className="mt-2.5 text-[15px] font-semibold leading-snug tracking-[-0.01em]">{insight.title}</h4>
        <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">{insight.summary}</p>
        {insight.evidence.length > 0 && <EvidenceList evidence={insight.evidence.slice(0, 4)} className="mt-4" />}
        <div className="mt-4 rounded-lg border border-accent-border bg-accent-soft px-3.5 py-2.5">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-accent-text"><Lightbulb className="size-3.5" /> Recommended action</div>
          <p className="mt-1 text-[13px] leading-relaxed text-fg">{insight.recommendation}</p>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <InsightActions insight={insight} />
          {insight.impact && <span className="text-[12px] text-fg-3">{insight.impact}</span>}
        </div>
      </article>
      <InsightSheet insight={insight} open={open} onOpenChange={setOpen} />
    </>
  );
}

const STEPS = [
  { key: "observation", label: "Observation" },
  { key: "evidence", label: "Evidence" },
  { key: "cause", label: "Likely cause" },
  { key: "impact", label: "Business impact" },
  { key: "action", label: "Recommended action" },
];

/** Drill-down drawer that walks Observation → Evidence → Cause → Impact → Action. */
export function InsightSheet({ insight, open, onOpenChange }: { insight: Insight | BusinessInsight; open: boolean; onOpenChange: (o: boolean) => void }) {
  const chain = (insight as BusinessInsight).chain;
  const { run } = useInsightActions(insight);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={insight.title}
      description={<span className="inline-flex flex-wrap items-center gap-2"><SeverityBadge severity={insight.severity} /> {agentMeta(insight.agentId).name} · {relativeTime(insight.detectedAt)}</span>}>
      <div className="space-y-0 px-5 py-5">
        {STEPS.map((step, i) => {
          let body: React.ReactNode = null;
          if (step.key === "observation") body = <p className="text-[13.5px] leading-relaxed text-fg">{insight.summary}</p>;
          if (step.key === "evidence") body = insight.evidence.length ? <EvidenceList evidence={insight.evidence} /> : <p className="text-[13px] text-fg-3">No additional evidence.</p>;
          if (step.key === "cause") body = <p className="text-[13.5px] leading-relaxed text-fg-2">{insight.likelyCause || (insight as BusinessInsight).whyChanged || "The agent is still gathering signals to explain this change."}</p>;
          if (step.key === "impact")
            body = (
              <div>
                {insight.impactValue !== 0 && (
                  <div className={cn("text-[22px] font-semibold tracking-tight tabular", insight.impactValue < 0 ? "text-crit-text" : "text-good-text")}>
                    {insight.impactValue > 0 ? "+" : ""}
                    {inr(insight.impactValue)}<span className="text-[13px] font-medium text-fg-3"> / month</span>
                  </div>
                )}
                <p className="text-[13px] leading-relaxed text-fg-2">{insight.impact || "Not quantified yet."}</p>
              </div>
            );
          if (step.key === "action")
            body = (
              <div className="rounded-lg border border-accent-border bg-accent-soft p-3.5">
                <p className="text-[13.5px] leading-relaxed text-fg">{insight.recommendation}</p>
                <div className="mt-3"><InsightActions insight={insight} max={4} onAction={() => onOpenChange(false)} /></div>
              </div>
            );
          return (
            <div key={step.key} className="relative flex gap-4 pb-6 last:pb-0">
              {i < STEPS.length - 1 && <span className="absolute left-[11px] top-7 h-[calc(100%-20px)] w-px bg-border" aria-hidden />}
              <span className="relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-border bg-surface text-[11px] font-semibold text-fg-2">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="eyebrow mb-2">{step.label}</div>
                {body}
              </div>
            </div>
          );
        })}
        {chain && chain.length > 1 && (
          <div className="mt-8 rounded-xl border border-border bg-surface-2 p-4">
            <div className="mb-3 flex items-center gap-2 text-[12.5px] font-semibold"><Sparkles className="size-4 text-accent" /> How the Business Insights agent connected this</div>
            <ol className="space-y-2.5">
              {chain.map((s) => (
                <li key={s.insightId} className="flex items-start gap-2.5">
                  <AgentIcon id={s.agentId} size="sm" />
                  <div className="min-w-0">
                    <div className="text-[11.5px] text-fg-3">{agentMeta(s.agentId).name}</div>
                    <Link href={`${agentHref(s.agentId)}?tab=findings`} className="text-[13px] leading-snug hover:underline" onClick={() => onOpenChange(false)}>{s.finding}</Link>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        {insight.status === "dismissed" && (
          <Button variant="secondary" size="sm" className="mt-6" onClick={() => run({ label: "Reopen", intent: "view" })}>
            <Undo2 /> Dismissed — view agent
          </Button>
        )}
      </div>
    </Sheet>
  );
}

export function ActivityFeed({ items, className, showAgent = true, limit }: { items: { id: string; agentId: string; at: string; kind: string; message: string; severity?: string }[]; className?: string; showAgent?: boolean; limit?: number }) {
  const list = limit ? items.slice(0, limit) : items;
  if (!list.length) return <p className="px-5 py-8 text-center text-[13px] text-fg-3">No activity yet — agents log every scan and detection here.</p>;
  return (
    <ol className={cn("relative", className)}>
      {list.map((a, i) => {
        const meta = agentMeta(a.agentId);
        const important = a.kind === "detection" || a.kind === "recommendation" || a.kind === "action";
        return (
          <li key={a.id + i} className="relative flex gap-3 px-5 py-2.5 animate-fade-in">
            {i < list.length - 1 && <span className="absolute left-[29px] top-6 h-full w-px bg-border" aria-hidden />}
            <span className="relative z-10 mt-1.5 grid size-[9px] shrink-0 place-items-center">
              <span className={cn("size-[9px] rounded-full border-2 border-surface", a.severity ? SEVERITY[a.severity as keyof typeof SEVERITY]?.dot : a.kind === "action" ? "bg-accent" : "bg-border-strong")} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-[11.5px] text-fg-3">
                <time className="tabular" dateTime={a.at}>{clockTime(a.at)}</time>
                {showAgent && <span className="truncate">{meta.short}</span>}
                {a.kind === "action" && <span className="inline-flex items-center gap-1 text-accent-text"><CircleDot className="size-3" />You</span>}
              </div>
              <p className={cn("text-[13px] leading-snug", important ? "font-medium text-fg" : "text-fg-2")}>{a.message}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

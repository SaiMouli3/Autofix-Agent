"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { agentMeta, SEVERITY, STATUS_LABEL } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { changeTone, formatChange, formatValue, relativeTime } from "@/lib/format";
import type { AgentStatus, KPI, Severity } from "@/lib/types";
import { Sparkline } from "@/components/charts/kit";
import { Tooltip } from "@/components/ui/misc";

export function AgentIcon({ id, size = "md", className }: { id: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const m = agentMeta(id);
  const Icon = m.icon;
  const box = { sm: "size-6 rounded-md [&_svg]:size-3.5", md: "size-8 rounded-lg [&_svg]:size-4", lg: "size-10 rounded-xl [&_svg]:size-5" }[size];
  return (
    <span
      className={cn("relative grid shrink-0 place-items-center border border-border bg-surface-2", box, className)}
      style={{ color: m.hue }}
      aria-hidden
    >
      <Icon />
    </span>
  );
}

export function StatusDot({ status, className }: { status: AgentStatus; className?: string }) {
  const color = {
    monitoring: "bg-good",
    analyzing: "bg-accent",
    attention: "bg-crit",
    connection_issue: "bg-warn",
    paused: "bg-fg-3",
  }[status];
  const pulse = status === "monitoring" || status === "analyzing" || status === "attention";
  return (
    <span className={cn("relative inline-flex size-2", className)} aria-hidden>
      {pulse && <span className={cn("absolute inline-flex size-full rounded-full opacity-50 animate-pulse-soft", color)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}

export function AgentStatusBadge({ status, className }: { status: AgentStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium text-fg-2", className)}>
      <StatusDot status={status} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const s = SEVERITY[severity];
  return (
    <span className={cn("inline-flex h-5 items-center gap-1.5 rounded-md px-1.5 text-[11px] font-semibold uppercase tracking-[0.04em]", s.soft, s.text, className)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function ChangePill({ change, unit, direction, className, size = "sm" }: { change: number; unit: string; direction: string; className?: string; size?: "sm" | "xs" }) {
  const tone = changeTone(change, direction);
  const Icon = Math.abs(change) < 0.05 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 whitespace-nowrap rounded-md font-medium tabular",
        size === "sm" ? "h-5 px-1.5 text-[11.5px] [&_svg]:size-3" : "text-[11px] [&_svg]:size-3",
        tone === "good" && "bg-good-soft text-good-text",
        tone === "bad" && "bg-crit-soft text-crit-text",
        tone === "neutral" && "bg-surface-3 text-fg-2",
        size === "xs" && "bg-transparent px-0",
        className,
      )}
    >
      <Icon strokeWidth={2.5} />
      {formatChange(change, unit)}
    </span>
  );
}

/** Animated count-up for headline numbers. */
export function CountUp({ value, format, duration = 700 }: { value: number; format: (v: number) => string; duration?: number }) {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      setDisplay(a + (value - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(display)}</>;
}

export function KpiCard({ kpi, featured, className, prevLabel = "previous period" }: { kpi: KPI; featured?: boolean; className?: string; prevLabel?: string }) {
  const tone = changeTone(kpi.change, kpi.direction);
  const sparkColor = tone === "bad" ? "var(--crit)" : tone === "good" ? "var(--good)" : "var(--text-3)";
  const body = (
    <div
      className={cn(
        "group relative flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-xs transition-[border-color,box-shadow,transform] duration-200",
        kpi.href && "hover:-translate-y-px hover:border-border-strong hover:shadow-card",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Tooltip content={kpi.hint}>
          <span className="text-[12.5px] font-medium text-fg-2">{kpi.label}</span>
        </Tooltip>
        {kpi.href && <ArrowUpRight className="size-3.5 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      <div>
        <div className={cn("font-semibold tracking-[-0.03em] tabular text-fg", featured ? "text-[30px] leading-9" : "text-[24px] leading-8")}>
          <CountUp value={kpi.value} format={(v) => formatValue(v, kpi.unit)} />
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-fg-3">
          <ChangePill change={kpi.change} unit={kpi.unit} direction={kpi.direction} />
          <span className="truncate">vs {formatValue(kpi.prev, kpi.unit)} {prevLabel}</span>
        </div>
      </div>
      {kpi.spark && kpi.spark.length > 1 && <Sparkline data={kpi.spark} color={sparkColor} height={featured ? 44 : 30} className="mt-auto" />}
    </div>
  );
  return kpi.href ? (
    <Link href={kpi.href} className="block rounded-xl" aria-label={`${kpi.label}: ${formatValue(kpi.value, kpi.unit)}`}>
      {body}
    </Link>
  ) : (
    body
  );
}

export function LastAnalysis({ at, className }: { at: string; className?: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return <span className={cn("tabular", className)}>{relativeTime(at)}</span>;
}

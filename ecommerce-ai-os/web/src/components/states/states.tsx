"use client";

import { CircleAlert, RefreshCw, WifiOff } from "lucide-react";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";

export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon?: React.ComponentType<{ className?: string }>; title: string; description?: string; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="mb-1 grid size-10 place-items-center rounded-xl border border-border bg-surface-2 text-fg-3">
          <Icon className="size-5" />
        </div>
      )}
      <p className="text-[14px] font-semibold text-fg">{title}</p>
      {description && <p className="max-w-sm text-[13px] leading-relaxed text-fg-3">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Errors explain what happened, why, and what the user can do. */
export function ErrorState({ error, onRetry, className, compact }: { error: unknown; onRetry?: () => void; className?: string; compact?: boolean }) {
  const e = error instanceof ApiError ? error : null;
  const network = e?.code === "network" || e?.code === "api_unavailable";
  const Icon = network ? WifiOff : CircleAlert;
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 px-6 text-center", compact ? "py-6" : "py-14", className)}>
      <div className="mb-1 grid size-10 place-items-center rounded-xl bg-crit-soft text-crit-text">
        <Icon className="size-5" />
      </div>
      <p className="text-[14px] font-semibold">{e?.message ?? "This section couldn't load."}</p>
      <p className="max-w-sm text-[13px] leading-relaxed text-fg-3">
        {e?.hint ?? "An unexpected error interrupted the analysis. Your data is safe — retrying usually fixes it."}
      </p>
      {onRetry && (
        <Button size="sm" className="mt-2" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function ChartSkeleton({ height = 240, className }: { height?: number; className?: string }) {
  const bars = [42, 58, 50, 66, 61, 72, 55, 78, 70, 84, 76, 90];
  return (
    <div className={cn("flex items-end gap-2 px-1", className)} style={{ height }} aria-label="Loading chart" role="status">
      {bars.map((h, i) => (
        <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

export function RowsSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-border" role="status" aria-label="Loading rows">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3.5" style={{ width: `${c === 0 ? 14 : c === 1 ? 22 : 10 + ((r + c) % 3) * 4}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={cn("card space-y-3 p-5", className)} role="status" aria-label="Loading">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-32" />
      {Array.from({ length: lines - 2 }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}

/** Elegant "agents are analysing" placeholder for AI sections. */
export function AnalysisState({ label = "Agents are analysing your store", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-accent-border bg-accent-soft px-5 py-6", className)} role="status">
      <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/5 [animation:scan_1.8s_ease-in-out_infinite]" />
      <div className="relative flex items-center gap-3">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
        </span>
        <span className="text-[13px] font-medium text-accent-text">{label}…</span>
      </div>
      <div className="relative mt-4 space-y-2">
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

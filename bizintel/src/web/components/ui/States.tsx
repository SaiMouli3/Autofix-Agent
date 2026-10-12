import type { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "./Button";
import { Skeleton } from "./primitives";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";

export function EmptyState({ icon, title, description, action, compact }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-14")}>
      {icon && <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg border border-border bg-subtle text-fg-3">{icon}</div>}
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description && <p className="mt-1 max-w-[420px] text-sm text-fg-2">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "Couldn’t load this data", compact }: { error: unknown; onRetry?: () => void; title?: string; compact?: boolean }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center text-center", compact ? "px-4 py-6" : "px-6 py-12")}>
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-danger-subtle text-danger">
        <AlertTriangle size={18} />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 max-w-[460px] text-sm text-fg-2">{errorMessage(error)}</p>
      {onRetry && (
        <Button className="mt-4" size="sm" icon={<RotateCw size={14} />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineAlert({ tone = "warning", title, children, action }: { tone?: "warning" | "danger" | "info" | "success"; title: string; children?: ReactNode; action?: ReactNode }) {
  const tones = {
    warning: "border-warning/30 bg-warning-subtle text-warning",
    danger: "border-danger/30 bg-danger-subtle text-danger",
    info: "border-info/25 bg-info-subtle text-info",
    success: "border-success/25 bg-success-subtle text-success",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-md border px-3 py-2.5", tones[tone])}>
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-0.5 text-fg-2">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="divide-y divide-border">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-row items-center gap-4 px-4">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={c === 0 ? "w-48" : "flex-1"} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function BlockSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-2.5 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? "w-2/3" : "w-full"} />
      ))}
    </div>
  );
}

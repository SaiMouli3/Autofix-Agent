import { useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/format";

export function Spinner({ size = 16, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg className={cn("animate-spin text-current", className)} width={size} height={size} viewBox="0 0 24 24" fill="none" role={label ? "status" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-neutral-subtle text-fg-2 border-border",
  primary: "bg-primary-subtle text-primary border-primary/20",
  success: "bg-success-subtle text-success border-success/20",
  warning: "bg-warning-subtle text-warning border-warning/25",
  danger: "bg-danger-subtle text-danger border-danger/20",
  info: "bg-info-subtle text-info border-info/20",
};

export function Badge({ tone = "neutral", icon, children, className, title }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs font-medium", toneClasses[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Chip({ children, onRemove, removeLabel }: { children: ReactNode; onRemove?: () => void; removeLabel?: string }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded border border-border bg-subtle pl-2 pr-1 text-xs text-fg">
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={removeLabel ?? "Remove"} className="grid h-4 w-4 place-items-center rounded-sm text-fg-3 hover:bg-muted hover:text-fg">
          <X size={12} />
        </button>
      )}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-subtle px-1 font-sans text-2xs font-medium text-fg-3">{children}</kbd>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

/** Accessible tooltip: shows on hover and keyboard focus; content is exposed via aria-describedby. */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            "pointer-events-none absolute left-1/2 z-popover w-max max-w-[280px] -translate-x-1/2 rounded bg-fg px-2 py-1 text-xs font-normal leading-snug text-bg shadow-md animate-pop",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  const color: Record<Tone, string> = { neutral: "bg-fg-3", primary: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info" };
  return <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", color[tone], pulse && "animate-pulse-dot")} aria-hidden />;
}

export function Meter({ value, tone = "primary", label }: { value: number; tone?: Tone; label: string }) {
  const color: Record<Tone, string> = { neutral: "bg-fg-3", primary: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info" };
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", color[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

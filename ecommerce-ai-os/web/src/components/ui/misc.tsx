"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-[5px] border border-border-strong bg-surface shadow-xs transition-colors",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-white",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full bg-border-strong transition-colors data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[80] max-w-xs rounded-md bg-fg px-2 py-1 text-[11.5px] leading-snug text-bg shadow-pop animate-fade-in"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-2 px-1 font-mono text-[10.5px] text-fg-3", className)}>
      {children}
    </kbd>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn("skeleton", className)} style={style} />;
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div role="separator" className={cn(vertical ? "w-px self-stretch bg-border" : "h-px w-full bg-border", className)} />;
}

/** A thin horizontal meter. Value 0-100. */
export function Meter({ value, tone, className, label }: { value: number; tone?: "good" | "warn" | "crit" | "accent" | "neutral"; className?: string; label?: string }) {
  const t = tone ?? (value >= 72 ? "good" : value >= 58 ? "warn" : "crit");
  const color = { good: "bg-good", warn: "bg-warn", crit: "bg-crit", accent: "bg-accent", neutral: "bg-fg-3" }[t];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)} role="meter" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out", color)} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
    </div>
  );
}

/** Segmented control for small option sets. */
export function Segmented<T extends string>({ value, onChange, options, size = "sm", className, ariaLabel }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; size?: "xs" | "sm"; className?: string; ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex items-center rounded-lg border border-border bg-surface-2 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2.5 font-medium text-fg-3 transition-colors hover:text-fg",
            size === "xs" ? "h-6 text-[11.5px]" : "h-7 text-[12.5px]",
            value === o.value && "bg-surface text-fg shadow-xs",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

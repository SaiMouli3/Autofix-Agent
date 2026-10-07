import { cn } from "@/lib/cn";

type Tone = "neutral" | "good" | "warn" | "crit" | "info" | "accent" | "outline";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-fg-2",
  good: "bg-good-soft text-good-text",
  warn: "bg-warn-soft text-warn-text",
  crit: "bg-crit-soft text-crit-text",
  info: "bg-info-soft text-info-text",
  accent: "bg-accent-soft text-accent-text",
  outline: "border border-border text-fg-2",
};

export function Badge({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium leading-none whitespace-nowrap", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

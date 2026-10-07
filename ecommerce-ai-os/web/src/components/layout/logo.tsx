import { cn } from "@/lib/cn";

/** Brand mark: three orbiting agents around a core — an operating team. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" className="fill-fg" />
      <circle cx="16" cy="16" r="3.4" className="fill-bg" />
      <circle cx="16" cy="16" r="9" fill="none" className="stroke-bg" strokeOpacity="0.35" strokeWidth="1.2" />
      <circle cx="16" cy="7" r="2.1" fill="var(--accent)" />
      <circle cx="23.8" cy="20.5" r="2.1" className="fill-bg" />
      <circle cx="8.2" cy="20.5" r="2.1" className="fill-bg" fillOpacity="0.7" />
    </svg>
  );
}

export function Logo({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      {!collapsed && (
        <span className="flex flex-col leading-none">
          <span className="text-[14px] font-semibold tracking-[-0.02em]">E-commerce AI OS</span>
          <span className="mt-0.5 text-[10.5px] text-fg-3">Your AI operating team</span>
        </span>
      )}
    </span>
  );
}

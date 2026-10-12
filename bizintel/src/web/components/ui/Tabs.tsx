import { useRef, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/format";

export interface TabDef {
  key: string;
  label: ReactNode;
  count?: number | null;
}

/** Route-backed tabs (each tab is a link) so tab state lives in the URL. */
export function RouteTabs({ tabs, base, label }: { tabs: TabDef[]; base: string; label: string }) {
  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto scrollbar-thin">
      {tabs.map((t, i) => (
        <NavLink
          key={t.key}
          to={i === 0 ? base : `${base}/${t.key}`}
          end
          className={({ isActive }) =>
            cn(
              "inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm font-medium transition-colors",
              isActive ? "border-primary text-fg" : "border-transparent text-fg-2 hover:border-border-strong hover:text-fg",
            )
          }
        >
          {t.label}
          {t.count != null && <span className="tnum rounded-full bg-subtle px-1.5 text-2xs text-fg-3">{t.count}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

/** Local state tabs implementing the WAI-ARIA tabs pattern. */
export function Tabs({ tabs, value, onChange, label }: { tabs: TabDef[]; value: string; onChange: (key: string) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.key === value);
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : e.key === "ArrowLeft" ? (i - 1 + tabs.length) % tabs.length : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].key);
    ref.current?.querySelectorAll<HTMLElement>("[role=tab]")[next]?.focus();
  };
  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === value}
          tabIndex={t.key === value ? 0 : -1}
          onClick={() => onChange(t.key)}
          className={cn("-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-sm font-medium", t.key === value ? "border-primary text-fg" : "border-transparent text-fg-2 hover:text-fg")}
        >
          {t.label}
          {t.count != null && <span className="tnum rounded-full bg-subtle px-1.5 text-2xs text-fg-3">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label, size = "md" }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded border border-border bg-subtle p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-sm px-2.5 font-medium transition-colors duration-fast tnum",
            size === "sm" ? "h-6 text-xs" : "h-[28px] text-sm",
            o.value === value ? "bg-surface text-fg shadow-sm" : "text-fg-2 hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

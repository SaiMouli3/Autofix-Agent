import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/format";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

/** Dropdown menu with roving keyboard focus (arrow keys, Home/End, Escape). */
export function Menu({ trigger, items, align = "end", label, className }: { trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode; items: (MenuItem | "separator")[]; align?: "start" | "end"; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    listRef.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus();
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const els = [...(listRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") els[(i + 1) % els.length]?.focus();
    else if (e.key === "ArrowUp") els[(i - 1 + els.length) % els.length]?.focus();
    else if (e.key === "Home") els[0]?.focus();
    else if (e.key === "End") els[els.length - 1]?.focus();
    else if (e.key === "Escape" || e.key === "Tab") setOpen(false);
    else return;
    e.preventDefault();
  };
  return (
    <div className={cn("relative inline-flex", className)} ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div
          ref={listRef}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          className={cn("absolute top-full z-popover mt-1 min-w-[200px] rounded-md border border-border bg-surface p-1 shadow-md animate-pop", align === "end" ? "right-0" : "left-0")}
        >
          {items.map((it, i) =>
            it === "separator" ? (
              <div key={i} className="my-1 h-px bg-border" role="separator" />
            ) : (
              <button
                key={it.label}
                role="menuitem"
                disabled={it.disabled}
                title={it.hint}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-subtle focus:bg-subtle disabled:cursor-not-allowed disabled:opacity-50",
                  it.danger ? "text-danger" : "text-fg",
                )}
              >
                {it.icon && <span className="text-fg-3">{it.icon}</span>}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { industryLabel, type IndustryGroup } from "@shared/industries";
import { cn } from "@/lib/format";
import { Chip } from "../ui/primitives";
import { Checkbox } from "../ui/Field";

/**
 * Hierarchical multi-select. Selecting a parent stores the group key; selecting individual
 * children stores leaf keys. An empty selection means "All industries".
 */
export function IndustryMultiSelect({ groups, value, onChange, id }: { groups: IndustryGroup[]; value: string[]; onChange: (v: string[]) => void; id?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return groups;
    return groups
      .map((g) => (g.label.toLowerCase().includes(s) ? g : { ...g, children: g.children.filter((c) => c.label.toLowerCase().includes(s)) }))
      .filter((g) => g.children.length);
  }, [groups, q]);

  const selected = new Set(value);
  const toggleGroup = (g: IndustryGroup) => {
    const childKeys = g.children.map((c) => c.key);
    if (selected.has(g.key)) onChange(value.filter((v) => v !== g.key));
    else onChange([...value.filter((v) => !childKeys.includes(v)), g.key]);
  };
  const toggleLeaf = (g: IndustryGroup, key: string) => {
    if (selected.has(g.key)) {
      // Expand the group into its other children.
      onChange([...value.filter((v) => v !== g.key), ...g.children.map((c) => c.key).filter((k) => k !== key)]);
      return;
    }
    const next = selected.has(key) ? value.filter((v) => v !== key) : [...value, key];
    const allChildren = g.children.every((c) => next.includes(c.key));
    onChange(allChildren ? [...next.filter((v) => !g.children.some((c) => c.key === v)), g.key] : next);
  };

  return (
    <div ref={ref} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-control w-full items-center justify-between gap-2 rounded border border-border bg-surface px-2.5 text-left text-sm shadow-xs hover:border-border-strong focus:border-primary focus:shadow-focus focus:outline-none"
      >
        <span className={cn("truncate", !value.length && "text-fg-2")}>{value.length ? `${value.length} selected` : "All industries"}</span>
        <ChevronDown size={14} className="text-fg-3" aria-hidden />
      </button>
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((k) => (
            <Chip key={k} onRemove={() => onChange(value.filter((v) => v !== k))} removeLabel={`Remove ${industryLabel(k)}`}>
              {industryLabel(k)}
            </Chip>
          ))}
          <button type="button" className="text-xs font-medium text-fg-2 hover:text-fg" onClick={() => onChange([])}>
            Clear
          </button>
        </div>
      )}
      {open && (
        <div role="dialog" aria-label="Select industries" className="absolute left-0 right-0 top-full z-popover mt-1 rounded-md border border-border bg-surface shadow-md animate-pop" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter industries" aria-label="Filter industries" className="h-8 w-full rounded border border-border bg-surface pl-8 pr-2 text-sm outline-none focus:border-primary" />
            </div>
          </div>
          <div className="max-h-[340px] overflow-y-auto p-1.5">
            {!q && (
              <button type="button" onClick={() => onChange([])} className={cn("mb-1 flex w-full items-center rounded px-2 py-1.5 text-sm hover:bg-subtle", !value.length && "font-medium text-primary")}>
                All industries
              </button>
            )}
            {filtered.length === 0 && <p className="px-2 py-4 text-center text-sm text-fg-2">No industries match “{q}”.</p>}
            {filtered.map((g) => {
              const all = selected.has(g.key);
              const some = !all && g.children.some((c) => selected.has(c.key));
              return (
                <fieldset key={g.key} className="mb-1">
                  <legend className="sr-only">{g.label}</legend>
                  <div className="rounded px-2 py-1 hover:bg-subtle">
                    <Checkbox label={<span className="font-medium">{g.label}</span>} checked={all} indeterminate={some} onChange={() => toggleGroup(g)} />
                  </div>
                  <div className="ml-6 grid grid-cols-1 sm:grid-cols-2">
                    {g.children.map((c) => (
                      <div key={c.key} className="rounded px-2 py-1 hover:bg-subtle">
                        <Checkbox label={<span className="text-fg-2">{c.label}</span>} checked={all || selected.has(c.key)} onChange={() => toggleLeaf(g, c.key)} />
                      </div>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <span className="t-meta">{value.length ? `${value.length} selected` : "No filter — all industries"}</span>
            <button type="button" onClick={() => setOpen(false)} className="text-sm font-medium text-primary hover:underline">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

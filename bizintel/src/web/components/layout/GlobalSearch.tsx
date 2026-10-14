import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, FileText, History, ListChecks, Search } from "lucide-react";
import { useGlobalSearch } from "@/lib/queries";
import { useDebounced } from "@/lib/useDebounced";
import { cn } from "@/lib/format";
import { Dialog } from "../ui/Dialog";
import { Kbd, Spinner } from "../ui/primitives";

interface Hit {
  key: string;
  group: string;
  label: string;
  sub?: string | null;
  to: string;
  icon: JSX.Element;
}

/** Searches records already in this workspace (businesses, lists, searches, reports). It does not search the web. */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const dq = useDebounced(q, 180);
  const { data, isFetching, isError } = useGlobalSearch(open ? dq : "");
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hits = useMemo<Hit[]>(() => {
    if (!data || !dq.trim()) return [];
    return [
      ...data.businesses.map((b) => ({ key: `b${b.id}`, group: "Businesses", label: b.name, sub: [b.category, b.city].filter(Boolean).join(" · "), to: `/businesses/${b.id}`, icon: <Building2 size={15} /> })),
      ...data.reports.map((r) => ({ key: `r${r.businessId}`, group: "Research reports", label: r.businessName, sub: "Company intelligence report", to: `/businesses/${r.businessId}/intelligence`, icon: <FileText size={15} /> })),
      ...data.lists.map((l) => ({ key: `l${l.id}`, group: "Saved lists", label: l.name, sub: `${l.count} businesses`, to: `/lists/${l.id}`, icon: <ListChecks size={15} /> })),
      ...data.searches.map((s) => ({ key: `s${s.id}`, group: "Searches", label: s.name, sub: null, to: `/searches/${s.id}`, icon: <History size={15} /> })),
    ];
  }, [data, dq]);

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    navigate(h.to);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex h-control w-full max-w-[420px] items-center gap-2 rounded border border-border bg-subtle px-2.5 text-sm text-fg-3 transition-colors hover:border-border-strong"
        aria-label="Search workspace"
      >
        <Search size={15} aria-hidden />
        <span className="flex-1 truncate text-left">Search businesses, lists, reports…</span>
        <span className="hidden gap-0.5 sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Search workspace" description="Finds businesses, research reports, lists and searches already in this workspace.">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
          <input
            data-autofocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((a) => Math.min(hits.length - 1, a + 1));
              else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
              else if (e.key === "Enter" && hits[active]) go(hits[active]);
              else return;
              e.preventDefault();
            }}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={hits[active] ? `gs-${hits[active].key}` : undefined}
            placeholder="Type a business name, domain or list…"
            className="h-10 w-full rounded border border-border bg-surface pl-9 pr-9 text-md outline-none focus:border-primary focus:shadow-focus"
          />
          {isFetching && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-3" size={14} />}
        </div>
        <div id="global-search-results" role="listbox" aria-label="Results" className="mt-3 max-h-[50vh] overflow-y-auto">
          {isError && <p className="px-1 py-6 text-center text-sm text-danger">Search failed. Try again.</p>}
          {!isError && dq.trim() && !isFetching && hits.length === 0 && <p className="px-1 py-6 text-center text-sm text-fg-2">No matches in this workspace for “{dq}”.</p>}
          {!dq.trim() && <p className="px-1 py-6 text-center text-sm text-fg-3">Start typing to search. Use ↑ ↓ to move and Enter to open.</p>}
          {hits.map((h, i) => (
            <div key={h.key}>
              {(i === 0 || hits[i - 1].group !== h.group) && <div className="px-2 pb-1 pt-3 t-th">{h.group}</div>}
              <div
                id={`gs-${h.key}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={cn("flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5", i === active ? "bg-subtle" : "")}
              >
                <span className="text-fg-3">{h.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{h.label}</span>
                  {h.sub && <span className="block truncate text-xs text-fg-3">{h.sub}</span>}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Dialog>
    </>
  );
}

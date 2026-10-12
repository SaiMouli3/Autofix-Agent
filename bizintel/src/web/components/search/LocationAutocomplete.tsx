import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Crosshair, MapPin, X } from "lucide-react";
import { useGeocode } from "@/lib/queries";
import { useDebounced } from "@/lib/useDebounced";
import { cn } from "@/lib/format";
import type { LocationSuggestion, ResolvedLocation } from "@/lib/types";
import { errorMessage } from "@/lib/api";
import { Spinner } from "../ui/primitives";

export function confidenceLabel(c: number): { label: string; tone: "success" | "warning" | "danger" } {
  if (c >= 0.85) return { label: "High confidence", tone: "success" };
  if (c >= 0.65) return { label: "Medium confidence", tone: "warning" };
  return { label: "Low confidence", tone: "danger" };
}

/**
 * Location combobox. Suggestions are only applied when the user picks one —
 * the input never silently resolves to the top match.
 */
export function LocationAutocomplete({ value, onChange, invalid }: { value: ResolvedLocation | null; onChange: (loc: ResolvedLocation | null, alternatives?: LocationSuggestion[]) => void; invalid?: boolean }) {
  const [text, setText] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const dq = useDebounced(text, 300);
  const enabled = open && dq.trim().length >= 2 && dq !== value?.label;
  const { data, isFetching, error } = useGeocode(enabled ? dq : "");
  const items = enabled ? (data?.items ?? []) : [];
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => setText(value?.label ?? ""), [value?.label]);

  const pick = (s: LocationSuggestion) => {
    const { id: _id, ...loc } = s;
    void _id;
    onChange(loc, items.filter((i) => i.id !== s.id).slice(0, 3));
    setText(s.label);
    setOpen(false);
  };

  return (
    <div ref={wrap} className="relative">
      <div className={cn("flex h-11 items-center gap-2 rounded-md border bg-surface px-3 shadow-xs transition-colors focus-within:border-primary focus-within:shadow-focus", invalid ? "border-danger" : "border-border hover:border-border-strong")}>
        <MapPin size={18} className="shrink-0 text-fg-3" aria-hidden />
        <input
          id="location-input"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
            if (value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(items.length - 1, a + 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
            else if (e.key === "Enter" && open && items[active]) pick(items[active]);
            else if (e.key === "Escape") setOpen(false);
            else return;
            e.preventDefault();
          }}
          placeholder="Enter a city, ZIP code, postal code, address, or coordinates"
          className="h-full min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-3"
          autoComplete="off"
          spellCheck={false}
        />
        {isFetching && <Spinner size={15} className="text-fg-3" label="Searching locations" />}
        {text && (
          <button
            type="button"
            aria-label="Clear location"
            onClick={() => {
              setText("");
              onChange(null);
              document.getElementById("location-input")?.focus();
            }}
            className="rounded p-1 text-fg-3 hover:bg-subtle hover:text-fg"
          >
            <X size={15} />
          </button>
        )}
      </div>
      {open && enabled && (
        <div className="absolute left-0 right-0 top-full z-popover mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-md animate-pop">
          {error ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-danger" role="alert">
              <AlertTriangle size={14} /> Location lookup failed: {errorMessage(error)}
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-3 text-sm text-fg-2">{isFetching ? "Searching…" : `No places match “${dq}”. Try a city, postal code or “lat, lon”.`}</p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Location suggestions" className="max-h-[320px] overflow-y-auto py-1">
              {items.map((s, i) => {
                const conf = confidenceLabel(s.confidence);
                return (
                  <li
                    key={s.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(s)}
                    className={cn("flex cursor-pointer items-start gap-2.5 px-3 py-2", i === active && "bg-subtle")}
                  >
                    {s.kind === "coordinates" ? <Crosshair size={15} className="mt-0.5 text-fg-3" /> : <MapPin size={15} className="mt-0.5 text-fg-3" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{s.label}</span>
                      <span className="block text-xs text-fg-3">
                        <span className="capitalize">{s.kind}</span>
                        {s.countryCode && ` · ${s.countryCode}`} · {conf.label}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="border-t border-border bg-subtle/60 px-3 py-1.5 text-2xs text-fg-3">Geocoding by OpenStreetMap contributors</p>
        </div>
      )}
    </div>
  );
}

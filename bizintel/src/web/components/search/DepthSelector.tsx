import { Check } from "lucide-react";
import { DEPTH_INFO } from "@shared/domain";
import type { ResearchDepth } from "@/lib/types";
import { cn } from "@/lib/format";

export function DepthSelector({ value, onChange }: { value: ResearchDepth; onChange: (d: ResearchDepth) => void }) {
  const order: ResearchDepth[] = ["fast", "standard", "deep"];
  return (
    <div role="radiogroup" aria-label="Research depth" className="grid gap-2 md:grid-cols-3">
      {order.map((d) => {
        const info = DEPTH_INFO[d];
        const selected = value === d;
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(d)}
            className={cn(
              "flex flex-col rounded-md border p-3 text-left transition-colors duration-fast focus-visible:shadow-focus",
              selected ? "border-primary bg-primary-subtle/50 ring-1 ring-primary" : "border-border bg-surface hover:border-border-strong",
            )}
          >
            <span className="flex items-center justify-between">
              <span className="text-sm font-semibold">{info.label}</span>
              <span className={cn("grid h-4 w-4 place-items-center rounded-full border", selected ? "border-primary bg-primary text-primary-fg" : "border-border-strong")} aria-hidden>
                {selected && <Check size={10} strokeWidth={3} />}
              </span>
            </span>
            <span className="mt-1 text-xs text-fg-2">{info.summary}</span>
            <ul className="mt-2 space-y-0.5">
              {info.includes.map((i) => (
                <li key={i} className="flex gap-1.5 text-xs text-fg-2">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-fg-3" aria-hidden />
                  {i}
                </li>
              ))}
            </ul>
            <span className="mt-2 border-t border-border pt-2 text-2xs text-fg-3">{info.tradeoff}</span>
          </button>
        );
      })}
    </div>
  );
}

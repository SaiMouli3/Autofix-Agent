"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatValue, type Unit } from "@/lib/format";
import type { HealthSegment } from "@/lib/types";

function scoreColor(v: number) {
  if (v >= 72) return "var(--good)";
  if (v >= 58) return "var(--warn)";
  return "var(--crit)";
}

/**
 * Segmented radial health visualisation. Each arc is one business area; its
 * fill length is that area's score. Click navigates to the owning agent.
 */
export function HealthRing({ score, segments, size = 232, onHover }: { score: number; segments: HealthSegment[]; size?: number; onHover?: (k: string | null) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const cx = size / 2;
  const r = size / 2 - 14;
  const gap = 5; // degrees
  const n = segments.length;
  const span = 360 / n - gap;
  const polar = (deg: number, rad: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + rad * Math.cos(a), cx + rad * Math.sin(a)];
  };
  const arc = (start: number, sweep: number, rad: number) => {
    const [x1, y1] = polar(start, rad);
    const [x2, y2] = polar(start + sweep, rad);
    return `M ${x1} ${y1} A ${rad} ${rad} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const active = segments.find((s) => s.key === hover);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Business health ${Math.round(score)} out of 100`}>
        {segments.map((s, i) => {
          const start = i * (360 / n) + gap / 2;
          const fill = Math.max(2, (s.score / 100) * span);
          const dim = hover && hover !== s.key;
          return (
            <Link key={s.key} href={s.href} aria-label={`${s.label}: ${Math.round(s.score)}`}
              onMouseEnter={() => { setHover(s.key); onHover?.(s.key); }} onMouseLeave={() => { setHover(null); onHover?.(null); }}
              onFocus={() => setHover(s.key)} onBlur={() => setHover(null)}>
              <path d={arc(start, span, r)} stroke="var(--surface-3)" strokeWidth={14} fill="none" strokeLinecap="round" />
              <path d={arc(start, fill, r)} stroke={scoreColor(s.score)} strokeWidth={14} fill="none" strokeLinecap="round"
                opacity={dim ? 0.3 : 1} className="transition-opacity duration-200"
                style={{ strokeDasharray: 1000, strokeDashoffset: 1000, animation: `dash 900ms ${120 + i * 70}ms cubic-bezier(.2,.7,.2,1) forwards` }} />
              <path d={arc(start, span, r)} stroke="transparent" strokeWidth={26} fill="none" className="cursor-pointer" />
            </Link>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {active ? (
          <>
            <span className="eyebrow">{active.label}</span>
            <span className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.03em] tabular">{Math.round(active.score)}</span>
            <span className={cn("mt-1 text-[12px] tabular", active.score >= active.prev ? "text-good-text" : "text-crit-text")}>
              {active.score >= active.prev ? "▲" : "▼"} {Math.abs(Math.round(active.score - active.prev))} vs last period
            </span>
          </>
        ) : (
          <>
            <span className="eyebrow">Business health</span>
            <span className="mt-1 text-[52px] font-semibold leading-none tracking-[-0.04em] tabular">{Math.round(score)}</span>
            <span className="mt-1 text-[12px] text-fg-3">out of 100</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Horizontal score bars for health breakdowns (0-100). */
export function ScoreBars({ items, className }: { items: { label: string; score: number }[]; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {items.map((it) => (
        <div key={it.label} className="grid grid-cols-[minmax(90px,140px)_1fr_32px] items-center gap-3 text-[12.5px]">
          <span className="truncate text-fg-2">{it.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(2, it.score)}%`, background: scoreColor(it.score) }} />
          </div>
          <span className="text-right font-medium tabular">{Math.round(it.score)}</span>
        </div>
      ))}
    </div>
  );
}

// Tile-grid cartogram of Indian states: equal-area tiles keep small states
// legible, which a true geographic map would not.
const TILES: Record<string, [number, number, string]> = {
  "Jammu & Kashmir": [0, 3, "JK"], "Himachal Pradesh": [1, 3, "HP"], Punjab: [1, 2, "PB"], Haryana: [2, 3, "HR"], Delhi: [2, 4, "DL"],
  Uttarakhand: [1, 4, "UK"], Rajasthan: [3, 2, "RJ"], "Uttar Pradesh": [3, 4, "UP"], Bihar: [3, 6, "BR"], Assam: [3, 8, "AS"],
  Gujarat: [4, 1, "GJ"], "Madhya Pradesh": [4, 3, "MP"], Jharkhand: [4, 6, "JH"], "West Bengal": [4, 7, "WB"], Chhattisgarh: [5, 4, "CG"],
  Odisha: [5, 6, "OD"], Maharashtra: [5, 2, "MH"], Telangana: [6, 4, "TG"], Goa: [6, 2, "GA"], Karnataka: [7, 3, "KA"],
  "Andhra Pradesh": [7, 4, "AP"], Kerala: [8, 3, "KL"], "Tamil Nadu": [8, 4, "TN"],
};

export function IndiaTileMap({ data, valueKey, unit = "number", label, invert, onSelect, extra }: {
  data: { state: string; [k: string]: unknown }[]; valueKey: string; unit?: Unit | string; label: string; invert?: boolean;
  onSelect?: (state: string) => void; extra?: (d: Record<string, unknown>) => React.ReactNode;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const byState = new Map(data.map((d) => [d.state, d]));
  const vals = data.map((d) => Number(d[valueKey] ?? 0));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const step = (v: number) => {
    const t = max === min ? 0.5 : (v - min) / (max - min);
    return Math.min(6, Math.max(1, Math.round((invert ? 1 - t : t) * 5) + 1));
  };
  const hovered = hover ? byState.get(hover) : null;
  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="grid w-full max-w-[400px] shrink-0 grid-cols-9 gap-1" role="list" aria-label={label}>
        {Array.from({ length: 9 * 9 }).map((_, idx) => {
          const row = Math.floor(idx / 9);
          const col = idx % 9;
          const entry = Object.entries(TILES).find(([, [r, c]]) => r === row && c === col);
          if (!entry) return <div key={idx} className="aspect-square" aria-hidden />;
          const [name, [, , abbr]] = entry;
          const d = byState.get(name);
          if (!d) {
            return (
              <div key={idx} className="grid aspect-square place-items-center rounded-[5px] bg-surface-3 text-[9.5px] text-fg-3" role="listitem" title={`${name}: no data`}>
                {abbr}
              </div>
            );
          }
          const s = step(Number(d[valueKey] ?? 0));
          return (
            <button key={idx} role="listitem" type="button" onMouseEnter={() => setHover(name)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(name)}
              onClick={() => onSelect?.(name)} aria-label={`${name}: ${formatValue(Number(d[valueKey]), unit)}`}
              className={cn("grid aspect-square place-items-center rounded-[5px] text-[9.5px] font-semibold transition-transform hover:scale-110", hover === name && "ring-2 ring-fg")}
              style={{ background: `var(--seq-${s})`, color: s >= 4 ? "#fff" : "var(--text)" }}>
              {abbr}
            </button>
          );
        })}
      </div>
      <div className="min-w-0 flex-1 text-[12.5px]">
        {hovered ? (
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="font-semibold">{hovered.state}</div>
            <div className="mt-1 text-fg-2">{label}: <span className="font-medium tabular text-fg">{formatValue(Number(hovered[valueKey]), unit)}</span></div>
            {extra?.(hovered)}
          </div>
        ) : (
          <p className="text-fg-3">Hover a state to see details{onSelect ? "; click to filter." : "."}</p>
        )}
        <div className="mt-4">
          <div className="mb-1 text-[11px] text-fg-3">{label}{invert ? " (darker = worse)" : ""}</div>
          <div className="flex items-center gap-1">
            <span className="tabular text-[11px] text-fg-3">{formatValue(invert ? max : min, unit)}</span>
            {[1, 2, 3, 4, 5, 6].map((s) => (
              <span key={s} className="h-2.5 w-6 rounded-sm" style={{ background: `var(--seq-${s})` }} />
            ))}
            <span className="tabular text-[11px] text-fg-3">{formatValue(invert ? min : max, unit)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Histogram-style distribution with highlighted buckets. */
export function Distribution({ data, labelKey, valueKey, highlight, unit = "number" }: {
  data: Record<string, unknown>[]; labelKey: string; valueKey: string; highlight?: (d: Record<string, unknown>) => boolean; unit?: Unit | string;
}) {
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey] ?? 0)));
  return (
    <div className="flex h-48 items-end gap-2">
      {data.map((d, i) => {
        const v = Number(d[valueKey] ?? 0);
        const hl = highlight?.(d);
        return (
          <div key={i} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            <span className="text-[11px] tabular text-fg-2 opacity-0 transition-opacity group-hover:opacity-100">{formatValue(v, unit)}</span>
            <div className="w-full rounded-t-[4px] transition-[height] duration-700" title={`${String(d[labelKey])}: ${formatValue(v, unit)}`}
              style={{ height: `${Math.max(2, (v / max) * 100)}%`, background: hl ? "var(--crit)" : "var(--series-1)", opacity: hl ? 0.85 : 1 }} />
            <span className="w-full truncate text-center text-[10.5px] text-fg-3">{String(d[labelKey])}</span>
          </div>
        );
      })}
    </div>
  );
}

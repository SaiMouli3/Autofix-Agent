"use client";

import { bucketLabel, formatValue, type Unit } from "@/lib/format";
import { cn } from "@/lib/cn";

export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
  unit?: Unit | string;
  dashed?: boolean;
  type?: "line" | "area" | "bar";
  muted?: boolean;
}

export const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: "var(--text-3)", fontSize: 11 },
} as const;

export function tickFormatter(unit: Unit | string) {
  return (v: number) => {
    if (unit === "currency") return formatValue(v, "currency");
    if (unit === "percent") return `${Math.round(v * 10) / 10}%`;
    if (unit === "ratio") return `${v}x`;
    return formatValue(v, "number");
  };
}

interface TooltipPayload {
  dataKey?: string | number;
  name?: string;
  value?: number | string;
  color?: string;
  stroke?: string;
  fill?: string;
  payload?: Record<string, unknown>;
}

/** Tooltip content: identity rides on the swatch, values stay in text ink. */
export function ChartTooltip({ active, payload, label, series, unit = "number", granularity, labelFormatter }: {
  active?: boolean; payload?: TooltipPayload[]; label?: string | number; series?: SeriesDef[]; unit?: Unit | string; granularity?: string;
  labelFormatter?: (label: string, row?: Record<string, unknown>) => React.ReactNode;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const title = labelFormatter ? labelFormatter(String(label ?? ""), row) : typeof label === "string" ? bucketLabel(label, granularity) : label;
  return (
    <div className="min-w-40 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-pop">
      {title !== undefined && title !== "" && <div className="mb-1.5 font-medium text-fg">{title}</div>}
      <div className="space-y-1">
        {payload
          .filter((p) => p.value !== undefined && p.value !== null && p.dataKey !== "__base")
          .map((p) => {
            const def = series?.find((s) => s.key === p.dataKey);
            const color = def?.color ?? p.color ?? p.stroke ?? p.fill;
            const u = def?.unit ?? unit;
            return (
              <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-fg-2">
                  <span className={cn("h-2 w-2 rounded-[3px]", def?.dashed && "h-0.5 w-3 rounded-none")} style={{ background: color }} />
                  {def?.label ?? p.name}
                </span>
                <span className="tabular font-medium text-fg">{typeof p.value === "number" ? formatValue(p.value, u, false) : p.value}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export function Legend({ series, className }: { series: SeriesDef[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-fg-2", className)}>
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          {s.dashed ? (
            <svg width="14" height="4" aria-hidden>
              <line x1="0" y1="2" x2="14" y2="2" stroke={s.color} strokeWidth="2" strokeDasharray="3 2" />
            </svg>
          ) : (
            <span className="size-2 rounded-[3px]" style={{ background: s.color }} />
          )}
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Simple, fast SVG sparkline. */
export function Sparkline({ data, color = "var(--text-3)", height = 32, className, fill = true }: {
  data?: number[]; color?: string; height?: number; className?: string; fill?: boolean;
}) {
  if (!data || data.length < 2) return <div style={{ height }} className={className} />;
  const w = 100;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, height - 3 - ((v - min) / span) * (height - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const id = `sg-${Math.abs(hash(d))}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cn("w-full overflow-visible", className)} style={{ height }} aria-hidden>
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${d} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />
        </>
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.2} fill={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

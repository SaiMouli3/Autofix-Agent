"use client";

import { useState } from "react";
import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis, BarChart as RBarChart, LabelList,
} from "recharts";
import { bucketLabel, formatValue, type Unit } from "@/lib/format";
import { cn } from "@/lib/cn";
import { axisProps, ChartTooltip, Legend, SERIES, tickFormatter, type SeriesDef } from "./kit";

type Datum = Record<string, unknown>;

export interface RefLine { y: number; label: string; color?: string }

/**
 * Time-series chart: lines/areas/bars on ONE y-axis. Use for trends with an
 * optional previous-period comparison (dashed, muted).
 */
export function TrendChart({ data, series, unit = "number", height = 260, granularity, refLines, stacked, showLegend = true, xKey = "t", className, yDomain }: {
  data: Datum[]; series: SeriesDef[]; unit?: Unit | string; height?: number; granularity?: string; refLines?: RefLine[];
  stacked?: boolean; showLegend?: boolean; xKey?: string; className?: string; yDomain?: [number | "auto" | "dataMin", number | "auto" | "dataMax"];
}) {
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? SERIES[i % SERIES.length] }));
  return (
    <div className={className}>
      {showLegend && colored.length > 1 && <Legend series={colored} className="mb-3" />}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <defs>
              {colored.map((s) => (
                <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="0" />
            <XAxis dataKey={xKey} {...axisProps} tickFormatter={(t) => bucketLabel(String(t), granularity)} minTickGap={28} tickMargin={8} />
            <YAxis {...axisProps} width={56} tickFormatter={tickFormatter(unit)} domain={yDomain} />
            <Tooltip cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} content={<ChartTooltip series={colored} unit={unit} granularity={granularity} />} />
            {refLines?.map((r) => (
              <ReferenceLine key={r.label} y={r.y} stroke={r.color ?? "var(--text-3)"} strokeDasharray="4 4" ifOverflow="extendDomain"
                label={{ value: r.label, position: "insideTopRight", fill: "var(--text-3)", fontSize: 11 }} />
            ))}
            {colored.map((s) =>
              s.type === "bar" ? (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={stacked ? 0 : [3, 3, 0, 0]} stackId={stacked ? "a" : undefined} maxBarSize={28} isAnimationActive animationDuration={500} />
              ) : s.type === "area" ? (
                <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={`url(#fill-${s.key})`}
                  strokeDasharray={s.dashed ? "4 3" : undefined} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} stackId={stacked ? "a" : undefined} animationDuration={500} />
              ) : (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={s.muted ? 1.5 : 2}
                  strokeDasharray={s.dashed ? "4 3" : undefined} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} animationDuration={500} />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Category bars. Horizontal by default for long labels. */
export function BarChart({ data, valueKey, labelKey, unit = "number", height, horizontal = true, color = "var(--series-1)", colorFor, onSelect, refLine, valueLabels = true, className, tooltipLabel }: {
  data: Datum[]; valueKey: string; labelKey: string; unit?: Unit | string; height?: number; horizontal?: boolean; color?: string;
  colorFor?: (d: Datum, i: number) => string; onSelect?: (d: Datum) => void; refLine?: RefLine; valueLabels?: boolean; className?: string; tooltipLabel?: string;
}) {
  const h = height ?? (horizontal ? Math.max(120, data.length * 34 + 16) : 240);
  const series: SeriesDef[] = [{ key: valueKey, label: tooltipLabel ?? "Value", color, unit }];
  return (
    <div className={className} style={{ height: h }}>
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: horizontal ? 56 : 8, left: 0, bottom: 0 }} barCategoryGap={horizontal ? 8 : "22%"}>
          <CartesianGrid horizontal={!horizontal} vertical={horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey={labelKey} {...axisProps} width={128} tick={{ fill: "var(--text-2)", fontSize: 12 }}
                tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)} />
            </>
          ) : (
            <>
              <XAxis dataKey={labelKey} {...axisProps} interval={0} tickMargin={6} tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)} />
              <YAxis {...axisProps} width={52} tickFormatter={tickFormatter(unit)} />
            </>
          )}
          <Tooltip cursor={{ fill: "var(--surface-3)" }} content={<ChartTooltip series={series} unit={unit} labelFormatter={(l) => l} />} />
          {refLine && (
            <ReferenceLine {...(horizontal ? { x: refLine.y } : { y: refLine.y })} stroke="var(--text-3)" strokeDasharray="4 4"
              label={{ value: refLine.label, position: horizontal ? "top" : "insideTopRight", fill: "var(--text-3)", fontSize: 11 }} />
          )}
          <Bar dataKey={valueKey} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={horizontal ? 18 : 36}
            onClick={onSelect ? (d) => onSelect(d.payload as Datum) : undefined} className={onSelect ? "cursor-pointer" : undefined} animationDuration={500}>
            {data.map((d, i) => (
              <Cell key={i} fill={colorFor ? colorFor(d, i) : color} />
            ))}
            {valueLabels && horizontal && (
              <LabelList dataKey={valueKey} position="right" formatter={(v: unknown) => formatValue(Number(v), unit)} style={{ fill: "var(--text-2)", fontSize: 11.5 }} />
            )}
          </Bar>
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Donut with an HTML legend. Use for part-to-whole with few categories. */
export function Donut({ data, valueKey, labelKey, colors, unit = "number", centerLabel, centerValue, height = 200, onSelect, className }: {
  data: Datum[]; valueKey: string; labelKey: string; colors?: string[]; unit?: Unit | string; centerLabel?: string; centerValue?: string;
  height?: number; onSelect?: (d: Datum) => void; className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + Number(d[valueKey] ?? 0), 0);
  const palette = colors ?? SERIES;
  return (
    <div className={cn("@container", className)}>
    <div className="flex flex-col items-center gap-4 @[400px]:flex-row">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey={valueKey} nameKey={labelKey} innerRadius="68%" outerRadius="100%" paddingAngle={1.5} stroke="var(--surface)" strokeWidth={2}
              onMouseEnter={(_, i) => setActive(i)} onMouseLeave={() => setActive(null)} onClick={onSelect ? (d) => onSelect(d.payload as Datum) : undefined}
              animationDuration={600}>
              {data.map((_, i) => (
                <Cell key={i} fill={palette[i % palette.length]} opacity={active === null || active === i ? 1 : 0.35} className={onSelect ? "cursor-pointer" : undefined} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {active !== null ? (
            <>
              <span className="text-[18px] font-semibold tabular">{formatValue(Number(data[active][valueKey]), unit)}</span>
              <span className="max-w-[60%] truncate text-[11px] text-fg-3">{String(data[active][labelKey])}</span>
            </>
          ) : (
            <>
              <span className="text-[18px] font-semibold tabular">{centerValue ?? formatValue(total, unit)}</span>
              <span className="text-[11px] text-fg-3">{centerLabel ?? "Total"}</span>
            </>
          )}
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5">
        {data.map((d, i) => {
          const v = Number(d[valueKey] ?? 0);
          return (
            <li key={i}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onClick={onSelect ? () => onSelect(d) : undefined}
                className={cn("flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-surface-3", !onSelect && "cursor-default")}
              >
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: palette[i % palette.length] }} />
                <span className="min-w-0 flex-1 truncate text-fg-2">{String(d[labelKey])}</span>
                <span className="tabular font-medium">{formatValue(v, unit)}</span>
                <span className="w-11 text-right tabular text-fg-3">{total ? `${((v / total) * 100).toFixed(0)}%` : "—"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
    </div>
  );
}

/** Conversion funnel as stepped horizontal bars with stage-to-stage rates. */
export function Funnel({ stages, className }: { stages: { stage: string; value: number }[]; className?: string }) {
  const max = stages[0]?.value || 1;
  return (
    <div className={cn("space-y-2.5", className)}>
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const rate = prev ? (s.value / prev) * 100 : null;
        return (
          <div key={s.stage}>
            <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
              <span className="text-fg-2">{s.stage}</span>
              <span className="tabular">
                <span className="font-medium">{formatValue(s.value, "number")}</span>
                {rate !== null && <span className="ml-2 text-fg-3">{rate.toFixed(1)}% of previous</span>}
              </span>
            </div>
            <div className="h-6 overflow-hidden rounded-md bg-surface-3">
              <div className="h-full rounded-md transition-[width] duration-700" style={{ width: `${Math.max(1.5, (s.value / max) * 100)}%`, background: `var(--seq-${Math.max(2, 6 - i)})` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Cohort retention heatmap (sequential single hue). */
export function CohortHeatmap({ rows, className }: { rows: { cohort: string; size: number; retention: (number | null)[] }[]; className?: string }) {
  const all = rows.flatMap((r) => r.retention.filter((v): v is number => v !== null));
  const max = Math.max(1, ...all);
  return (
    <div className={cn("overflow-x-auto scrollbar-thin", className)}>
      <table className="w-full min-w-[460px] border-separate border-spacing-1 text-[12px]">
        <thead>
          <tr className="text-fg-3">
            <th className="text-left font-medium">Cohort</th>
            <th className="text-right font-medium">Customers</th>
            {rows[0]?.retention.map((_, i) => (
              <th key={i} className="font-medium">Month {i + 1}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cohort}>
              <td className="whitespace-nowrap pr-2 text-fg-2">{r.cohort}</td>
              <td className="pr-2 text-right tabular text-fg-2">{formatValue(r.size, "number")}</td>
              {r.retention.map((v, i) => {
                if (v === null) return <td key={i} className="rounded-md bg-surface-2" />;
                const step = Math.min(6, Math.max(1, Math.ceil((v / max) * 6)));
                return (
                  <td key={i} title={`${r.cohort} · month ${i + 1}: ${v.toFixed(1)}% retained`}
                    className="h-9 rounded-md text-center tabular font-medium" style={{ background: `var(--seq-${step})`, color: step >= 4 ? "#fff" : "var(--text)" }}>
                    {v.toFixed(1)}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bubble scatter: two measures, size = third. */
export function BubbleScatter({ data, x, y, z, xLabel, yLabel, height = 300, colorFor, onSelect, refX, refY, nameKey = "name" }: {
  data: Datum[]; x: string; y: string; z: string; xLabel: string; yLabel: string; height?: number; colorFor?: (d: Datum) => string;
  onSelect?: (d: Datum) => void; refX?: number; refY?: number; nameKey?: string;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 16, bottom: 18, left: 0 }}>
          <CartesianGrid />
          <XAxis type="number" dataKey={x} name={xLabel} {...axisProps} tickFormatter={(v) => `${v}%`} label={{ value: xLabel, position: "insideBottom", offset: -10, fill: "var(--text-3)", fontSize: 11 }} />
          <YAxis type="number" dataKey={y} name={yLabel} {...axisProps} width={56} tickFormatter={(v) => `${Math.round(v)}%`}
            domain={[(min: number) => Math.max(0, Math.floor((min - 5) / 5) * 5), (max: number) => Math.ceil((max + 5) / 5) * 5]}
            label={{ value: yLabel, angle: -90, position: "insideLeft", offset: 0, fill: "var(--text-3)", fontSize: 11 }} />
          <ZAxis type="number" dataKey={z} range={[30, 600]} />
          {refX !== undefined && <ReferenceLine x={refX} stroke="var(--text-3)" strokeDasharray="4 4" />}
          {refY !== undefined && <ReferenceLine y={refY} stroke="var(--text-3)" strokeDasharray="4 4" />}
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as Datum;
              return (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-pop">
                  <div className="mb-1 font-medium">{String(d[nameKey])}</div>
                  <div className="text-fg-2">{xLabel}: <span className="tabular text-fg">{Number(d[x]).toFixed(1)}%</span></div>
                  <div className="text-fg-2">{yLabel}: <span className="tabular text-fg">{Number(d[y]).toFixed(1)}%</span></div>
                  <div className="text-fg-2">Revenue: <span className="tabular text-fg">{formatValue(Number(d[z]), "currency")}</span></div>
                </div>
              );
            }}
          />
          <Scatter data={data} onClick={onSelect ? (d) => onSelect(d.payload as Datum) : undefined} className={onSelect ? "cursor-pointer" : undefined}>
            {data.map((d, i) => (
              <Cell key={i} fill={colorFor ? colorFor(d) : "var(--series-1)"} fillOpacity={0.75} stroke="var(--surface)" strokeWidth={1.5} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Waterfall: gross sales → deductions → net profit. */
export function Waterfall({ steps, height = 280 }: { steps: { label: string; value: number; kind: "total" | "delta" | "subtotal" }[]; height?: number }) {
  let running = 0;
  const data = steps.map((s) => {
    if (s.kind === "total" || s.kind === "subtotal") {
      running = s.value;
      return { label: s.label, __base: Math.min(0, s.value), value: Math.abs(s.value), raw: s.value, kind: s.kind };
    }
    const start = running;
    running += s.value;
    return { label: s.label, __base: Math.min(start, running), value: Math.abs(s.value), raw: s.value, kind: s.kind };
  });
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" {...axisProps} interval={0} tickMargin={6} tick={{ fill: "var(--text-3)", fontSize: 10.5 }} />
          <YAxis {...axisProps} width={56} tickFormatter={tickFormatter("currency")} />
          <Tooltip
            cursor={{ fill: "var(--surface-3)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as { label: string; raw: number };
              return (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-pop">
                  <div className="font-medium">{d.label}</div>
                  <div className="tabular text-fg-2">{formatValue(d.raw, "currency", false)}</div>
                </div>
              );
            }}
          />
          <Bar dataKey="__base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="value" stackId="w" radius={[3, 3, 3, 3]} maxBarSize={44} animationDuration={500}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.kind === "delta" ? "var(--crit)" : d.raw >= 0 ? (d.kind === "subtotal" ? "var(--series-1)" : "var(--text-2)") : "var(--crit)"} fillOpacity={d.kind === "delta" ? 0.75 : 1} />
            ))}
            <LabelList dataKey="raw" position="top" formatter={(v: unknown) => formatValue(Number(v), "currency")} style={{ fill: "var(--text-2)", fontSize: 10.5 }} />
          </Bar>
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}

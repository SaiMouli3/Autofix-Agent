/** Charts answer specific questions; each has a title, units, labelled axes and a data table. */
import { useId } from "react";

export interface Series { key: string; label: string; color: string }

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function BarChart({ data, xKey, series, yLabel, xLabel, format = (v) => v.toLocaleString(), height = 180, stacked = true }: {
  data: Record<string, any>[]; xKey: string; series: Series[]; yLabel: string; xLabel: string;
  format?: (v: number) => string; height?: number; stacked?: boolean;
}) {
  const id = useId();
  if (!data.length) return <p className="muted small">No data in this period.</p>;
  const W = 640, H = height, L = 52, R = 8, T = 10, B = 34;
  const totals = data.map((d) => series.reduce((s, x) => s + (Number(d[x.key]) || 0), 0));
  const max = niceMax(Math.max(...(stacked ? totals : data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)))));
  const bw = (W - L - R) / data.length;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const step = Math.ceil(data.length / 7);
  return (
    <figure style={{ margin: 0 }}>
      {series.length > 1 && <div className="legend" aria-hidden>{series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>}
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-d`}>
        <desc id={`${id}-d`}>{`${yLabel} by ${xLabel}; see the data table below.`}</desc>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          let acc = 0;
          const x0 = L + i * bw + bw * 0.2, w = Math.max(2, bw * 0.6);
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = Number(d[s.key]) || 0;
                if (!v) return null;
                const sw = stacked ? w : w / series.length;
                const sx = stacked ? x0 : x0 + si * sw;
                const top = stacked ? y(acc + v) : y(v);
                const h = stacked ? y(acc) - y(acc + v) : y(0) - y(v);
                if (stacked) acc += v;
                return <rect key={s.key} x={sx} y={top} width={sw} height={Math.max(h, 1)} fill={s.color} rx={1.5}><title>{`${d[xKey]} · ${s.label}: ${format(v)}`}</title></rect>;
              })}
              {i % step === 0 && <text x={x0 + w / 2} y={H - B + 14} textAnchor="middle">{String(d[xKey]).slice(5)}</text>}
            </g>
          );
        })}
        <text className="axis-title" x={12} y={(H - B) / 2} transform={`rotate(-90 12 ${(H - B) / 2})`} textAnchor="middle">{yLabel}</text>
        <text className="axis-title" x={(W + L) / 2} y={H - 4} textAnchor="middle">{xLabel}</text>
      </svg>
      <DataTable rows={data} cols={[{ key: xKey, label: xLabel }, ...series.map((s) => ({ key: s.key, label: s.label, format }))]} />
    </figure>
  );
}

export function DataTable({ rows, cols }: { rows: Record<string, any>[]; cols: { key: string; label: string; format?: (v: number) => string }[] }) {
  return (
    <details className="data">
      <summary>View data table</summary>
      <table className="table mt8">
        <thead><tr>{cols.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className="num">{c.format && typeof r[c.key] === "number" ? c.format(r[c.key]) : String(r[c.key] ?? "—")}</td>)}</tr>)}</tbody>
      </table>
    </details>
  );
}

export function HBars({ rows, format = (v) => v.toLocaleString(), unit }: { rows: { label: string; value: number }[]; format?: (v: number) => string; unit?: string }) {
  if (!rows.length) return <p className="muted small">No data in this period.</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div role="list">
      {rows.map((r) => (
        <div className="hbar" key={r.label} role="listitem" aria-label={`${r.label}: ${format(r.value)}${unit ? ` ${unit}` : ""}`}>
          <span className="ellipsis" title={r.label}>{r.label}</span>
          <div className="track" aria-hidden><div className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="right num muted">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

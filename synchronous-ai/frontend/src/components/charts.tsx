/** Lightweight SVG/CSS charts. Values are always real records passed in by the caller. */

export interface Series {
  key: string;
  label: string;
  color: string;
}

export function StackedBars({ data, series, xKey, format = (v: number) => String(v), height = 140 }: {
  data: Record<string, any>[];
  series: Series[];
  xKey: string;
  format?: (v: number) => string;
  height?: number;
}) {
  if (!data.length) return <div className="faint small" style={{ padding: "40px 0", textAlign: "center" }}>No data in this period yet.</div>;
  const totals = data.map((d) => series.reduce((s, x) => s + (Number(d[x.key]) || 0), 0));
  const max = Math.max(1, ...totals);
  const step = Math.ceil(data.length / 8);
  return (
    <div>
      {series.length > 1 && (
        <div className="legend mb8">
          {series.map((s) => (
            <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
          ))}
        </div>
      )}
      <div className="bars" style={{ height }} role="img" aria-label="bar chart">
        {data.map((d, i) => (
          <div className="bar-col" key={i}>
            <div className="tip">
              <b>{String(d[xKey])}</b>
              {series.map((s) => (
                <div key={s.key}>{s.label}: {format(Number(d[s.key]) || 0)}</div>
              ))}
            </div>
            {[...series].reverse().map((s) => {
              const v = Number(d[s.key]) || 0;
              return <div key={s.key} className="seg-bar" style={{ height: `${(v / max) * 100}%`, background: s.color }} />;
            })}
          </div>
        ))}
      </div>
      <div className="axis">
        {data.map((d, i) => (
          <span key={i}>{i % step === 0 ? String(d[xKey]).slice(5) : ""}</span>
        ))}
      </div>
    </div>
  );
}

export function HBars({ rows, format = (v: number) => String(v) }: { rows: { label: string; value: number; sub?: string }[]; format?: (v: number) => string }) {
  if (!rows.length) return <div className="faint small">No data yet.</div>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => (
        <div className="hbar" key={r.label}>
          <span className="ellipsis" title={r.label}>{r.label}</span>
          <div className="track"><div className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="right faint">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Donut({ parts, size = 120 }: { parts: { label: string; value: number; color: string }[]; size?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="row" style={{ gap: 18 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="distribution">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-0)" strokeWidth={14} />
        {total > 0 &&
          parts.map((p) => {
            const len = (p.value / total) * c;
            const el = (
              <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={14}
                strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
            );
            offset += len;
            return el;
          })}
        <text x="50%" y="50%" textAnchor="middle" dy="0.35em" fill="var(--text)" fontSize="20" fontWeight="700">{total}</text>
      </svg>
      <div className="stack" style={{ gap: 6 }}>
        {parts.map((p) => (
          <div key={p.label} className="small row"><i style={{ width: 10, height: 10, borderRadius: 3, background: p.color, display: "inline-block" }} />{p.label}<span className="faint">{p.value}</span></div>
        ))}
      </div>
    </div>
  );
}

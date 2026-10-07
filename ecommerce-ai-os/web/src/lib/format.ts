// Formatting helpers. All currency is USD, shown in US notation.

export type Unit = "currency" | "number" | "percent" | "hours" | "rating" | "ratio" | "days" | "score";

const LOCALE = "en-US";
const nf0 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** US dollars: compact ($48.2K, $1.24M, $1.06B) or full ($1,234 / $49.99). */
export function usd(v: number, opts: { compact?: boolean } = {}): string {
  if (!Number.isFinite(v)) return "—";
  const compact = opts.compact ?? true;
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (compact) {
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  }
  // Cents only where they carry meaning (prices, AOV, CPC).
  const cents = a < 1000 && Math.round(a * 100) % 100 !== 0;
  return `${sign}$${cents ? nf2.format(a) : nf0.format(a)}`;
}

export function num(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return "—";
  if (digits === 0) return nf0.format(v);
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

export function compactNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return nf1.format(v);
}

export function pct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function formatValue(v: number, unit: Unit | string, compact = true): string {
  switch (unit) {
    case "currency":
      return usd(v, { compact });
    case "percent":
      return pct(v, v >= 100 ? 0 : 1);
    case "hours":
      return v < 1 ? `${Math.round(v * 60)}m` : `${v.toFixed(1)}h`;
    case "rating":
      return `${v.toFixed(2)}★`;
    case "ratio":
      return `${v.toFixed(2)}x`;
    case "days":
      return `${v.toFixed(0)}d`;
    case "score":
      return `${Math.round(v)}`;
    default:
      return compact && Math.abs(v) >= 1e5 ? compactNum(v) : num(v, Number.isInteger(v) || Math.abs(v) >= 100 ? 0 : 1);
  }
}

/** Format a change: percentage for most units, points for percent/rating. */
export function formatChange(change: number, unit: Unit | string): string {
  if (!Number.isFinite(change)) return "—";
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  const a = Math.abs(change);
  if (unit === "percent") return `${sign}${a.toFixed(1)} pts`;
  if (unit === "rating") return `${sign}${a.toFixed(2)}`;
  return `${sign}${a >= 100 ? a.toFixed(0) : a.toFixed(1)}%`;
}

export type Tone = "good" | "bad" | "neutral";

export function changeTone(change: number, direction: string): Tone {
  if (Math.abs(change) < 0.05 || direction === "neutral") return "neutral";
  return (change > 0) === (direction === "up") ? "good" : "bad";
}

export function relativeTime(iso: string | Date): string {
  const t = typeof iso === "string" ? new Date(iso) : iso;
  const s = Math.round((Date.now() - t.getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return t.toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
}

export function clockTime(iso: string | Date): string {
  const t = typeof iso === "string" ? new Date(iso) : iso;
  return t.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit", hour12: true });
}

export function shortDate(iso: string | Date, withYear = false): string {
  const t = typeof iso === "string" ? new Date(iso) : iso;
  return t.toLocaleDateString(LOCALE, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
}

/** Axis label for a bucket key ("2026-10-07" or "14:00"). */
export function bucketLabel(t: string, granularity?: string): string {
  if (/^\d{2}:\d{2}$/.test(t)) return t;
  const d = new Date(`${t}T00:00:00`);
  if (Number.isNaN(d.getTime())) return t;
  if (granularity === "week") return d.toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
  return d.toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

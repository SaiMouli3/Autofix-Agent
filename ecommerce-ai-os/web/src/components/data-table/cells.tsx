"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { usd, shortDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

const ORDER_STATUS: Record<string, { label: string; tone: "good" | "warn" | "crit" | "info" | "neutral" }> = {
  delivered: { label: "Delivered", tone: "good" },
  in_transit: { label: "In transit", tone: "info" },
  processing: { label: "Processing", tone: "neutral" },
  ndr: { label: "NDR", tone: "warn" },
  rto: { label: "RTO", tone: "crit" },
  returned: { label: "Returned", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function OrderStatus({ status }: { status: string }) {
  const s = ORDER_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

const RISK: Record<string, { label: string; tone: "good" | "warn" | "crit" | "info" | "neutral" | "outline" }> = {
  high: { label: "High", tone: "crit" },
  medium: { label: "Medium", tone: "warn" },
  low: { label: "Low", tone: "neutral" },
  none: { label: "—", tone: "outline" },
  lost: { label: "Lost (RTO)", tone: "crit" },
  stockout: { label: "Out of stock", tone: "crit" },
  critical: { label: "Critical", tone: "crit" },
  overstock: { label: "Overstock", tone: "info" },
  dead: { label: "Dead stock", tone: "neutral" },
  healthy: { label: "Healthy", tone: "good" },
};

export function RiskBadge({ risk }: { risk: string }) {
  const r = RISK[risk] ?? { label: risk, tone: "neutral" as const };
  return <Badge tone={r.tone}>{r.label}</Badge>;
}

export function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn("size-3", i <= Math.round(rating) ? "fill-[var(--series-4)] text-[var(--series-4)]" : "text-border-strong")} />
      ))}
    </span>
  );
}

export const money = (v: number) => <span className="font-medium">{usd(v, { compact: false })}</span>;
export const date = (v?: string | null) => (v ? shortDate(v) : <span className="text-fg-3">—</span>);

export function SegmentBadge({ segment }: { segment: string }) {
  const tone = ({ VIP: "accent", Loyal: "good", Growing: "info", New: "neutral", "At Risk": "warn", "Churn Risk": "crit", "One-time": "outline" } as const)[segment] ?? "neutral";
  return <Badge tone={tone}>{segment}</Badge>;
}

export function SentimentBadge({ s }: { s: string }) {
  return <Badge tone={s === "positive" ? "good" : s === "negative" ? "crit" : "neutral"}>{s[0].toUpperCase() + s.slice(1)}</Badge>;
}

export function HealthPill({ v }: { v: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-1.5 rounded-full", v >= 72 ? "bg-good" : v >= 58 ? "bg-warn" : "bg-crit")} />
      <span className="font-medium">{Math.round(v)}</span>
    </span>
  );
}

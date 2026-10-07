"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useInvalidateAnalysis } from "@/lib/queries";
import type { Insight, Range, Row, View } from "@/lib/types";
import { BarChart, Donut, TrendChart } from "@/components/charts/charts";
import { SentimentBadge, Stars } from "@/components/data-table/cells";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { AiCallout, ChartCard, KpiStrip } from "./common";

export function ResponseComposer({ review, open, onOpenChange }: { review: Row | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [text, setText] = useState("");
  const [engine, setEngine] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidateAnalysis();
  const generate = async () => {
    if (!review) return;
    setLoading(true);
    try {
      const r = await api<{ text: string; engine: string }>(`/reviews/${review.id}/draft`, { method: "POST" });
      setText(r.text);
      setEngine(r.engine);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setText(""); setEngine(""); } }}>
      <DialogContent title="Respond to review" description={review ? `${review.customer} · ${review.product}` : ""} className="max-w-xl">
        {review && (
          <div className="space-y-4 p-5">
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex items-center gap-2"><Stars rating={review.rating} /><span className="text-[13px] font-medium">{review.title}</span></div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">{review.body}</p>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-fg-2">Your public response</span>
                <Button size="xs" variant="secondary" onClick={generate} disabled={loading}>
                  <Sparkles className="!text-accent" /> {loading ? "Drafting…" : text ? "Regenerate" : "Generate response"}
                </Button>
              </div>
              <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Write a reply or generate one with AI…" />
              {engine && <p className="mt-1 text-[11px] text-fg-3">Drafted by {engine === "deterministic" ? "the Review agent's response templates" : engine}. Review before publishing.</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button variant="primary" disabled={text.trim().length < 5 || saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await api(`/reviews/${review.id}/response`, { method: "PUT", body: { text } });
                    toast.success("Response published", { description: "The Review agent will track sentiment on this product." });
                    invalidate();
                    onOpenChange(false);
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setSaving(false);
                  }
                }}>
                Publish response
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ReviewsView({ view, insights, range }: { view: View; insights: Insight[]; range: Range }) {
  const router = useRouter();
  const [composer, setComposer] = useState<Row | null>(null);
  const spike = insights.find((i) => i.severity === "critical");
  return (
    <div className="space-y-4">
      <KpiStrip kpis={view.kpis} cols={5} />
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Rating trend" question="Is your average rating holding up?" className="lg:col-span-8">
          <TrendChart data={view.trend} granularity={range.granularity} height={240} yDomain={[1, 5]} unit="rating"
            refLines={[{ y: 4, label: "4.0★ threshold" }]}
            series={[{ key: "avgRating", label: "Average rating", color: "var(--series-4)", unit: "rating" }]} />
        </ChartCard>
        <ChartCard title="Rating distribution" question="How are ratings spread across 1–5 stars?" className="lg:col-span-4">
          <BarChart data={(view.stars as Row[]).map((s) => ({ ...s, label: `${s.stars}★` }))} labelKey="label" valueKey="count" tooltipLabel="Reviews"
            colorFor={(d) => (Number(d.stars) <= 2 ? "var(--crit)" : Number(d.stars) === 3 ? "var(--series-muted)" : "var(--series-4)")}
            onSelect={(d) => router.push(`/agents/reviews?tab=data&rating=${d.stars}`)} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Sentiment over time" question="Is negative sentiment growing?" className="lg:col-span-8">
          <TrendChart data={view.trend} granularity={range.granularity} height={240} stacked
            series={[
              { key: "positive", label: "Positive", color: "var(--series-3)", type: "bar" },
              { key: "neutral", label: "Neutral", color: "var(--series-muted)", type: "bar" },
              { key: "negative", label: "Negative", color: "var(--series-8)", type: "bar" },
            ]} />
        </ChartCard>
        <ChartCard title="Sentiment split" question="Overall tone this period" className="lg:col-span-4">
          <Donut data={view.sentiment} valueKey="count" labelKey="label" colors={["var(--series-3)", "var(--series-muted)", "var(--series-8)"]} centerLabel="reviews" height={160}
            onSelect={(d) => router.push(`/agents/reviews?tab=data&sentiment=${String(d.label).toLowerCase()}`)} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-12">
        <ChartCard title="Review themes" question="What do negative reviews complain about?" className="lg:col-span-5">
          <BarChart data={view.negativeThemes} labelKey="theme" valueKey="share" unit="percent" tooltipLabel="Share of negative reviews" color="var(--series-8)"
            onSelect={(d) => router.push(`/agents/reviews?tab=data&sentiment=negative&theme=${encodeURIComponent(String(d.theme))}`)} />
          <AiCallout insight={spike} className="mt-4" />
        </ChartCard>
        <ChartCard title="Lowest-rated products" question="Which products are dragging your reputation down?" className="lg:col-span-7">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11.5px] text-fg-3"><tr><th className="py-1.5 font-medium">Product</th><th className="font-medium">Rating</th><th className="text-right font-medium">Reviews</th><th className="text-right font-medium">Negative</th></tr></thead>
            <tbody className="divide-y divide-border">
              {(view.lowestRated as Row[]).map((p) => (
                <tr key={p.productId} className="cursor-pointer hover:bg-surface-2" onClick={() => router.push(`/agents/reviews?tab=data&product=${p.productId}`)}>
                  <td className="py-2.5 pr-2"><div className="font-medium">{p.name}</div><div className="text-[11.5px] text-fg-3">{p.category}</div></td>
                  <td><span className="inline-flex items-center gap-1.5"><Stars rating={p.avgRating} /> <span className="tabular">{p.avgRating.toFixed(2)}</span></span></td>
                  <td className="text-right tabular">{p.reviews}</td>
                  <td className="text-right tabular text-crit-text">{p.negative}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ChartCard>
      </div>
      <ChartCard title="Latest reviews" question="What customers are saying right now">
        <ul className="divide-y divide-border">
          {(view.recent as Row[]).map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-start sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars rating={r.rating} />
                  <span className="text-[13px] font-semibold">{r.title}</span>
                  <SentimentBadge s={r.sentiment} />
                  {(r.themes as string[]).map((t) => <span key={t} className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-fg-2">{t}</span>)}
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-fg-2">{r.body}</p>
                <p className="mt-1 text-[11.5px] text-fg-3">{r.customer} · {r.city} · {r.product} · {r.source} · {relativeTime(r.createdAt)}</p>
                {r.response && <p className="mt-2 border-l-2 border-accent-border pl-3 text-[12.5px] text-fg-2"><span className="font-medium text-fg">Your response:</span> {r.response}</p>}
              </div>
              {!r.response && (
                <Button size="xs" variant={r.sentiment === "negative" ? "primary" : "secondary"} onClick={() => setComposer(r)}>
                  <Sparkles className={r.sentiment === "negative" ? "" : "!text-accent"} /> Generate response
                </Button>
              )}
            </li>
          ))}
        </ul>
      </ChartCard>
      <ResponseComposer review={composer} open={!!composer} onOpenChange={(o) => !o && setComposer(null)} />
    </div>
  );
}

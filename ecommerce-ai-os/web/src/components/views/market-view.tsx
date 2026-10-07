"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, Lightbulb } from "lucide-react";
import { cn } from "@/lib/cn";
import { relativeTime, shortDate } from "@/lib/format";
import type { Insight, Range, Row, View } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/misc";
import { Sheet } from "@/components/ui/overlay";
import { KpiStrip } from "./common";

const IMPACT_TONE = { high: "crit", medium: "warn", low: "neutral" } as const;

export function MarketView({ view }: { view: View; insights: Insight[]; range: Range }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [cat, setCat] = useState("all");
  const [impact, setImpact] = useState<"all" | "high" | "medium" | "low">("all");
  const articles = (view.articles as Row[]).filter((a) => (cat === "all" || a.category === cat) && (impact === "all" || a.impact === impact));
  const openId = sp.get("article");
  const open = (view.articles as Row[]).find((a) => a.id === openId);
  const setOpen = (id: string | null) => {
    const p = new URLSearchParams(sp.toString());
    if (id) p.set("article", id); else p.delete("article");
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  return (
    <div className="space-y-4">
      <KpiStrip kpis={view.kpis} cols={4} />
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={impact} onChange={setImpact} ariaLabel="Impact" options={[{ value: "all", label: "All impact" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
        <div className="scrollbar-thin flex gap-1 overflow-x-auto">
          {["all", ...(view.categories as Row[]).map((c) => c.category)].map((c) => (
            <button key={c} onClick={() => setCat(c)} className={cn("h-7 shrink-0 rounded-full border border-border px-3 text-[12px] text-fg-2 hover:bg-surface-3", cat === c && "border-fg bg-fg text-bg hover:bg-fg")}>
              {c === "all" ? "All categories" : c}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {articles.map((a, i) => (
          <article key={a.id} onClick={() => setOpen(a.id)} className="card group cursor-pointer p-5 transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-card animate-rise" style={{ animationDelay: `${i * 30}ms` }}>
            <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
              <Badge tone={IMPACT_TONE[a.impact as keyof typeof IMPACT_TONE]}>{String(a.impact).toUpperCase()} IMPACT</Badge>
              <Badge tone="outline">{a.category}</Badge>
              <span className="text-fg-3">{a.source} · {relativeTime(a.publishedAt)}</span>
              <span className="ml-auto tabular text-fg-3">Relevance {a.relevance}</span>
            </div>
            <h3 className="mt-2.5 text-[15px] font-semibold leading-snug tracking-[-0.01em] group-hover:underline">{a.title}</h3>
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-fg-2"><span className="font-medium text-fg">AI summary:</span> {a.summary}</p>
            <div className="mt-3 rounded-lg bg-surface-2 p-3 text-[12.5px] leading-relaxed">
              <div className="font-medium text-fg">Why it matters</div>
              <p className="mt-0.5 text-fg-2">{a.whyItMatters}</p>
            </div>
          </article>
        ))}
      </div>
      {articles.length === 0 && <p className="py-10 text-center text-[13px] text-fg-3">No articles match these filters.</p>}
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.title ?? ""} description={open ? `${open.source} · ${shortDate(open.publishedAt, true)} · ${open.category}` : ""}>
        {open && (
          <div className="space-y-5 p-5 text-[13.5px] leading-relaxed">
            <div className="flex flex-wrap gap-2"><Badge tone={IMPACT_TONE[open.impact as keyof typeof IMPACT_TONE]}>{String(open.impact).toUpperCase()} IMPACT</Badge><Badge tone="outline">Relevance {open.relevance}/100</Badge></div>
            <section><div className="eyebrow mb-1.5">AI summary</div><p>{open.summary}</p></section>
            <section><div className="eyebrow mb-1.5">Impact on your business</div><p className="text-fg-2">{open.whyItMatters}</p></section>
            <section className="rounded-xl border border-accent-border bg-accent-soft p-4">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-accent-text"><Lightbulb className="size-3.5" /> AI recommendation</div>
              <p className="mt-1">{open.recommendation}</p>
            </section>
            {open.relatedEntity && <p className="text-[12.5px] text-fg-3">Related: <span className="font-medium text-fg">{open.relatedEntity}</span> <ArrowUpRight className="inline size-3" /></p>}
          </div>
        )}
      </Sheet>
    </div>
  );
}

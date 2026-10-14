import type { Opportunity } from "@/lib/types";
import { Meter } from "../ui/primitives";

/** Explainable score: each weighted component with its contribution and the reason it was assigned. */
export function ScoreBreakdown({ opp }: { opp: Opportunity }) {
  const total = opp.components.reduce((s, c) => s + c.weight, 0) || 1;
  return (
    <div className="p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tnum">{opp.score}</span>
        <span className="text-sm text-fg-3">/ 100</span>
        <span className="ml-auto t-meta">Research confidence: {opp.confidence}</span>
      </div>
      <table className="mt-4 w-full text-left">
        <caption className="sr-only">Score breakdown by criterion</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="pb-1.5 t-th">Criterion</th>
            <th scope="col" className="pb-1.5 text-right t-th">Points</th>
          </tr>
        </thead>
        <tbody>
          {opp.components.map((c) => {
            const pts = (c.weight * c.value * 100) / total;
            const max = (c.weight * 100) / total;
            return (
              <tr key={c.key} className="border-b border-border align-top last:border-0">
                <td className="py-2 pr-3">
                  <div className="text-sm font-medium">{c.label}</div>
                  <div className="mt-1 w-full max-w-[180px]">
                    <Meter value={c.value * 100} label={`${c.label}: ${Math.round(c.value * 100)}%`} tone={c.value >= 0.7 ? "success" : c.value >= 0.4 ? "warning" : "neutral"} />
                  </div>
                  <p className="mt-1 text-xs text-fg-2">{c.rationale}</p>
                </td>
                <td className="py-2 text-right text-sm tnum whitespace-nowrap">
                  {pts.toFixed(0)} <span className="text-fg-3">/ {max.toFixed(0)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Ban, Check, CircleDashed, Loader, MinusCircle, XCircle } from "lucide-react";
import { STAGE_LABELS } from "@shared/domain";
import type { SearchRecord, SearchStage } from "@/lib/types";
import { cn, duration } from "@/lib/format";
import { Button } from "../ui/Button";

function StageIcon({ s }: { s: SearchStage }) {
  switch (s.status) {
    case "completed":
      return <Check size={13} strokeWidth={2.6} className="text-success" />;
    case "running":
      return <Loader size={13} className="animate-spin text-info" />;
    case "failed":
      return <XCircle size={13} className="text-danger" />;
    case "skipped":
      return <MinusCircle size={13} className="text-fg-3" />;
    default:
      return <CircleDashed size={13} className="text-fg-3" />;
  }
}

const STATUS_TEXT: Record<SearchStage["status"], string> = { pending: "Waiting", running: "In progress", completed: "Done", skipped: "Skipped", failed: "Failed" };

/** Ticks once per second while the job runs, for the elapsed-time readout. */
function useNow(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

export function SearchProgress({ search, onCancel, cancelling }: { search: SearchRecord; onCancel?: () => void; cancelling?: boolean }) {
  const active = search.status === "running" || search.status === "queued";
  useNow(active);
  const c = search.counters;
  const counters = [
    { label: "Discovered", value: c.discovered },
    { label: "Unique", value: c.unique },
    { label: "Websites", value: c.websites },
    ...(search.resultSummary
      ? [
          { label: "With public email", value: search.resultSummary.withEmail },
          { label: "With public phone", value: search.resultSummary.withPhone },
        ]
      : []),
    ...(search.depth !== "fast"
      ? [
          { label: "Contact records", value: c.contacts },
          { label: "Researched", value: c.researched },
        ]
      : []),
    { label: "Failed or skipped", value: c.failed + c.skipped },
  ];
  const doneCount = search.stages.filter((s) => s.status === "completed" || s.status === "skipped").length;

  return (
    <section className="panel" aria-labelledby="progress-title" aria-live="polite">
      <div className="panel-header">
        <div>
          <h2 id="progress-title" className="t-card-title">
            {active ? (search.status === "queued" ? "Waiting to start" : search.currentStage ? STAGE_LABELS[search.currentStage] : "Working") : "Search run"}
          </h2>
          <p className="t-meta mt-0.5 tnum">
            Stage {Math.min(doneCount + (active ? 1 : 0), search.stages.length)} of {search.stages.length} · Elapsed {duration(search.startedAt ?? search.createdAt, active ? null : search.finishedAt)}
          </p>
        </div>
        {active && onCancel && (
          <Button size="sm" icon={<Ban size={14} />} onClick={onCancel} loading={cancelling}>
            Cancel search
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ol className="min-w-0 space-y-0.5 p-3 lg:border-r lg:border-border">
          {search.stages.map((s) => (
            <li key={s.key} className={cn("flex items-start gap-2.5 rounded px-2 py-1.5", s.status === "running" && "bg-info-subtle/60")}>
              <span className="mt-0.5 grid h-4 w-4 place-items-center" aria-hidden>
                <StageIcon s={s} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn("text-sm", s.status === "pending" ? "text-fg-3" : "font-medium text-fg")}>{STAGE_LABELS[s.key]}</span>
                  <span className="t-meta shrink-0 tnum">
                    <span className="sr-only">{STATUS_TEXT[s.status]} </span>
                    {s.startedAt && (s.finishedAt || s.status === "running") ? duration(s.startedAt, s.finishedAt) : s.status === "pending" ? "" : STATUS_TEXT[s.status]}
                  </span>
                </div>
                {s.detail && <p className="mt-0.5 truncate text-xs text-fg-3" title={s.detail}>{s.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-border lg:border-t-0">
          <dl className="grid grid-cols-2 sm:grid-cols-3">
            {counters.map((k) => (
              <div key={k.label} className="border-b border-r border-border px-4 py-3 [&:nth-child(2n)]:border-r-0 sm:[&:nth-child(2n)]:border-r sm:[&:nth-child(3n)]:border-r-0">
                <dt className="t-label">{k.label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tnum">{k.value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
          {search.issues.length > 0 && (
            <div className="p-3">
              <h3 className="t-label mb-1.5">Provider notes ({search.issues.length})</h3>
              <ul className="max-h-[160px] space-y-1 overflow-y-auto text-xs">
                {search.issues.map((i, idx) => (
                  <li key={idx} className="flex gap-2 rounded bg-warning-subtle/60 px-2 py-1.5 text-fg-2">
                    <span className="shrink-0 font-medium text-warning">{i.provider}</span>
                    <span className="min-w-0 break-words">{i.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

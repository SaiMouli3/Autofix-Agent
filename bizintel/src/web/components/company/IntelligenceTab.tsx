import { useState } from "react";
import { CheckCircle2, ChevronDown, Circle, Download, FileText, Layers, RefreshCw, RotateCw } from "lucide-react";
import { DEPTH_INFO, EVIDENCE_LABELS } from "@shared/domain";
import type { Business, EvidenceClass, ResearchDepth } from "@/lib/types";
import { api, errorMessage } from "@/lib/api";
import { useEvidence, useInvalidate, useQueueResearch, useReport } from "@/lib/queries";
import { cn, dateTime } from "@/lib/format";
import { Button, IconButton } from "../ui/Button";
import { BlockSkeleton, EmptyState, InlineAlert } from "../ui/States";
import { Badge } from "../ui/primitives";
import { useToast } from "../ui/Toast";
import { SourceReference } from "../business/SourceReference";
import { EvidenceList, Prose } from "./shared";
import { NotesPanel } from "./ActivityTab";
import type { TabProps } from "@/pages/Company";

const CLASS_ORDER: EvidenceClass[] = ["verified_fact", "third_party", "inference", "hypothesis"];

export function IntelligenceTab({ id, poll, business: b, onEnrich, onExport }: TabProps & { business: Business; onEnrich: () => void; onExport: () => void }) {
  const { data: rep, isLoading } = useReport(id, poll);
  const { data: evidence = [] } = useEvidence(id, poll);
  const queue = useQueueResearch();
  const inv = useInvalidate();
  const toast = useToast();
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const report = rep?.report;

  const run = (depth: ResearchDepth) =>
    queue.mutate(
      { businessIds: [id], depth },
      { onSuccess: () => toast.success(`${DEPTH_INFO[depth].label} research queued`), onError: (e) => toast.error("Couldn’t queue research", errorMessage(e)) },
    );

  const toggleReviewed = async (evId: string, reviewed: boolean) => {
    try {
      await api.patch(`/evidence/${evId}`, { reviewed });
      await inv(["business", id]);
    } catch (e) {
      toast.error("Couldn’t update", errorMessage(e));
    }
  };

  if (isLoading) return <div className="panel"><BlockSkeleton lines={10} /></div>;
  if (!report)
    return (
      <div className="panel">
        <EmptyState
          icon={<FileText size={18} />}
          title="No intelligence report yet"
          description="Standard research produces a structured brief from the company’s website. Deep research adds third-party sources."
          action={
            <>
              <Button variant="primary" size="sm" onClick={() => run("standard")} loading={queue.isPending}>Run standard research</Button>
              <Button size="sm" onClick={() => run("deep")}>Run deep research</Button>
            </>
          }
        />
      </div>
    );

  const summary = report.sections.find((s) => s.key === "executive_summary");
  const counts = CLASS_ORDER.map((c) => ({ c, n: evidence.filter((e) => e.classification === c).length }));
  const sources = [...new Map(evidence.filter((e) => e.sourceUrl).map((e) => [e.sourceUrl!, e])).values()];
  const reviewedAction = (e: { id: string; reviewed: boolean }) => (
    <IconButton label={e.reviewed ? "Mark as not reviewed" : "Mark as reviewed"} size="sm" onClick={() => toggleReviewed(e.id, !e.reviewed)} aria-pressed={e.reviewed}>
      {e.reviewed ? <CheckCircle2 size={14} className="text-success" /> : <Circle size={14} />}
    </IconButton>
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <article className="panel min-w-0" aria-labelledby="report-title">
        <header className="border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="t-th">Company intelligence brief</p>
              <h2 id="report-title" className="mt-1 text-lg font-semibold">{b.name}</h2>
              <p className="t-meta mt-0.5">
                {DEPTH_INFO[report.depth].label} research · generated {dateTime(report.generatedAt)}
                {report.model ? ` · model ${report.model}` : " · extraction only (no language model)"}
              </p>
            </div>
            <Badge tone={report.confidence === "high" ? "success" : report.confidence === "medium" ? "warning" : "neutral"}>Confidence: {report.confidence}</Badge>
          </div>
          {report.warnings.length > 0 && (
            <div className="mt-3">
              <InlineAlert tone="warning" title="Research notes">
                <ul className="list-disc space-y-0.5 pl-4">
                  {report.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </InlineAlert>
            </div>
          )}
        </header>

        <section className="border-b border-border bg-subtle/40 px-5 py-4" aria-labelledby="sec-1">
          <h3 id="sec-1" className="t-card-title mb-2">1. Executive summary</h3>
          {summary?.body ? <Prose text={summary.body} /> : <p className="text-sm text-fg-3">No summary — {report.model ? "the sources did not support one." : "a language model is required to write summaries."}</p>}
        </section>

        {report.sections
          .filter((s) => s.key !== "executive_summary")
          .map((s, i) => {
            const items = evidence.filter((e) => e.section === s.key);
            const open = openSections.has(s.key);
            return (
              <section key={s.key} className="border-b border-border px-5 py-4" aria-labelledby={`sec-${s.key}`}>
                <h3 id={`sec-${s.key}`} className="t-card-title mb-2">
                  {i + 2}. {s.title}
                </h3>
                {s.body ? <Prose text={s.body} /> : !items.length && <p className="text-sm text-fg-3">No information found in the retrieved sources.</p>}
                {items.length > 0 && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setOpenSections((x) => (x.has(s.key) ? new Set([...x].filter((k) => k !== s.key)) : new Set([...x, s.key])))}
                      aria-expanded={open}
                      className="inline-flex items-center gap-1 text-xs font-medium text-fg-2 hover:text-fg"
                    >
                      <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
                      {items.length} supporting claim{items.length === 1 ? "" : "s"}
                    </button>
                    {open && (
                      <div className="mt-1">
                        <EvidenceList items={items} actions={reviewedAction} />
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}

        <section className="border-b border-border px-5 py-4" aria-labelledby="sec-conf">
          <h3 id="sec-conf" className="t-card-title mb-2">11. Research confidence</h3>
          <p className="max-w-prose text-sm text-fg">{report.confidenceRationale || "No rationale recorded."}</p>
          <table className="mt-3 w-full max-w-md text-left text-sm">
            <caption className="sr-only">Claims by evidence classification</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-1.5 t-th">Classification</th>
                <th scope="col" className="py-1.5 text-right t-th">Claims</th>
              </tr>
            </thead>
            <tbody>
              {counts.map(({ c, n }) => (
                <tr key={c} className="border-b border-border last:border-0">
                  <td className="py-1.5">{EVIDENCE_LABELS[c]}</td>
                  <td className="py-1.5 text-right tnum">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="px-5 py-4" aria-labelledby="sec-src">
          <h3 id="sec-src" className="t-card-title mb-2">12. Sources</h3>
          {sources.length ? (
            <ol className="space-y-1.5">
              {sources.map((e, i) => (
                <li key={e.sourceUrl} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="tnum w-5 text-right text-fg-3">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate">{e.sourceTitle ?? e.sourceUrl}</span>
                  <SourceReference url={e.sourceUrl} title={e.sourceTitle} retrievedAt={e.retrievedAt} publishedAt={e.publishedAt} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-fg-3">No cited sources.</p>
          )}
        </section>
      </article>

      <aside className="space-y-5 xl:sticky xl:top-[calc(var(--header-h)+24px)] xl:self-start">
        <div className="panel p-4">
          <h2 className="t-card-title mb-3">Research controls</h2>
          <div className="flex flex-col gap-2">
            <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => run(report.depth)} loading={queue.isPending} disabled={poll}>
              Refresh research
            </Button>
            {report.depth !== "deep" && (
              <Button size="sm" icon={<Layers size={14} />} onClick={() => run("deep")} disabled={poll}>
                Increase to deep research
              </Button>
            )}
            <Button size="sm" icon={<RotateCw size={14} />} onClick={onEnrich} disabled={!b.website || poll}>
              Retry website sources
            </Button>
            <Button size="sm" icon={<Download size={14} />} onClick={onExport}>
              Export report
            </Button>
          </div>
          <p className="t-meta mt-3">
            Reviewed claims: <span className="tnum">{evidence.filter((e) => e.reviewed).length}</span> of <span className="tnum">{evidence.length}</span>. Use the circle beside a claim to mark it reviewed.
          </p>
        </div>
        <NotesPanel id={id} />
      </aside>
    </div>
  );
}

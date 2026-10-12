import { useState } from "react";
import { Link } from "react-router-dom";
import { HelpCircle, RefreshCw, Target, Undo2 } from "lucide-react";
import type { QualificationStatus } from "@/lib/types";
import { api, errorMessage } from "@/lib/api";
import { keys, useEvidence, useInvalidate, useOpportunity } from "@/lib/queries";
import { relativeTime } from "@/lib/format";
import { Panel } from "../ui/Page";
import { Button } from "../ui/Button";
import { Field, Select, Textarea } from "../ui/Field";
import { Dialog } from "../ui/Dialog";
import { BlockSkeleton, EmptyState, InlineAlert } from "../ui/States";
import { useToast } from "../ui/Toast";
import { QUALIFICATION_OPTIONS, QualificationBadge } from "../business/badges";
import { EvidenceList, Prose } from "./shared";
import { ScoreBreakdown } from "./ScoreBreakdown";
import type { TabProps } from "@/pages/Company";

export function OpportunityTab({ id, poll, onResearch }: TabProps) {
  const { data, isLoading } = useOpportunity(id, poll);
  const { data: evidence = [] } = useEvidence(id, poll);
  const inv = useInvalidate();
  const toast = useToast();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [status, setStatus] = useState<QualificationStatus>("qualified");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const opp = data?.opportunity;

  const call = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await inv(["business", id], ["businesses"], keys.opportunities, keys.overview);
      toast.success(ok);
      return true;
    } catch (e) {
      toast.error("Action failed", errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <div className="panel"><BlockSkeleton lines={8} /></div>;
  if (!opp)
    return (
      <div className="panel">
        <EmptyState
          icon={<Target size={18} />}
          title="Not scored yet"
          description="Scores are computed from your workspace’s qualification criteria after research."
          action={
            <>
              <Button variant="primary" size="sm" onClick={onResearch}>Start research</Button>
              <Button size="sm" loading={busy} onClick={() => call(() => api.post(`/businesses/${id}/opportunity/rescore`), "Score calculated")}>Score with current data</Button>
            </>
          }
        />
      </div>
    );

  const supporting = evidence.filter((e) => opp.evidenceIds.includes(e.id));

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Panel
          title="Potential opportunity"
          id="opp"
          actions={
            <Link to="/settings/qualification" className="text-xs font-medium text-fg-2 hover:text-fg">
              Criteria
            </Link>
          }
        >
          <div className="space-y-4 p-4">
            <InlineAlert tone="info" title="Fit is not proof of need">
              The score reflects how well this company matches your configured criteria. It does not establish that the company has a specific problem.
            </InlineAlert>
            {opp.opportunity ? <Prose text={opp.opportunity} /> : <p className="text-sm text-fg-3">No opportunity narrative — this requires research with a language model and an offering description in Settings.</p>}
            <div>
              <h3 className="t-label mb-1">Supporting evidence</h3>
              <EvidenceList items={supporting} empty={<p className="text-sm text-fg-3">No source-backed evidence of the configured needs.</p>} />
            </div>
          </div>
        </Panel>
        <div className="grid gap-5 md:grid-cols-2">
          <Panel title="Information gaps" id="gaps">
            {opp.gaps.length ? (
              <ul className="space-y-1.5 p-4 text-sm">
                {opp.gaps.map((g) => (
                  <li key={g} className="flex gap-2">
                    <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-fg-3" aria-hidden />
                    {g}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-fg-3">No major gaps recorded.</p>
            )}
          </Panel>
          <Panel title="Suggested discovery questions" id="qs">
            <ul className="space-y-1.5 p-4 text-sm">
              {opp.questions.map((q) => (
                <li key={q} className="flex gap-2">
                  <HelpCircle size={14} className="mt-0.5 shrink-0 text-fg-3" aria-hidden />
                  {q}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="space-y-5">
        <Panel title="Qualification score" id="score" actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={busy} onClick={() => call(() => api.post(`/businesses/${id}/opportunity/rescore`), "Score recalculated")}>Rescore</Button>}>
          <ScoreBreakdown opp={opp} />
        </Panel>
        <Panel title="Qualification status" id="qstatus">
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <QualificationBadge status={opp.qualificationStatus} />
              <span className="t-meta">{opp.overriddenBy ? "Set manually" : "Set automatically from score"} · {relativeTime(opp.updatedAt)}</span>
            </div>
            {opp.nextAction && (
              <p className="text-sm">
                <span className="t-label">Next suggested action: </span>
                {opp.nextAction}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => (setStatus(opp.qualificationStatus === "qualified" ? "disqualified" : "qualified"), setOverrideOpen(true))}>
                Override status
              </Button>
              {opp.overriddenBy && (
                <Button size="sm" variant="ghost" icon={<Undo2 size={14} />} loading={busy} onClick={() => call(() => api.post(`/businesses/${id}/qualification/reset`), "Reverted to automatic status")}>
                  Use automatic
                </Button>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <Dialog
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        title="Override qualification status"
        description="Manual status is kept when scores are recalculated. The change and reason are recorded in the activity log."
        footer={
          <>
            <Button onClick={() => setOverrideOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                if (await call(() => api.post(`/businesses/${id}/qualification`, { status, reason: reason.trim() || undefined }), "Qualification status updated")) {
                  setOverrideOpen(false);
                  setReason("");
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Status" htmlFor="ov-status">
            <Select id="ov-status" value={status} onChange={(e) => setStatus(e.target.value as QualificationStatus)}>
              {QUALIFICATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Reason" optional htmlFor="ov-reason">
            <Textarea id="ov-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Confirmed on a call that they are evaluating vendors" />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

import { AlertTriangle, Ban, Check, CheckCheck, CircleDashed, CircleDot, Clock, Globe, Loader, Search, ShieldCheck, ShieldQuestion, X, XCircle } from "lucide-react";
import { EVIDENCE_LABELS, RESEARCH_STATUS_LABELS, VERIFICATION_LABELS } from "@shared/domain";
import type { ContactVerification, EvidenceClass, QualificationStatus, ResearchStatus, SearchStatus } from "@/lib/types";
import { Badge, type Tone } from "../ui/primitives";

const RS: Record<ResearchStatus, { tone: Tone; icon: JSX.Element }> = {
  discovered: { tone: "neutral", icon: <CircleDashed size={12} /> },
  website_identified: { tone: "neutral", icon: <Globe size={12} /> },
  enrichment_pending: { tone: "info", icon: <Clock size={12} /> },
  research_in_progress: { tone: "info", icon: <Loader size={12} className="animate-spin" /> },
  completed: { tone: "success", icon: <Check size={12} /> },
  completed_with_warnings: { tone: "warning", icon: <AlertTriangle size={12} /> },
  failed: { tone: "danger", icon: <XCircle size={12} /> },
};

export function ResearchStatusBadge({ status }: { status: ResearchStatus }) {
  const s = RS[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {RESEARCH_STATUS_LABELS[status]}
    </Badge>
  );
}

const SS: Record<SearchStatus, { tone: Tone; label: string; icon: JSX.Element }> = {
  queued: { tone: "neutral", label: "Queued", icon: <Clock size={12} /> },
  running: { tone: "info", label: "Running", icon: <Loader size={12} className="animate-spin" /> },
  completed: { tone: "success", label: "Completed", icon: <Check size={12} /> },
  completed_with_warnings: { tone: "warning", label: "Completed with warnings", icon: <AlertTriangle size={12} /> },
  failed: { tone: "danger", label: "Failed", icon: <XCircle size={12} /> },
  cancelled: { tone: "neutral", label: "Cancelled", icon: <Ban size={12} /> },
};

export function SearchStatusBadge({ status }: { status: SearchStatus }) {
  const s = SS[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

const EV: Record<EvidenceClass, Tone> = { verified_fact: "success", third_party: "info", inference: "primary", hypothesis: "warning", unknown: "neutral" };
const EV_HELP: Record<EvidenceClass, string> = {
  verified_fact: "Stated on the company's official website, with a matching excerpt.",
  third_party: "Stated by a third-party source, with a matching excerpt.",
  inference: "Reasonably implied by the cited text; not stated directly.",
  hypothesis: "Not supported by a source. Treat as an idea to verify.",
  unknown: "Not enough information.",
};

export function EvidenceBadge({ cls }: { cls: EvidenceClass }) {
  return (
    <Badge tone={EV[cls]} title={EV_HELP[cls]}>
      {EVIDENCE_LABELS[cls]}
    </Badge>
  );
}

const VER: Record<ContactVerification, { tone: Tone; icon: JSX.Element }> = {
  official_website: { tone: "success", icon: <Globe size={12} /> },
  permitted_source: { tone: "info", icon: <CircleDot size={12} /> },
  provider_supplied: { tone: "neutral", icon: <Search size={12} /> },
  verified: { tone: "success", icon: <ShieldCheck size={12} /> },
  unverified: { tone: "warning", icon: <ShieldQuestion size={12} /> },
  invalid: { tone: "danger", icon: <X size={12} /> },
};

export function VerificationBadge({ v }: { v: ContactVerification }) {
  return (
    <Badge tone={VER[v].tone} icon={VER[v].icon}>
      {VERIFICATION_LABELS[v]}
    </Badge>
  );
}

const QS: Record<QualificationStatus, { tone: Tone; label: string; icon: JSX.Element }> = {
  unreviewed: { tone: "neutral", label: "Unreviewed", icon: <CircleDashed size={12} /> },
  needs_review: { tone: "warning", label: "Needs review", icon: <Clock size={12} /> },
  qualified: { tone: "success", label: "Qualified", icon: <CheckCheck size={12} /> },
  disqualified: { tone: "neutral", label: "Disqualified", icon: <Ban size={12} /> },
};

export function QualificationBadge({ status }: { status: QualificationStatus }) {
  const s = QS[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

export const QUALIFICATION_OPTIONS: { value: QualificationStatus; label: string }[] = (Object.keys(QS) as QualificationStatus[]).map((k) => ({ value: k, label: QS[k].label }));

/** Score shown as number plus a small bar; color encodes band but the number always carries the meaning. */
export function ScorePill({ score }: { score: number | null }) {
  if (score == null) return <span className="text-sm text-fg-3">—</span>;
  const tone = score >= 70 ? "bg-success" : score >= 45 ? "bg-warning" : "bg-fg-3";
  return (
    <span className="inline-flex items-center gap-2" aria-label={`Opportunity score ${score} of 100`}>
      <span className="tnum w-6 text-right text-sm font-semibold">{score}</span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={`block h-full ${tone}`} style={{ width: `${score}%` }} />
      </span>
    </span>
  );
}

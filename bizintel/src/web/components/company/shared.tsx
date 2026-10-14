import { useState, type ReactNode } from "react";
import { ChevronDown, Quote } from "lucide-react";
import type { Evidence } from "@/lib/types";
import { cn } from "@/lib/format";
import { EvidenceBadge } from "../business/badges";
import { SourceReference } from "../business/SourceReference";

/** A single claim with its classification, source chip, and an expandable verbatim excerpt. */
export function EvidenceItem({ e, index, actions }: { e: Evidence; index?: number; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const hasExcerpt = Boolean(e.excerpt && e.excerpt !== e.claim && !/^schema\.org|^Published in the site/.test(e.excerpt));
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <p className="min-w-0 flex-1 basis-64 text-sm leading-relaxed text-fg">{e.claim}</p>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <EvidenceBadge cls={e.classification} />
          {e.sourceUrl && <SourceReference url={e.sourceUrl} title={e.sourceTitle} retrievedAt={e.retrievedAt} publishedAt={e.publishedAt} index={index} />}
          {actions}
        </div>
      </div>
      {hasExcerpt && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-fg-3 hover:text-fg">
            <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} /> Supporting excerpt
          </button>
          {open && (
            <blockquote className="mt-1.5 flex gap-2 rounded border-l-2 border-border-strong bg-subtle/70 px-3 py-2 text-sm italic text-fg-2">
              <Quote size={12} className="mt-1 shrink-0 text-fg-3" aria-hidden />
              <span>{e.excerpt}</span>
            </blockquote>
          )}
        </>
      )}
      {!e.sourceUrl && e.classification === "hypothesis" && <p className="mt-1 text-xs text-warning">No source supports this statement. Verify before relying on it.</p>}
    </li>
  );
}

export function EvidenceList({ items, empty, actions }: { items: Evidence[]; empty?: ReactNode; actions?: (e: Evidence) => ReactNode }) {
  if (!items.length) return <>{empty ?? null}</>;
  return (
    <ul className="divide-y divide-border">
      {items.map((e) => (
        <EvidenceItem key={e.id} e={e} actions={actions?.(e)} />
      ))}
    </ul>
  );
}

export function Prose({ text }: { text: string }) {
  return (
    <div className="max-w-prose space-y-2 text-sm leading-relaxed text-fg">
      {text.split(/\n+/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

export function NotResearched({ action }: { action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border-strong px-4 py-6 text-center">
      <p className="text-sm font-medium">Not researched yet</p>
      <p className="mt-1 text-sm text-fg-2">Run Standard or Deep research to inspect this company’s website and build an evidence-backed profile.</p>
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

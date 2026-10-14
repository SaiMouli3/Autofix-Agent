import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FilePlus2, Mail, Search, Sparkles } from "lucide-react";
import type { Business } from "@/lib/types";
import { api, errorMessage } from "@/lib/api";
import { keys, useBusinesses, useConfig, useDrafts, useInvalidate, useProviders } from "@/lib/queries";
import { useDebounced } from "@/lib/useDebounced";
import { cn, relativeTime } from "@/lib/format";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, InlineAlert, TableSkeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";

function NewDraftDialog({ open, onClose, llmReady }: { open: boolean; onClose: () => void; llmReady: boolean }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Business | null>(null);
  const [busy, setBusy] = useState<"gen" | "blank" | null>(null);
  const dq = useDebounced(q, 250);
  const { data, isFetching } = useBusinesses({ q: dq || undefined, researchStatus: ["completed", "completed_with_warnings"], pageSize: 8, sort: "updatedAt", dir: "desc" });
  const navigate = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();

  const create = async (mode: "gen" | "blank") => {
    if (!picked) return;
    setBusy(mode);
    try {
      const d = await api.post<{ id: string }>(mode === "gen" ? "/outreach/drafts/generate" : "/outreach/drafts", { businessId: picked.id });
      await inv(keys.drafts);
      navigate(`/outreach/${d.id}`);
    } catch (e) {
      toast.error(mode === "gen" ? "Couldn’t generate a draft" : "Couldn’t create the draft", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New outreach draft"
      description="Choose a researched company. Generated drafts use only source-backed facts and are never sent automatically."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button icon={<FilePlus2 size={14} />} disabled={!picked} loading={busy === "blank"} onClick={() => create("blank")}>Blank draft</Button>
          <Button variant="primary" icon={<Sparkles size={14} />} disabled={!picked || !llmReady} loading={busy === "gen"} onClick={() => create("gen")} title={!llmReady ? "Requires a configured language model" : undefined}>
            Generate draft
          </Button>
        </>
      }
    >
      <Input icon={<Search size={14} />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search researched companies" aria-label="Search researched companies" data-autofocus />
      <ul className="mt-2 max-h-[300px] overflow-y-auto" role="listbox" aria-label="Researched companies" aria-busy={isFetching}>
        {data?.items.map((b) => (
          <li key={b.id} role="option" aria-selected={picked?.id === b.id}>
            <button type="button" onClick={() => setPicked(b)} className={cn("flex w-full flex-col rounded px-2.5 py-2 text-left", picked?.id === b.id ? "bg-primary-subtle" : "hover:bg-subtle")}>
              <span className="text-sm font-medium">{b.name}</span>
              <span className="t-meta">{[b.category, b.city].filter(Boolean).join(" · ")}</span>
            </button>
          </li>
        ))}
        {data && !data.items.length && <li className="px-2 py-6 text-center text-sm text-fg-2">No researched companies match. Research a company first so drafts can be grounded in evidence.</li>}
      </ul>
      {!llmReady && <p className="t-meta mt-2">Generation requires a language model (Data Sources). You can still write blank drafts.</p>}
    </Dialog>
  );
}

export default function Outreach() {
  const { data: cfg } = useConfig();
  useCrumbs([{ label: "Outreach" }], cfg?.branding.productName);
  const { data: drafts, isLoading, isError, error, refetch } = useDrafts();
  const { data: providers } = useProviders();
  const [open, setOpen] = useState(false);
  const llmReady = Boolean(providers?.find((p) => p.key === "llm")?.configured);
  const offeringMissing = cfg && !cfg.qualification.offeringDescription.trim();

  return (
    <PageBody>
      <PageHeader title="Outreach" subtitle="Draft personalized emails from research evidence. Review and edit everything before use — nothing is sent from here." actions={<Button variant="primary" icon={<Mail size={15} />} onClick={() => setOpen(true)}>New draft</Button>} />
      {offeringMissing && llmReady && (
        <div className="mb-4">
          <InlineAlert tone="info" title="Describe your offering to enable generated drafts" action={<Link to="/settings/qualification" className="text-sm font-medium text-primary hover:underline">Settings</Link>}>
            Drafts explain why you are reaching out, so they need a short description of what your team offers.
          </InlineAlert>
        </div>
      )}
      <div className="panel overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={4} cols={3} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !drafts?.length ? (
          <EmptyState icon={<Mail size={18} />} title="No drafts yet" description="Start from a researched company. Drafts cite the facts they use." action={<Button variant="primary" size="sm" onClick={() => setOpen(true)}>New draft</Button>} />
        ) : (
          <ul className="divide-y divide-border">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link to={`/outreach/${d.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-subtle/60">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.subject || <span className="text-fg-3">Untitled draft</span>}</div>
                    <div className="t-meta truncate">{d.body.slice(0, 140) || "Empty"}</div>
                  </div>
                  <div className="t-meta shrink-0 text-right">
                    {d.model ? "Generated" : "Manual"} · {relativeTime(d.updatedAt)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <NewDraftDialog open={open} onClose={() => setOpen(false)} llmReady={llmReady} />
    </PageBody>
  );
}

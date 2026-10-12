import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Copy, Download, RefreshCw, Save, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { keys, useBusiness, useConfig, useContacts, useDraft, useEvidence, useInvalidate } from "@/lib/queries";
import { relativeTime } from "@/lib/format";
import type { OutreachDraft } from "@/lib/types";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader, Panel } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { BlockSkeleton, ErrorState, InlineAlert } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { EvidenceItem } from "@/components/company/shared";

type Editable = Pick<OutreachDraft, "subject" | "body" | "followUp" | "discoveryQuestion" | "contactId">;

export default function OutreachEditor() {
  const { draftId = "" } = useParams();
  const { data: cfg } = useConfig();
  const { data: draft, isLoading, isError, error, refetch } = useDraft(draftId);
  const bid = draft?.businessId ?? "";
  const { data: biz } = useBusiness(bid);
  const { data: contacts = [] } = useContacts(bid);
  const { data: evidence = [] } = useEvidence(bid);
  useCrumbs([{ label: "Outreach", to: "/outreach" }, { label: biz?.business.name ?? "Draft" }], cfg?.branding.productName);
  const [form, setForm] = useState<Editable | null>(null);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inv = useInvalidate();
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (draft) setForm({ subject: draft.subject, body: draft.body, followUp: draft.followUp, discoveryQuestion: draft.discoveryQuestion, contactId: draft.contactId });
  }, [draft]);

  if (isLoading || (draft && !form)) return <PageBody wide><BlockSkeleton lines={8} /></PageBody>;
  if (isError || !draft || !form) return <PageBody><ErrorState error={error} onRetry={() => refetch()} /></PageBody>;

  const dirty = form.subject !== draft.subject || form.body !== draft.body || form.followUp !== draft.followUp || form.discoveryQuestion !== draft.discoveryQuestion || form.contactId !== draft.contactId;
  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const used = evidence.filter((e) => draft.evidenceIds.includes(e.id));
  const facts = evidence.filter((e) => (e.classification === "verified_fact" || e.classification === "third_party") && !draft.evidenceIds.includes(e.id));
  const asText = `Subject: ${form.subject}\n\n${form.body}\n\n---\nFollow-up:\n${form.followUp}\n\nDiscovery question: ${form.discoveryQuestion}\n`;
  const emails = contacts.filter((c) => c.email);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/outreach/drafts/${draftId}`, form);
      await inv(keys.drafts);
      toast.success("Draft saved");
    } catch (e) {
      toast.error("Couldn’t save the draft", errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageBody wide>
      <PageHeader
        title={form.subject || "Untitled draft"}
        meta={
          <>
            <Link to={`/businesses/${bid}`} className="link">{biz?.business.name}</Link>
            <span className="text-fg-3">{draft.model ? `Generated with ${draft.model}` : "Written manually"} · updated {relativeTime(draft.updatedAt)}</span>
          </>
        }
        actions={
          <>
            <Button size="sm" icon={<Copy size={14} />} onClick={async () => {
              try {
                await navigator.clipboard.writeText(asText);
                toast.success("Draft copied to clipboard");
              } catch {
                toast.error("Couldn’t copy", "Your browser blocked clipboard access.");
              }
            }}>Copy</Button>
            <Button size="sm" icon={<Download size={14} />} onClick={() => {
              const url = URL.createObjectURL(new Blob([asText], { type: "text/plain;charset=utf-8" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = `${(biz?.business.name ?? "draft").replace(/[^\w\- ]+/g, "_")} outreach.txt`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}>Export</Button>
            <Button size="sm" icon={<RefreshCw size={14} />} loading={regenerating} onClick={async () => {
              setRegenerating(true);
              try {
                const d = await api.post<{ id: string }>("/outreach/drafts/generate", { businessId: bid, contactId: form.contactId });
                await inv(keys.drafts);
                toast.success("New draft generated", "The previous version is kept in your drafts.");
                navigate(`/outreach/${d.id}`);
              } catch (e) {
                toast.error("Couldn’t regenerate", errorMessage(e));
              } finally {
                setRegenerating(false);
              }
            }}>Regenerate</Button>
            <Button size="sm" icon={<Trash2 size={14} />} onClick={() => setDeleting(true)}>Delete</Button>
            <Button size="sm" variant="primary" icon={<Save size={14} />} loading={saving} disabled={!dirty} onClick={save}>Save draft</Button>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <Panel title="Facts used for personalization" id="used" description="Only these source-backed facts were given to the model.">
            <ul className="divide-y divide-border px-4">
              {used.length ? used.map((e) => <EvidenceItem key={e.id} e={e} />) : <li className="py-3 text-sm text-fg-3">{draft.model ? "The model did not report using any facts." : "Manual draft."}</li>}
            </ul>
          </Panel>
          <Panel title="Other research evidence" id="other">
            <ul className="max-h-[340px] divide-y divide-border overflow-y-auto px-4">
              {facts.length ? facts.map((e) => <EvidenceItem key={e.id} e={e} />) : <li className="py-3 text-sm text-fg-3">No other verified facts.</li>}
            </ul>
          </Panel>
        </aside>
        <section className="panel p-4" aria-label="Draft editor">
          <InlineAlert tone="info" title="Review before use">
            Check every statement against the evidence. Drafts are never sent from this application.
          </InlineAlert>
          <div className="mt-4 space-y-4">
            <Field label="Recipient" htmlFor="d-to" hint={emails.length ? "Public addresses found during research." : "No public email was found for this company."}>
              <Select id="d-to" value={form.contactId ?? ""} onChange={(e) => set("contactId", e.target.value || null)}>
                <option value="">No specific contact</option>
                {emails.map((c) => <option key={c.id} value={c.id}>{c.email} ({c.type})</option>)}
              </Select>
            </Field>
            <Field label="Subject" htmlFor="d-subject"><Input id="d-subject" value={form.subject} onChange={(e) => set("subject", e.target.value)} maxLength={300} /></Field>
            <Field label="Email body" htmlFor="d-body"><Textarea id="d-body" value={form.body} onChange={(e) => set("body", e.target.value)} className="min-h-[260px]" maxLength={10000} /></Field>
            <Field label="Follow-up draft" htmlFor="d-follow"><Textarea id="d-follow" value={form.followUp} onChange={(e) => set("followUp", e.target.value)} className="min-h-[120px]" maxLength={10000} /></Field>
            <Field label="Suggested discovery question" htmlFor="d-q"><Input id="d-q" value={form.discoveryQuestion} onChange={(e) => set("discoveryQuestion", e.target.value)} maxLength={1000} /></Field>
          </div>
          {dirty && <p className="mt-3 text-xs text-warning" role="status">Unsaved changes</p>}
        </section>
      </div>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        tone="danger"
        title="Delete this draft?"
        confirmLabel="Delete draft"
        onConfirm={async () => {
          try {
            await api.del(`/outreach/drafts/${draftId}`);
            await inv(keys.drafts);
            toast.success("Draft deleted");
            navigate("/outreach");
          } catch (e) {
            toast.error("Couldn’t delete", errorMessage(e));
          }
        }}
      />
    </PageBody>
  );
}

import { useState } from "react";
import { Download, FileSpreadsheet, Plus } from "lucide-react";
import type { ExportRecord, ExportScope } from "@/lib/types";
import { useConfig, useExports, useLists, useSearches } from "@/lib/queries";
import { dateTime, relativeTime } from "@/lib/format";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader, Panel } from "@/components/ui/Page";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/ui/States";
import { Badge, Dot, type Tone } from "@/components/ui/primitives";
import { ExportDialog, SCOPE_LABELS } from "@/components/business/dialogs";

const TONE: Record<ExportRecord["status"], Tone> = { queued: "neutral", running: "info", completed: "success", failed: "danger" };
const LABEL: Record<ExportRecord["status"], string> = { queued: "Queued", running: "Generating", completed: "Ready", failed: "Failed" };

type ScopeKind = Exclude<ExportScope["kind"], "selected">;

export default function Exports() {
  const { data: cfg } = useConfig();
  useCrumbs([{ label: "Exports" }], cfg?.branding.productName);
  const { data, isLoading, isError, error, refetch } = useExports();
  const { data: lists } = useLists();
  const { data: searches } = useSearches(100);
  const [kind, setKind] = useState<ScopeKind>("all");
  const [ref, setRef] = useState("");
  const [open, setOpen] = useState(false);

  const scope: ExportScope | null = kind === "list" ? (ref ? { kind, listId: ref } : null) : kind === "search" ? (ref ? { kind, searchId: ref } : null) : { kind };
  const now = new Date().toISOString();

  return (
    <PageBody wide>
      <PageHeader title="Export center" subtitle="Create CSV or Excel exports. Exports run in the background and stay available for download until they expire." />
      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Panel title="New export" id="new-export" bodyClassName="space-y-4 p-4">
          <Field label="Records" htmlFor="ex-scope">
            <Select id="ex-scope" value={kind} onChange={(e) => (setKind(e.target.value as ScopeKind), setRef(""))}>
              {(["all", "search", "list", "qualified", "with_email", "with_phone", "researched"] as ScopeKind[]).map((k) => (
                <option key={k} value={k}>{SCOPE_LABELS[k]}</option>
              ))}
            </Select>
          </Field>
          {kind === "list" && (
            <Field label="List" htmlFor="ex-list">
              <Select id="ex-list" value={ref} onChange={(e) => setRef(e.target.value)}>
                <option value="">Choose a list…</option>
                {lists?.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.count})</option>)}
              </Select>
            </Field>
          )}
          {kind === "search" && (
            <Field label="Search" htmlFor="ex-search">
              <Select id="ex-search" value={ref} onChange={(e) => setRef(e.target.value)}>
                <option value="">Choose a search…</option>
                {searches?.items.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.counters.unique})</option>)}
              </Select>
            </Field>
          )}
          <p className="t-meta">To export hand-picked businesses, select them in any table and choose Export.</p>
          <Button variant="primary" className="w-full" icon={<Plus size={15} />} disabled={!scope} onClick={() => setOpen(true)}>
            Choose columns &amp; export
          </Button>
        </Panel>

        <Panel title="Export history" id="export-history">
          {isLoading ? (
            <TableSkeleton rows={4} />
          ) : isError ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : !data?.length ? (
            <EmptyState icon={<FileSpreadsheet size={18} />} title="No exports yet" description="Exports you create appear here with their status and download link." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-subtle/60">
                  <tr className="h-9 border-b border-border">
                    <th scope="col" className="px-4 t-th">Export</th>
                    <th scope="col" className="px-3 t-th">Format</th>
                    <th scope="col" className="px-3 text-right t-th">Records</th>
                    <th scope="col" className="hidden px-3 t-th md:table-cell">Created</th>
                    <th scope="col" className="px-3 t-th">Status</th>
                    <th scope="col" className="hidden px-3 t-th lg:table-cell">Expires</th>
                    <th scope="col" className="pr-4"><span className="sr-only">Download</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((e) => {
                    const expired = Boolean(e.expiresAt && e.expiresAt < now);
                    return (
                      <tr key={e.id} className="h-row border-b border-border last:border-0">
                        <th scope="row" className="max-w-[280px] px-4 font-normal">
                          <div className="truncate text-sm font-medium">{e.name}</div>
                          <div className="t-meta truncate">{SCOPE_LABELS[e.scope.kind]}{e.scope.kind === "selected" ? ` (${e.scope.businessIds.length})` : ""}</div>
                        </th>
                        <td className="px-3 text-sm uppercase text-fg-2">{e.format}</td>
                        <td className="px-3 text-right text-sm tnum">{e.recordCount?.toLocaleString() ?? "—"}</td>
                        <td className="hidden px-3 text-sm text-fg-2 md:table-cell" title={dateTime(e.createdAt)}>{relativeTime(e.createdAt)}</td>
                        <td className="px-3">
                          <Badge tone={expired ? "neutral" : TONE[e.status]} icon={<Dot tone={expired ? "neutral" : TONE[e.status]} pulse={e.status === "running"} />} title={e.error ?? undefined}>
                            {expired ? "Expired" : LABEL[e.status]}
                          </Badge>
                          {e.status === "failed" && e.error && <div className="mt-0.5 max-w-[220px] truncate text-xs text-danger" title={e.error}>{e.error}</div>}
                        </td>
                        <td className="hidden px-3 text-sm text-fg-2 lg:table-cell">{e.expiresAt ? dateTime(e.expiresAt) : "—"}</td>
                        <td className="pr-4 text-right">
                          {e.status === "completed" && !expired && (
                            <a href={`/api/exports/${e.id}/download`} className="inline-flex h-control-sm items-center gap-1.5 rounded border border-border bg-surface px-2.5 text-sm font-medium shadow-xs hover:bg-subtle" download>
                              <Download size={14} /> Download
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {open && scope && <ExportDialog open onClose={() => setOpen(false)} scope={scope} />}
    </PageBody>
  );
}

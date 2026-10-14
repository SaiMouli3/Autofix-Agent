import { useState } from "react";
import { Download, ExternalLink, Globe, Users } from "lucide-react";
import type { Business, Contact, ContactType } from "@/lib/types";
import { useContacts } from "@/lib/queries";
import { dateTime, relativeTime } from "@/lib/format";
import { Panel } from "../ui/Page";
import { Button, IconButton } from "../ui/Button";
import { Checkbox } from "../ui/Field";
import { EmptyState, ErrorState, TableSkeleton } from "../ui/States";
import { VerificationBadge } from "../business/badges";
import { CopyButton } from "../business/CopyButton";
import { ExportDialog } from "../business/dialogs";
import type { TabProps } from "@/pages/Company";

const GROUPS: { type: ContactType; label: string }[] = [
  { type: "general", label: "General business contacts" },
  { type: "sales", label: "Sales contacts" },
  { type: "support", label: "Support contacts" },
  { type: "department", label: "Department contacts" },
  { type: "person", label: "Publicly identified individual addresses" },
];

function Row({ c, selected, onSelect }: { c: Contact; selected: boolean; onSelect: (v: boolean) => void }) {
  return (
    <tr className="h-row border-b border-border last:border-0 hover:bg-subtle/60">
      <td className="w-10 pl-4">
        <Checkbox aria-label={`Select ${c.email ?? c.phone}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} />
      </td>
      <td className="px-3 text-sm">{c.name ?? <span className="text-fg-3">—</span>}{c.title && <div className="t-meta">{c.title}</div>}</td>
      <td className="px-3">
        {c.email ? (
          <span className="inline-flex items-center gap-1 text-sm">
            <span className="max-w-[240px] truncate">{c.email}</span>
            <CopyButton value={c.email} label={`Copy ${c.email}`} />
          </span>
        ) : (
          <span className="text-sm text-fg-3">—</span>
        )}
      </td>
      <td className="px-3">
        {c.phone ? (
          <span className="inline-flex items-center gap-1 text-sm tnum">
            {c.phone}
            <CopyButton value={c.phone} label={`Copy ${c.phone}`} />
          </span>
        ) : (
          <span className="text-sm text-fg-3">—</span>
        )}
      </td>
      <td className="hidden max-w-[200px] truncate px-3 text-sm text-fg-2 xl:table-cell">{c.location ?? "—"}</td>
      <td className="px-3">
        <VerificationBadge v={c.verification} />
      </td>
      <td className="hidden px-3 text-sm text-fg-2 lg:table-cell" title={dateTime(c.lastCheckedAt)}>
        {relativeTime(c.lastCheckedAt)}
      </td>
      <td className="pr-3 text-right">
        {c.sourceUrl && (
          <IconButton label="Open source page" size="sm" onClick={() => window.open(c.sourceUrl!, "_blank", "noopener")}>
            <ExternalLink size={14} />
          </IconButton>
        )}
      </td>
    </tr>
  );
}

const cell = (v: string | null) => {
  if (v == null) return "";
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Selected contacts are already in the browser, so they are exported client-side as CSV. */
function downloadCsv(company: string, rows: Contact[]) {
  const header = ["Company", "Type", "Name", "Title", "Email", "Phone", "Source", "Verification", "Last checked"];
  const lines = [header, ...rows.map((c) => [company, c.type, c.name, c.title, c.email, c.phone, c.sourceUrl ?? c.sourceLabel, c.verification, c.lastCheckedAt])].map((r) => r.map(cell).join(","));
  const url = URL.createObjectURL(new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${company.replace(/[^\w\- ]+/g, "_")} contacts.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ContactsTab({ id, poll, onResearch, business: b }: TabProps & { business: Business }) {
  const { data, isLoading, isError, error, refetch } = useContacts(id, poll);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  if (isLoading) return <div className="panel"><TableSkeleton rows={4} /></div>;
  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />;
  const contacts = data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-fg-2">
          Contact details published by the business. Verification reflects where a value was found — an address published on the official website is not proof it is monitored or deliverable. Nothing is sent from this application.
        </p>
        <div className="flex gap-2">
          {b.website && (
            <Button size="sm" icon={<Globe size={14} />} onClick={() => window.open(b.website!, "_blank", "noopener")}>
              Open website
            </Button>
          )}
          <Button size="sm" icon={<Download size={14} />} disabled={!sel.size} onClick={() => downloadCsv(b.name, contacts.filter((c) => sel.has(c.id)))}>
            Export selected{sel.size ? ` (${sel.size})` : ""}
          </Button>
          <Button size="sm" icon={<Download size={14} />} disabled={!contacts.length} onClick={() => setExporting(true)}>
            Export company…
          </Button>
        </div>
      </div>
      {contacts.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Users size={18} />}
            title="No contact records yet"
            description={b.website ? "Research this company to inspect its official website for published contact details." : "No official website has been identified, so no website contacts could be extracted."}
            action={<Button variant="primary" size="sm" onClick={onResearch}>Start research</Button>}
          />
        </div>
      ) : (
        GROUPS.map((g) => {
          const rows = contacts.filter((c) => c.type === g.type);
          if (!rows.length) return null;
          return (
            <Panel key={g.type} title={`${g.label} (${rows.length})`} id={`grp-${g.type}`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-subtle/60">
                    <tr className="h-8 border-b border-border">
                      <th scope="col" className="w-10 pl-4"><span className="sr-only">Select</span></th>
                      <th scope="col" className="px-3 t-th">Name / title</th>
                      <th scope="col" className="px-3 t-th">Email</th>
                      <th scope="col" className="px-3 t-th">Phone</th>
                      <th scope="col" className="hidden px-3 t-th xl:table-cell">Location</th>
                      <th scope="col" className="px-3 t-th">Source & verification</th>
                      <th scope="col" className="hidden px-3 t-th lg:table-cell">Last checked</th>
                      <th scope="col" className="pr-3"><span className="sr-only">Source link</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <Row
                        key={c.id}
                        c={c}
                        selected={sel.has(c.id)}
                        onSelect={(v) =>
                          setSel((s) => {
                            const n = new Set(s);
                            if (v) n.add(c.id);
                            else n.delete(c.id);
                            return n;
                          })
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          );
        })
      )}
      {exporting && <ExportDialog open onClose={() => setExporting(false)} scope={{ kind: "selected", businessIds: [id] }} scopeLabel={b.name} />}
    </div>
  );
}

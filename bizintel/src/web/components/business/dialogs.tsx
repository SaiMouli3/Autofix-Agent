import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { DEPTH_INFO } from "@shared/domain";
import type { ExportFormat, ExportInclude, ExportScope, QualificationStatus, ResearchDepth } from "@/lib/types";
import { api, errorMessage } from "@/lib/api";
import { keys, useAddToList, useCreateExport, useCreateList, useInvalidate, useLists, useMeta, useQueueResearch } from "@/lib/queries";
import { plural } from "@/lib/format";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Checkbox, Field, Input, Select, Textarea } from "../ui/Field";
import { Segmented } from "../ui/Tabs";
import { InlineAlert } from "../ui/States";
import { useToast } from "../ui/Toast";
import { QUALIFICATION_OPTIONS } from "./badges";

export function AddToListDialog({ open, onClose, businessIds, onDone }: { open: boolean; onClose: () => void; businessIds: string[]; onDone?: () => void }) {
  const { data: lists } = useLists();
  const [listId, setListId] = useState("");
  const [newName, setNewName] = useState("");
  const add = useAddToList();
  const create = useCreateList();
  const toast = useToast();
  const mode = listId === "__new" || !lists?.length ? "new" : "existing";

  const submit = async () => {
    try {
      const id = mode === "new" ? (await create.mutateAsync({ name: newName.trim() })).id : listId;
      const r = await add.mutateAsync({ listId: id, businessIds });
      toast.success(`Added ${plural(r.added, "business", "businesses")} to the list`, r.alreadyPresent ? `${plural(r.alreadyPresent, "was", "were")} already on it.` : undefined);
      onDone?.();
      onClose();
    } catch (e) {
      toast.error("Couldn’t add to list", errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Save to list"
      description={`${plural(businessIds.length, "business", "businesses")} selected. Businesses already on the list are not duplicated.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={add.isPending || create.isPending} disabled={mode === "new" ? !newName.trim() : !listId}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {lists && lists.length > 0 && (
          <Field label="List" htmlFor="atl-list">
            <Select id="atl-list" value={listId} onChange={(e) => setListId(e.target.value)} data-autofocus>
              <option value="">Choose a list…</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.count})
                </option>
              ))}
              <option value="__new">+ New list…</option>
            </Select>
          </Field>
        )}
        {mode === "new" && (
          <Field label="New list name" htmlFor="atl-new">
            <Input id="atl-new" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} placeholder="e.g. Q3 priority accounts" />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

export function ResearchDialog({ open, onClose, businessIds, onDone }: { open: boolean; onClose: () => void; businessIds: string[]; onDone?: () => void }) {
  const [depth, setDepth] = useState<ResearchDepth>("standard");
  const q = useQueueResearch();
  const toast = useToast();
  const navigate = useNavigate();
  const many = businessIds.length > 10;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Research ${plural(businessIds.length, "business", "businesses")}`}
      description="Each business is researched as a separate background job."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={q.isPending}
            onClick={() =>
              q.mutate(
                { businessIds, depth },
                {
                  onSuccess: (r) => {
                    toast.success(`${plural(r.queued.length, "research job")} queued`, r.skipped ? `${r.skipped} already had research in progress.` : undefined, {
                      label: "View jobs",
                      onClick: () => navigate("/research"),
                    });
                    onDone?.();
                    onClose();
                  },
                  onError: (e) => toast.error("Couldn’t queue research", errorMessage(e)),
                },
              )
            }
          >
            Start research
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Segmented
          label="Research depth"
          value={depth}
          onChange={setDepth}
          options={(["fast", "standard", "deep"] as ResearchDepth[]).map((d) => ({ value: d, label: DEPTH_INFO[d].label }))}
        />
        <p className="text-sm text-fg-2">{DEPTH_INFO[depth].summary}</p>
        <p className="t-meta">{DEPTH_INFO[depth].tradeoff}</p>
        {many && depth !== "fast" && (
          <InlineAlert tone="warning" title="This is a large batch">
            Researching {businessIds.length} companies uses web-search and model calls for each one. Consider researching a short-list first.
          </InlineAlert>
        )}
      </div>
    </Dialog>
  );
}

export function TagDialog({ open, onClose, businessIds, onDone }: { open: boolean; onClose: () => void; businessIds: string[]; onDone?: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const inv = useInvalidate();
  const toast = useToast();
  const tags = text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add tags"
      description={`Applies to ${plural(businessIds.length, "business", "businesses")}.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!tags.length}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post("/businesses/bulk/tags", { businessIds, add: tags });
                await inv(["businesses"], ["business"]);
                toast.success("Tags added");
                onDone?.();
                onClose();
              } catch (e) {
                toast.error("Couldn’t add tags", errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Add tags
          </Button>
        </>
      }
    >
      <Field label="Tags" htmlFor="tags-input" hint="Separate multiple tags with commas.">
        <Input id="tags-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. follow-up, conference" data-autofocus />
      </Field>
    </Dialog>
  );
}

export function QualificationDialog({ open, onClose, businessIds, onDone }: { open: boolean; onClose: () => void; businessIds: string[]; onDone?: () => void }) {
  const [status, setStatus] = useState<QualificationStatus>("qualified");
  const [busy, setBusy] = useState(false);
  const inv = useInvalidate();
  const toast = useToast();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Update qualification status"
      description={`Manually sets the status for ${plural(businessIds.length, "business", "businesses")}. Manual statuses are kept when scores are recalculated, and each change is recorded in the activity log.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post("/businesses/bulk/qualification", { businessIds, status });
                await inv(["businesses"], ["business"], keys.opportunities, keys.overview);
                toast.success("Qualification status updated");
                onDone?.();
                onClose();
              } catch (e) {
                toast.error("Couldn’t update status", errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Update
          </Button>
        </>
      }
    >
      <Field label="Status" htmlFor="qual-select">
        <Select id="qual-select" value={status} onChange={(e) => setStatus(e.target.value as QualificationStatus)}>
          {QUALIFICATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
    </Dialog>
  );
}

const INCLUDES: { key: ExportInclude; label: string }[] = [
  { key: "overview", label: "Company overview (executive summary)" },
  { key: "contacts", label: "All public contacts" },
  { key: "website_research", label: "Website research (pages retrieved)" },
  { key: "sources", label: "Source URLs" },
  { key: "scores", label: "Qualification score breakdown" },
  { key: "opportunities", label: "Opportunity analysis" },
  { key: "outreach", label: "Latest outreach draft" },
];

export const SCOPE_LABELS: Record<ExportScope["kind"], string> = {
  all: "All businesses",
  search: "Current search results",
  selected: "Selected businesses",
  list: "Saved list",
  qualified: "Qualified leads",
  with_email: "Businesses with public email addresses",
  with_phone: "Businesses with public phone numbers",
  researched: "Researched companies",
};

const DEFAULT_COLUMNS = ["name", "industry", "address", "city", "region", "country", "website", "phone", "email", "research_status", "score"];

export function ExportDialog({ open, onClose, scope, scopeLabel, onDone }: { open: boolean; onClose: () => void; scope: ExportScope; scopeLabel?: string; onDone?: () => void }) {
  const { data: meta } = useMeta();
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<string[]>(DEFAULT_COLUMNS);
  const [include, setInclude] = useState<ExportInclude[]>(["contacts"]);
  const create = useCreateExport();
  const toast = useToast();
  const navigate = useNavigate();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Export businesses"
      description={`Scope: ${scopeLabel ?? SCOPE_LABELS[scope.kind]}${scope.kind === "selected" ? ` (${scope.businessIds.length})` : ""}. Large exports run in the background.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!columns.length}
            onClick={() =>
              create.mutate(
                { name: name || undefined, format, scope, columns, include },
                {
                  onSuccess: () => {
                    toast.info("Export started", "It will appear in the Export Center when ready.", { label: "Open Export Center", onClick: () => navigate("/exports") });
                    onDone?.();
                    onClose();
                  },
                  onError: (e) => toast.error("Couldn’t start the export", errorMessage(e)),
                },
              )
            }
          >
            Create export
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field label="Export name" optional htmlFor="exp-name">
            <Input id="exp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Defaults to the date and time" />
          </Field>
          <Field label="Format">
            <Segmented
              label="Format"
              value={format}
              onChange={setFormat}
              options={[
                { value: "xlsx", label: "Excel (.xlsx)" },
                { value: "csv", label: "CSV" },
              ]}
            />
          </Field>
        </div>
        <fieldset>
          <div className="mb-2 flex items-center justify-between">
            <legend className="t-label">Columns</legend>
            <div className="flex gap-3 text-xs">
              <button type="button" className="link" onClick={() => setColumns(meta?.exportColumns.map((c) => c.key) ?? [])}>
                Select all
              </button>
              <button type="button" className="link" onClick={() => setColumns(DEFAULT_COLUMNS)}>
                Reset
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            {meta?.exportColumns.map((c) => (
              <Checkbox key={c.key} label={c.label} checked={columns.includes(c.key)} onChange={(e) => setColumns(e.target.checked ? [...columns, c.key] : columns.filter((x) => x !== c.key))} />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="t-label mb-2">Include research data</legend>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {INCLUDES.map((i) => (
              <Checkbox key={i.key} label={i.label} checked={include.includes(i.key)} onChange={(e) => setInclude(e.target.checked ? [...include, i.key] : include.filter((x) => x !== i.key))} />
            ))}
          </div>
          {format === "xlsx" && include.includes("contacts") && <p className="t-meta mt-2">Contacts are written to a separate “Contacts” sheet.</p>}
        </fieldset>
      </div>
    </Dialog>
  );
}

export function NewListDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useCreateList();
  const toast = useToast();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New list"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!name.trim()}
            onClick={() =>
              create.mutate(
                { name: name.trim(), description: description.trim() || null },
                {
                  onSuccess: (l) => {
                    toast.success("List created");
                    setName("");
                    setDescription("");
                    onCreated?.(l.id);
                    onClose();
                  },
                  onError: (e) => toast.error("Couldn’t create list", errorMessage(e)),
                },
              )
            }
          >
            Create list
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="nl-name">
          <Input id="nl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} data-autofocus />
        </Field>
        <Field label="Description" optional htmlFor="nl-desc">
          <Textarea id="nl-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>
      </div>
    </Dialog>
  );
}

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ListChecks, ListMinus, Pencil, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { keys, useConfig, useInvalidate, useList } from "@/lib/queries";
import { relativeTime } from "@/lib/format";
import { useCrumbs } from "@/components/layout/crumbs";
import { PageBody, PageHeader } from "@/components/ui/Page";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { BlockSkeleton, EmptyState, ErrorState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { BusinessTable } from "@/components/business/BusinessTable";

export default function ListDetail() {
  const { id = "" } = useParams();
  const { data: cfg } = useConfig();
  const { data: list, isLoading, isError, error, refetch } = useList(id);
  useCrumbs([{ label: "Saved Lists", to: "/lists" }, { label: list?.name ?? "List" }], cfg?.branding.productName);
  const inv = useInvalidate();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  if (isLoading) return <PageBody wide><BlockSkeleton lines={6} /></PageBody>;
  if (isError || !list) return <PageBody><ErrorState error={error} onRetry={() => refetch()} /></PageBody>;

  const removeMembers = async (ids: string[], clear: () => void) => {
    try {
      const r = await api.post<{ removed: number }>(`/lists/${id}/members/remove`, { businessIds: ids });
      await inv(keys.lists, ["businesses"]);
      toast.success(`Removed ${r.removed} from the list`);
      clear();
    } catch (e) {
      toast.error("Couldn’t remove", errorMessage(e));
    }
  };

  return (
    <PageBody wide>
      <PageHeader
        title={list.name}
        subtitle={list.description ?? undefined}
        meta={<span className="tnum">{list.count.toLocaleString()} businesses · updated {relativeTime(list.updatedAt)}</span>}
        actions={
          <>
            <Button size="sm" icon={<Pencil size={14} />} onClick={() => (setName(list.name), setDescription(list.description ?? ""), setEditing(true))}>Rename</Button>
            <Button size="sm" icon={<Trash2 size={14} />} onClick={() => setDeleting(true)}>Delete list</Button>
          </>
        }
      />
      <BusinessTable
        fixed={{ listId: id }}
        exportScope={{ kind: "list", listId: id }}
        exportScopeLabel={`List “${list.name}”`}
        bulkExtra={(ids, clear) => (
          <Button size="sm" icon={<ListMinus size={14} />} onClick={() => removeMembers(ids, clear)}>
            Remove from list
          </Button>
        )}
        rowMenuExtra={(b) => [{ label: "Remove from this list", onSelect: () => removeMembers([b.id], () => {}) }]}
        emptyState={<EmptyState icon={<ListChecks size={18} />} title="This list is empty" description="Select businesses in any table and choose “Save to list”." action={<ButtonLink to="/businesses" size="sm" variant="primary">Browse businesses</ButtonLink>} />}
      />
      <Dialog
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit list"
        footer={
          <>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!name.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.patch(`/lists/${id}`, { name: name.trim(), description: description.trim() || null });
                  await inv(keys.lists);
                  toast.success("List updated");
                  setEditing(false);
                } catch (e) {
                  toast.error("Couldn’t update list", errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" htmlFor="el-name"><Input id="el-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
          <Field label="Description" optional htmlFor="el-desc"><Textarea id="el-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        tone="danger"
        loading={busy}
        title={`Delete “${list.name}”?`}
        description="The list is removed. The businesses themselves and their research are kept."
        confirmLabel="Delete list"
        onConfirm={async () => {
          setBusy(true);
          try {
            await api.del(`/lists/${id}`);
            await inv(keys.lists, keys.overview);
            toast.success("List deleted");
            navigate("/lists");
          } catch (e) {
            toast.error("Couldn’t delete list", errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </PageBody>
  );
}

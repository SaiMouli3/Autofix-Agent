import { useState } from "react";
import { Activity as ActivityIcon, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useActivity, useInvalidate, useNotes } from "@/lib/queries";
import { dateTime, relativeTime } from "@/lib/format";
import { Panel } from "../ui/Page";
import { Button, IconButton } from "../ui/Button";
import { Textarea } from "../ui/Field";
import { BlockSkeleton, EmptyState } from "../ui/States";
import { useToast } from "../ui/Toast";
import type { TabProps } from "@/pages/Company";

export function NotesPanel({ id }: { id: string }) {
  const { data: notes, isLoading } = useNotes(id);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const inv = useInvalidate();
  const toast = useToast();
  const add = async () => {
    setBusy(true);
    try {
      await api.post(`/businesses/${id}/notes`, { body });
      setBody("");
      await inv(["business", id]);
    } catch (e) {
      toast.error("Couldn’t save the note", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Internal notes" id={`notes-${id}`} description="Visible to everyone in this workspace.">
      <div className="space-y-3 p-4">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note…" aria-label="New note" maxLength={5000} className="min-h-[72px]" />
        <div className="flex justify-end">
          <Button size="sm" variant="primary" disabled={!body.trim()} loading={busy} onClick={add}>
            Add note
          </Button>
        </div>
        {isLoading ? (
          <BlockSkeleton lines={2} />
        ) : (
          notes &&
          notes.length > 0 && (
            <ul className="divide-y divide-border border-t border-border">
              {notes.map((n) => (
                <li key={n.id} className="group flex gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                    <p className="t-meta mt-0.5" title={dateTime(n.createdAt)}>{relativeTime(n.createdAt)}</p>
                  </div>
                  <IconButton
                    label="Delete note"
                    size="sm"
                    onClick={async () => {
                      try {
                        await api.del(`/notes/${n.id}`);
                        await inv(["business", id]);
                      } catch (e) {
                        toast.error("Couldn’t delete the note", errorMessage(e));
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </Panel>
  );
}

export function ActivityTab({ id }: TabProps) {
  const { data, isLoading } = useActivity(id);
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel title="Activity" id="activity" description="Research runs, qualification changes, list changes and notes for this company.">
        {isLoading ? (
          <BlockSkeleton lines={5} />
        ) : !data?.length ? (
          <EmptyState compact icon={<ActivityIcon size={18} />} title="No activity yet" />
        ) : (
          <ol className="relative px-4 py-3">
            {data.map((a) => (
              <li key={a.id} className="relative flex gap-3 pb-4 pl-4 before:absolute before:left-[3px] before:top-2 before:h-full before:w-px before:bg-border last:before:hidden">
                <span className="absolute left-0 top-[7px] h-[7px] w-[7px] rounded-full border border-border-strong bg-surface" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{a.message}</p>
                  <p className="t-meta" title={dateTime(a.createdAt)}>{dateTime(a.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <NotesPanel id={id} />
    </div>
  );
}

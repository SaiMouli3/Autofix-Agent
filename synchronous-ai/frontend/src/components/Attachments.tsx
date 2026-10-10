import { FileText, Image as ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { bytes } from "../lib/format";

export const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.xlsx,.csv,.txt,.md,.markdown,.json,.html,.htm,.yaml,.yml,.log,.xml";
const MAX_FILES = 10;

type Item = { key: string; file: File; status: "uploading" | "ready" | "error"; error?: string; att?: any; preview?: string };

/** Uploads files as soon as they are attached; the task is submitted with the resulting ids. */
export function useAttachments() {
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => () => itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []);

  const add = useCallback((files: FileList | File[]) => {
    const room = MAX_FILES - itemsRef.current.length;
    const list = Array.from(files).slice(0, Math.max(room, 0));
    for (const file of list) {
      const key = crypto.randomUUID();
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setItems((prev) => [...prev, { key, file, status: "uploading", preview }]);
      const form = new FormData();
      form.append("file", file, file.name || (file.type.startsWith("image/") ? `pasted-image.${file.type.split("/")[1] || "png"}` : "file"));
      api.upload("/api/attachments", form)
        .then((att) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, status: "ready", att } : i))))
        .catch((e: any) => setItems((prev) => prev.map((i) => (i.key === key ? { ...i, status: "error", error: e.message } : i))));
    }
    return list.length;
  }, []);

  const remove = useCallback((key: string) => {
    const it = itemsRef.current.find((i) => i.key === key);
    if (it?.att) api.del(`/api/attachments/${it.att.id}`).catch(() => undefined);
    if (it?.preview) URL.revokeObjectURL(it.preview);
    setItems((prev) => prev.filter((i) => i.key !== key));
  }, []);

  const clear = useCallback(() => {
    itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
    setItems([]);
  }, []);

  return {
    items, add, remove, clear,
    ids: items.filter((i) => i.status === "ready").map((i) => i.att.id as string),
    uploading: items.some((i) => i.status === "uploading"),
    hasErrors: items.some((i) => i.status === "error"),
    full: items.length >= MAX_FILES,
  };
}

export function AttachButton({ onFiles, disabled }: { onFiles: (f: FileList) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ""; }} />
      <button type="button" className="btn ghost icon sm" disabled={disabled} onClick={() => ref.current?.click()}
        aria-label="Attach files" data-tip="Attach documents or images"><Paperclip /></button>
    </>
  );
}

export function PendingAttachments({ items, onRemove }: { items: Item[]; onRemove: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="att-list" aria-label="Attachments">
      {items.map((i) => (
        <li key={i.key} className={`att-chip ${i.status}`} title={i.error ?? i.file.name}>
          {i.preview ? <img src={i.preview} alt="" className="att-thumb" /> : <span className="att-icon"><FileText size={16} /></span>}
          <span className="att-meta">
            <span className="ellipsis">{i.file.name || "pasted image"}</span>
            <span className="tiny muted">{i.status === "uploading" ? <><Loader2 size={11} className="spin" /> Uploading…</> : i.status === "error" ? <span style={{ color: "var(--danger)" }}>{i.error}</span> : bytes(i.file.size)}</span>
          </span>
          <button type="button" className="btn ghost icon xs" onClick={() => onRemove(i.key)} aria-label={`Remove ${i.file.name}`}><X size={14} /></button>
        </li>
      ))}
    </ul>
  );
}

/** Attachments of a submitted task, in the thread. Images open full size; documents download. */
export function AttachmentList({ items }: { items: any[] }) {
  if (!items?.length) return null;
  return (
    <ul className="att-list" aria-label="Attached files">
      {items.map((a) => a.kind === "image" ? (
        <li key={a.id}>
          <a className="att-image" href={`/api/attachments/${a.id}?inline=true`} target="_blank" rel="noreferrer noopener" title={a.filename}>
            <img src={`/api/attachments/${a.id}?inline=true`} alt={a.filename} loading="lazy" />
          </a>
        </li>
      ) : (
        <li key={a.id}>
          <a className="att-chip ready" href={`/api/attachments/${a.id}`} title={`Download ${a.filename}`}>
            <span className="att-icon">{a.mime?.startsWith("image/") ? <ImageIcon size={16} /> : <FileText size={16} />}</span>
            <span className="att-meta"><span className="ellipsis">{a.filename}</span><span className="tiny muted">{bytes(a.size)}</span></span>
          </a>
        </li>
      ))}
    </ul>
  );
}

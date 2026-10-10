import { useQuery } from "@tanstack/react-query";
import { Download, File, FileCode, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { bytes } from "../lib/format";
import { Empty, ErrorState, SkeletonRows, Tag } from "./ui";

const CODE = /\.(py|ts|tsx|js|json|ya?ml|sh|sql|toml|html|css)$/i;

/** Workspace file browser. Paths are always relative to the session workspace; the server
 *  rejects traversal and serves downloads as sandboxed attachments. */
export function FilesBrowser({ sessionId, highlight, initial }: { sessionId: string; highlight?: string[]; initial?: string | null }) {
  const files = useQuery({ queryKey: ["files", sessionId], queryFn: ({ signal }) => api.get(`/api/sessions/${sessionId}/files`, signal), refetchInterval: 15000 });
  const list: any[] = files.data?.files ?? [];
  const [sel, setSel] = useState<string>(initial ?? "");
  useEffect(() => {
    if (!sel && list.length) setSel(highlight?.find((h) => list.some((f) => f.path === h)) ?? list[0].path);
  }, [list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const content = useQuery({
    queryKey: ["file", sessionId, sel],
    queryFn: ({ signal }) => api.get(`/api/sessions/${sessionId}/file?path=${encodeURIComponent(sel)}`, signal),
    enabled: !!sel,
    retry: false,
  });
  if (files.isLoading) return <SkeletonRows rows={4} />;
  if (files.error) return <div className="panel-body"><ErrorState error={files.error} onRetry={() => files.refetch()} what="workspace files" /></div>;
  if (!list.length) return <Empty icon={File} title="No files in this workspace">Files the agent creates appear here.</Empty>;
  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(200px, 280px) minmax(0, 1fr)", gap: 0 }}>
      <div role="listbox" aria-label="Files" style={{ borderRight: "1px solid var(--border)", maxHeight: 560, overflow: "auto", padding: 6 }}>
        {list.map((f) => {
          const Icon = CODE.test(f.path) ? FileCode : FileText;
          return (
            <button key={f.path} role="option" aria-selected={sel === f.path} className="file-link" onClick={() => setSel(f.path)}
              style={{ width: "100%", border: 0, background: sel === f.path ? "var(--surface-2)" : "none", cursor: "pointer", textAlign: "left" }}>
              <Icon aria-hidden /><span className="grow ellipsis mono">{f.path}</span>
              {highlight?.includes(f.path) && <Tag tone="accent">this task</Tag>}
              <span className="tiny muted">{bytes(f.size)}</span>
            </button>
          );
        })}
      </div>
      <div style={{ padding: 14, minWidth: 0 }}>
        {sel && (
          <div className="row between" style={{ marginBottom: 8 }}>
            <b className="mono ellipsis">{sel}</b>
            <a className="btn xs" href={`/api/sessions/${sessionId}/file?path=${encodeURIComponent(sel)}&download=true`}><Download /> Download</a>
          </div>
        )}
        {content.isLoading && <SkeletonRows rows={6} />}
        {content.error && <ErrorState error={content.error} what="this file" />}
        {content.data && typeof content.data === "object" && "content" in content.data
          ? <pre className="code" style={{ maxHeight: 520 }}>{content.data.content}</pre>
          : content.data ? <p className="muted small">Preview isn't available for this file type or size. Use Download.</p> : null}
      </div>
    </div>
  );
}

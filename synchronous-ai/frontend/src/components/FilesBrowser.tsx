import { useQuery } from "@tanstack/react-query";
import { Download, File, FileCode, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { bytes } from "../lib/format";
import { Empty, ErrorBox, Loading } from "./ui";

const CODE = /\.(py|ts|tsx|js|json|ya?ml|sh|sql|toml|html|css)$/i;

export function FilesBrowser({ sessionId, highlight }: { sessionId: string; highlight?: string[] }) {
  const files = useQuery({ queryKey: ["files", sessionId], queryFn: () => api.get(`/api/sessions/${sessionId}/files`), refetchInterval: 10000 });
  const [sel, setSel] = useState<string>("");
  const list: any[] = files.data?.files ?? [];
  useEffect(() => {
    if (!sel && list.length) setSel(highlight?.find((h) => list.some((f) => f.path === h)) ?? list[0].path);
  }, [list.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const content = useQuery({
    queryKey: ["file", sessionId, sel],
    queryFn: () => api.get(`/api/sessions/${sessionId}/file?path=${encodeURIComponent(sel)}`),
    enabled: !!sel,
    retry: false,
  });
  if (files.isLoading) return <Loading />;
  if (files.error) return <ErrorBox error={files.error} />;
  if (!list.length) return <Empty icon={File} title="No files yet">Files the agent creates in its workspace will appear here.</Empty>;
  return (
    <div className="grid" style={{ gridTemplateColumns: "300px minmax(0,1fr)", gap: 0 }}>
      <div style={{ borderRight: "1px solid var(--border)", maxHeight: 560, overflow: "auto" }}>
        {list.map((f) => {
          const Icon = CODE.test(f.path) ? FileCode : FileText;
          return (
            <div key={f.path} className={`file-row ${sel === f.path ? "on" : ""}`} onClick={() => setSel(f.path)} role="button" tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setSel(f.path)}>
              <Icon /><span className="grow ellipsis small">{f.path}</span>
              {highlight?.includes(f.path) && <span className="badge accent">new</span>}
              <span className="faint tiny">{bytes(f.size)}</span>
            </div>
          );
        })}
      </div>
      <div style={{ padding: 14, minWidth: 0 }}>
        {sel && (
          <div className="row between mb8">
            <b className="small mono ellipsis">{sel}</b>
            <a className="btn xs" href={`/api/sessions/${sessionId}/file?path=${encodeURIComponent(sel)}&download=true`}><Download /> Download</a>
          </div>
        )}
        {content.isLoading && <Loading />}
        {content.error && <ErrorBox error={content.error} />}
        {content.data && typeof content.data === "object" && "content" in content.data ? (
          <pre className="block" style={{ maxHeight: 520 }}>{content.data.content}</pre>
        ) : content.data ? (
          <div className="faint small">Binary or large file — use Download.</div>
        ) : null}
      </div>
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FilePlus2, Library, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Shell } from "../components/Shell";
import { Alert, Dialog, Empty, ErrorState, InlineError, Menu, Pager, SearchField, SkeletonRows, Status, Tag, useConfirm, useToast } from "../components/ui";
import { api, qs } from "../lib/api";
import { bytes, dateTime, fullDateTime } from "../lib/format";
import { useDebounced } from "../lib/prefs";
import { useSession } from "../lib/session";

const ACCEPT = ".txt,.md,.markdown,.csv,.json,.html,.htm,.pdf,.docx,.yaml,.yml,.log";
const DOC_STATUS: Record<string, string> = { pending: "pending_doc", processing: "processing", indexed: "indexed", failed: "failed" };
const PAGE = 25;

export default function Knowledge() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const source = sp.get("source") ?? "";
  const status = sp.get("status") ?? "";
  const page = Number(sp.get("page") ?? 1);
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const [modal, setModal] = useState<"" | "source" | "text" | "search">("");
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Record<string, string>) => { const n = new URLSearchParams(sp); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); if (!("page" in patch)) n.delete("page"); setSp(n, { replace: true }); };
  const sources = useQuery({ queryKey: ["knowledge-sources"], queryFn: ({ signal }) => api.get("/api/knowledge/sources", signal), refetchInterval: 15000 });
  const params = { q: dq, status, source_id: source, page, page_size: PAGE };
  const docs = useQuery({
    queryKey: ["documents", params], queryFn: ({ signal }) => api.get(`/api/knowledge/documents${qs(params)}`, signal), placeholderData: (p) => p,
    refetchInterval: (qq) => ((qq.state.data as any)?.items?.some((d: any) => ["pending", "processing"].includes(d.status)) ? 2000 : 15000),
  });
  const current = (sources.data ?? []).find((s: any) => s.id === source);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["documents"] }); qc.invalidateQueries({ queryKey: ["knowledge-sources"] }); };
  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const results = [];
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f);
        try { await api.upload(`/api/knowledge/sources/${source}/documents`, fd); results.push({ ok: true, name: f.name }); }
        catch (e: any) { results.push({ ok: false, name: f.name, error: e.message }); }
      }
      return results;
    },
    onSuccess: (r) => {
      refresh();
      const failed = r.filter((x) => !x.ok);
      toast(failed.length ? "error" : "ok", failed.length ? `${failed.length} file(s) rejected: ${failed.map((x) => `${x.name} (${x.error})`).join("; ")}` : `${r.length} file(s) uploaded. Indexing has started.`);
    },
  });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/api/knowledge/documents/${id}`), onSuccess: () => { refresh(); toast("ok", "Document, passages and embeddings deleted"); }, onError: (e: any) => toast("error", e.message) });
  const reindex = useMutation({ mutationFn: (id: string) => api.post(`/api/knowledge/documents/${id}/reindex`), onSuccess: () => { refresh(); toast("ok", "Re-indexing started"); }, onError: (e: any) => toast("error", e.message) });
  const delSource = useMutation({ mutationFn: () => api.del(`/api/knowledge/sources/${source}`), onSuccess: () => { set({ source: "" }); refresh(); toast("ok", "Collection deleted"); }, onError: (e: any) => toast("error", e.message) });
  const items: any[] = docs.data?.items ?? [];

  return (
    <Shell crumbs={[{ label: "Knowledge" }]}>
      <div className="page-head">
        <div><h1>Company knowledge</h1><p>Documents are extracted, split into passages and indexed. Agents search only the collections assigned to them and cite what they use.</p></div>
        <div className="row">
          <button className="btn" onClick={() => setModal("search")} disabled={!sources.data?.length}><Search /> Test retrieval</button>
          {can("knowledge:write") && <button className="btn" onClick={() => setModal("source")}><Plus /> New collection</button>}
          {can("knowledge:write") && (
            <>
              <input ref={fileRef} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { if (e.target.files?.length) upload.mutate(e.target.files); e.target.value = ""; }} />
              <Menu label="Add documents" trigger={(p) => <button {...p} className="btn primary" disabled={!sources.data?.length}><Upload /> Add documents</button>} items={
                current
                  ? [{ label: `Upload files to ${current.name}`, icon: Upload, onSelect: () => fileRef.current?.click() }, { label: `Write a text document in ${current.name}`, icon: FilePlus2, onSelect: () => setModal("text") }]
                  : [{ label: "Select a collection first", disabled: true }, ...(sources.data ?? []).map((s: any) => ({ label: s.name, onSelect: () => set({ source: s.id }) }))]
              } />
            </>
          )}
        </div>
      </div>
      {upload.isPending && <div style={{ marginBottom: 12 }}><Alert kind="info">Uploading… indexing starts as soon as each file arrives.</Alert></div>}
      <div className="filters" role="group" aria-label="Collection">
        <button className="chip-btn" aria-pressed={!source} onClick={() => set({ source: "" })}>All collections</button>
        {(sources.data ?? []).map((s: any) => (
          <button key={s.id} className="chip-btn" aria-pressed={source === s.id} onClick={() => set({ source: s.id })}>{s.name} <span className="c">{s.document_count}</span></button>
        ))}
      </div>
      {current && (
        <div className="alert neutral" style={{ marginBottom: 12 }}>
          <Library size={16} />
          <div className="grow small"><b>{current.name}</b> · {current.category}{current.department ? ` · ${current.department}` : ""} · {current.chunk_count} indexed passages · used by {current.agents.map((a: any) => a.name).join(", ") || "no agents"}
            {current.description && <div className="muted">{current.description}</div>}</div>
          {can("knowledge:write") && <button className="btn xs danger" onClick={async () => {
            if (await confirm({ title: `Delete collection “${current.name}”?`, body: `All ${current.document_count} documents, their passages and embeddings are deleted. Agents using it lose access. This cannot be undone.`, confirmLabel: "Delete collection", danger: true, requireText: current.name })) delSource.mutate();
          }}><Trash2 /> Delete</button>}
        </div>
      )}
      <div className="filters">
        <SearchField value={q} onChange={(v) => { setQ(v); set({ page: "" }); }} placeholder="Search document names" label="Search documents" />
        <select value={status} onChange={(e) => set({ status: e.target.value })} aria-label="Ingestion status">
          <option value="">Any status</option><option value="pending">Uploaded</option><option value="processing">Processing</option><option value="indexed">Indexed</option><option value="failed">Failed</option>
        </select>
      </div>
      <div className="panel">
        {(docs.isLoading || sources.isLoading) && <SkeletonRows rows={6} />}
        {docs.isError && <div className="panel-body"><ErrorState error={docs.error} onRetry={() => docs.refetch()} what="documents" /></div>}
        {sources.data?.length === 0 && (
          <Empty icon={Library} title="Create your first collection" action={can("knowledge:write") ? <button className="btn primary" onClick={() => setModal("source")}><Plus /> New collection</button> : undefined}>
            Group documents into collections such as “HR policies” or “Product manuals”, then assign collections to agents.
          </Empty>
        )}
        {sources.data && sources.data.length > 0 && docs.data && items.length === 0 && (
          <Empty icon={FilePlus2} title={q || status ? "No documents match" : "No documents yet"}>
            Supported: PDF (text-based), Word (.docx), Markdown, text, HTML, CSV, JSON, YAML. Scanned PDFs need OCR before upload.
          </Empty>
        )}
        {items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Document</th><th scope="col">Status</th><th scope="col" className="hide-sm">Type</th><th scope="col" className="right hide-sm">Size</th><th scope="col" className="hide-sm">Collection</th><th scope="col" className="hide-sm">Owner</th><th scope="col">Uploaded</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id}>
                    <td className="title-cell">
                      <span className="strong ellipsis" style={{ display: "block" }}>{d.filename}</span>
                      {d.status === "failed" ? <span className="tiny" style={{ color: "var(--danger)" }}>{d.error}</span>
                        : d.status === "indexed" ? <span className="tiny muted">{d.chunk_count} passages · {d.embedded ? "semantic + keyword" : "keyword"} search</span> : null}
                    </td>
                    <td><Status status={DOC_STATUS[d.status] ?? d.status} /></td>
                    <td className="hide-sm"><Tag mono>{d.type}</Tag></td>
                    <td className="right num hide-sm">{bytes(d.size)}</td>
                    <td className="hide-sm">{d.source_name}</td>
                    <td className="hide-sm muted">{d.uploaded_by_name ?? "—"}</td>
                    <td className="muted nowrap" title={fullDateTime(d.created_at)}>{dateTime(d.created_at)}</td>
                    <td className="nowrap right">
                      <button className="btn ghost icon sm" disabled={d.status !== "indexed"} onClick={() => setPreview(d.id)} aria-label={`Preview ${d.filename}`} data-tip="Preview passages"><Eye /></button>
                      {can("knowledge:write") && <button className="btn ghost icon sm" onClick={() => reindex.mutate(d.id)} aria-label={`Re-index ${d.filename}`} data-tip="Re-index"><RefreshCw /></button>}
                      {can("knowledge:write") && <button className="btn ghost icon sm" aria-label={`Delete ${d.filename}`} data-tip="Delete" onClick={async () => {
                        if (await confirm({ title: `Delete ${d.filename}?`, body: "The file, its passages and embeddings are removed. Agents can no longer retrieve it.", confirmLabel: "Delete document", danger: true })) del.mutate(d.id);
                      }}><Trash2 /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {docs.data && docs.data.total > PAGE && <Pager page={page} pageSize={PAGE} total={docs.data.total} onPage={(p) => set({ page: String(p) })} />}
      </div>
      {modal === "source" && <NewSource onClose={() => setModal("")} onCreated={(id) => { setModal(""); set({ source: id }); }} />}
      {modal === "text" && current && <TextDoc source={current} onClose={() => setModal("")} onDone={() => { setModal(""); refresh(); }} />}
      {modal === "search" && <RetrievalTest sources={sources.data ?? []} initial={source} onClose={() => setModal("")} />}
      {preview && <Preview id={preview} onClose={() => setPreview(null)} />}
    </Shell>
  );
}

function Preview({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["doc-preview", id], queryFn: ({ signal }) => api.get(`/api/knowledge/documents/${id}/preview`, signal) });
  return (
    <Dialog size="wide" title={q.data?.document.filename ?? "Preview"} description="The extracted passages exactly as agents retrieve them." onClose={onClose}>
      {q.isLoading && <SkeletonRows rows={5} />}
      <ErrorState error={q.error} what="the preview" />
      {q.data && (
        <div className="stack">
          {q.data.passages.map((p: any) => (
            <div key={p.ordinal}><div className="tiny muted mono">passage #{p.ordinal}</div><div className="prose small" style={{ background: "var(--surface-2)", padding: 10, borderRadius: 6 }}>{p.text}</div></div>
          ))}
          {q.data.truncated && <p className="tiny muted">Showing the first {q.data.passages.length} of {q.data.document.chunk_count} passages.</p>}
        </div>
      )}
    </Dialog>
  );
}

function RetrievalTest({ sources, initial, onClose }: { sources: any[]; initial: string; onClose: () => void }) {
  const [ids, setIds] = useState<string[]>(initial ? [initial] : sources.map((s) => s.id));
  const [query, setQuery] = useState("");
  const search = useMutation({ mutationFn: () => api.post("/api/knowledge/search", { query, source_ids: ids, top_k: 6 }) });
  return (
    <Dialog size="wide" title="Test retrieval" description="See which passages an agent with access to these collections would receive." onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (query.trim().length > 1 && ids.length) search.mutate(); }}>
        <div className="row wrap" style={{ gap: 6 }} role="group" aria-label="Collections">
          {sources.map((s) => <button type="button" key={s.id} className="chip-btn" aria-pressed={ids.includes(s.id)} onClick={() => setIds(ids.includes(s.id) ? ids.filter((x) => x !== s.id) : [...ids, s.id])}>{s.name}</button>)}
        </div>
        <div className="row"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask what an agent would search for" aria-label="Query" /><button className="btn dark" disabled={query.trim().length < 2 || !ids.length || search.isPending}>Search</button></div>
        <InlineError error={search.error} />
        {search.data && search.data.length === 0 && <Alert kind="neutral">No matching passages.</Alert>}
        {search.data?.map((h: any) => (
          <div key={h.chunk_id} className="panel" style={{ padding: 12 }}>
            <div className="row between small"><b>{h.source} / <span className="mono">{h.document}</span> #{h.ordinal}</b><span className="tiny muted num">score {h.score} · {h.retrieval}</span></div>
            <div className="prose small muted mt8">{h.text.slice(0, 900)}</div>
          </div>
        ))}
      </form>
    </Dialog>
  );
}

function NewSource({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", description: "", category: "Policies", department: "" });
  const m = useMutation({ mutationFn: () => api.post("/api/knowledge/sources", f), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["knowledge-sources"] }); onCreated(r.id); } });
  return (
    <Dialog title="New collection" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" disabled={f.name.trim().length < 2 || m.isPending} onClick={() => m.mutate()}>Create collection</button></>}>
      <div className="form-grid">
        <label className="field"><span className="req">Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Customer support SOPs" /></label>
        <label className="field">Category<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          {["Company profile", "Products & services", "Policies", "SOPs", "Technical documentation", "Business rules", "Documents"].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field">Department<input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></label>
        <label className="field full">Description<textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      </div>
      <InlineError error={m.error} />
    </Dialog>
  );
}

function TextDoc({ source, onClose, onDone }: { source: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: "", content: "" });
  const m = useMutation({ mutationFn: () => api.post(`/api/knowledge/sources/${source.id}/text`, f), onSuccess: onDone });
  return (
    <Dialog size="wide" title={`New text document in ${source.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn dark" disabled={!f.title || !f.content || m.isPending} onClick={() => m.mutate()}>Add and index</button></>}>
      <div className="stack">
        <label className="field"><span className="req">Title</span><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Company profile" /></label>
        <label className="field"><span className="req">Content</span><textarea rows={14} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} placeholder="Markdown supported" /></label>
        <InlineError error={m.error} />
      </div>
    </Dialog>
  );
}

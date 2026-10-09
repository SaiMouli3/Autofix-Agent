import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Library, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Shell } from "../components/Shell";
import { Empty, ErrorBox, Loading, Modal, Notice, StatusBadge, Tabs, useToast } from "../components/ui";
import { api } from "../lib/api";
import { bytes, timeAgo } from "../lib/format";
import { useSession } from "../lib/session";

export default function Knowledge() {
  const { can } = useSession();
  const sources = useQuery({ queryKey: ["knowledge-sources"], queryFn: () => api.get("/api/knowledge/sources"), refetchInterval: 8000 });
  const [sel, setSel] = useState("");
  const [modal, setModal] = useState(false);
  const list = sources.data ?? [];
  const current = list.find((s: any) => s.id === sel) ?? list[0];
  return (
    <Shell title="Company Knowledge">
      <div className="page-head">
        <div><h1>Company knowledge</h1><p>Upload policies, SOPs, manuals and documentation. Content is extracted, chunked and indexed for retrieval; agents only search sources assigned to them and must cite references.</p></div>
        {can("knowledge:write") && <button className="btn primary" onClick={() => setModal(true)}><Plus /> New source</button>}
      </div>
      <ErrorBox error={sources.error} />
      {sources.isLoading && <Loading />}
      {sources.data && list.length === 0 && <div className="card"><Empty icon={Library} title="No knowledge sources" action={can("knowledge:write") ? <button className="btn primary" onClick={() => setModal(true)}><Plus /> Create a source</button> : undefined}>Group documents into sources (e.g. “HR Policies”, “Product Manuals”) and assign them to agents.</Empty></div>}
      {list.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: "300px minmax(0,1fr)", alignItems: "start" }}>
          <div className="stack" style={{ gap: 8 }}>
            {list.map((s: any) => (
              <button key={s.id} className={`template ${current?.id === s.id ? "on" : ""}`} onClick={() => setSel(s.id)}>
                <Library size={18} />
                <span className="grow"><b className="small">{s.name}</b><div className="faint tiny">{s.category}{s.department ? ` · ${s.department}` : ""} · {s.document_count} docs · {s.agents.length} agents</div></span>
              </button>
            ))}
          </div>
          {current && <SourceDetail key={current.id} s={current} />}
        </div>
      )}
      {modal && <NewSource onClose={() => setModal(false)} onCreated={(id) => { setSel(id); setModal(false); }} />}
    </Shell>
  );
}

function SourceDetail({ s }: { s: any }) {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<"docs" | "search" | "jobs">("docs");
  const docs = useQuery({ queryKey: ["docs", s.id], queryFn: () => api.get(`/api/knowledge/sources/${s.id}/documents`), refetchInterval: (q) => ((q.state.data as any[])?.some((d) => ["pending", "processing"].includes(d.status)) ? 1500 : 10000) });
  const jobs = useQuery({ queryKey: ["ingest-jobs"], queryFn: () => api.get("/api/knowledge/jobs"), enabled: tab === "jobs", refetchInterval: 4000 });
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState({ title: "", content: "" });
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<any[] | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["docs", s.id] }); qc.invalidateQueries({ queryKey: ["knowledge-sources"] }); };
  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      for (const f of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", f);
        await api.upload(`/api/knowledge/sources/${s.id}/documents`, fd);
      }
    },
    onSuccess: () => { refresh(); toast("ok", "Uploaded — indexing in progress"); },
    onError: (e: any) => toast("error", e.message),
  });
  const addText = useMutation({ mutationFn: () => api.post(`/api/knowledge/sources/${s.id}/text`, text), onSuccess: () => { setText({ title: "", content: "" }); refresh(); toast("ok", "Added — indexing in progress"); }, onError: (e: any) => toast("error", e.message) });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/api/knowledge/documents/${id}`), onSuccess: () => { refresh(); toast("ok", "Document and its index deleted"); } });
  const reindex = useMutation({ mutationFn: (id: string) => api.post(`/api/knowledge/documents/${id}/reindex`), onSuccess: refresh });
  const delSource = useMutation({ mutationFn: () => api.del(`/api/knowledge/sources/${s.id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["knowledge-sources"] }); toast("ok", "Source deleted"); } });
  const search = useMutation({ mutationFn: () => api.post("/api/knowledge/search", { query, source_ids: [s.id], top_k: 6 }), onSuccess: setHits, onError: (e: any) => toast("error", e.message) });
  return (
    <div className="card">
      <div className="row between">
        <div><h2 style={{ margin: 0, fontSize: 18 }}>{s.name}</h2><div className="faint small">{s.description || "No description."} · used by {s.agents.map((a: any) => a.name).join(", ") || "no agents"}</div></div>
        {can("knowledge:write") && (
          <div className="row">
            <input ref={fileRef} type="file" multiple hidden accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.pdf,.docx,.yaml,.yml,.log" onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)} />
            <button className="btn primary sm" onClick={() => fileRef.current?.click()} disabled={upload.isPending}><Upload /> {upload.isPending ? "Uploading…" : "Upload files"}</button>
            <button className="btn ghost sm" onClick={() => confirm("Delete this source, its documents and index?") && delSource.mutate()}><Trash2 /></button>
          </div>
        )}
      </div>
      <div className="mt16"><Tabs value={tab} onChange={setTab} tabs={[{ key: "docs", label: "Documents", count: docs.data?.length }, { key: "search", label: "Retrieval preview" }, { key: "jobs", label: "Ingestion jobs" }]} /></div>
      {tab === "docs" && (
        <>
          {docs.data?.length === 0 && <Empty icon={FilePlus2} title="No documents">PDF, DOCX, Markdown, text, HTML, CSV, JSON and YAML are supported (scanned PDFs need OCR first).</Empty>}
          {(docs.data?.length ?? 0) > 0 && (
            <table className="table">
              <thead><tr><th>Document</th><th>Status</th><th>Passages</th><th>Index</th><th>Size</th><th>Added</th><th /></tr></thead>
              <tbody>
                {docs.data.map((d: any) => (
                  <tr key={d.id}>
                    <td><b className="small">{d.filename}</b>{d.error && <div className="error-text tiny">{d.error}</div>}</td>
                    <td><StatusBadge status={d.status} /></td>
                    <td>{d.chunk_count}</td>
                    <td className="small">{d.status === "indexed" ? (d.embedded ? "hybrid (semantic + lexical)" : "lexical") : "—"}</td>
                    <td className="small">{bytes(d.size)}</td>
                    <td className="faint small">{timeAgo(d.created_at)}</td>
                    <td className="nowrap">{can("knowledge:write") && <>
                      <button className="btn xs ghost" onClick={() => reindex.mutate(d.id)} title="Re-index"><RefreshCw /></button>
                      <button className="btn xs ghost" onClick={() => confirm(`Delete ${d.filename}?`) && del.mutate(d.id)} title="Delete"><Trash2 /></button></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {can("knowledge:write") && (
            <div className="card mt16" style={{ background: "var(--surface-0)" }}>
              <div className="card-title">Add text directly <span className="faint small">e.g. company profile, business rules</span></div>
              <div className="stack">
                <input placeholder="Title" value={text.title} onChange={(e) => setText({ ...text, title: e.target.value })} />
                <textarea rows={5} placeholder="Content (Markdown supported)" value={text.content} onChange={(e) => setText({ ...text, content: e.target.value })} />
                <div className="right"><button className="btn sm" disabled={!text.title || !text.content || addText.isPending} onClick={() => addText.mutate()}>Add to source</button></div>
              </div>
            </div>
          )}
        </>
      )}
      {tab === "search" && (
        <div className="stack">
          <div className="row">
            <input placeholder="Ask what an agent would search for…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && query.length > 1 && search.mutate()} />
            <button className="btn" disabled={query.length < 2} onClick={() => search.mutate()}><Search /> Search</button>
          </div>
          {hits && hits.length === 0 && <Notice>No matching passages.</Notice>}
          {hits?.map((h) => (
            <div key={h.chunk_id} className="card" style={{ background: "var(--surface-0)", padding: 12 }}>
              <div className="row between small"><b>{h.document} #chunk-{h.ordinal}</b><span className="faint">score {h.score} · {h.retrieval}</span></div>
              <div className="md small muted mt8">{h.text.slice(0, 900)}</div>
            </div>
          ))}
        </div>
      )}
      {tab === "jobs" && (
        <table className="table"><thead><tr><th>Document</th><th>Status</th><th>Detail</th><th>Finished</th></tr></thead>
          <tbody>{(jobs.data ?? []).map((j: any) => (
            <tr key={j.id}><td className="small">{j.filename}</td><td><StatusBadge status={j.status === "succeeded" ? "completed" : j.status === "running" ? "running" : j.status} label={j.status} /></td><td className="small faint">{j.detail}</td><td className="faint small">{timeAgo(j.finished_at)}</td></tr>
          ))}</tbody></table>
      )}
    </div>
  );
}

function NewSource({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", description: "", category: "Documents", department: "" });
  const m = useMutation({ mutationFn: () => api.post("/api/knowledge/sources", f), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["knowledge-sources"] }); onCreated(r.id); } });
  return (
    <Modal title="New knowledge source" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={f.name.length < 2} onClick={() => m.mutate()}>Create</button></>}>
      <div className="form-grid">
        <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Customer Support SOPs" /></label>
        <label className="field">Category<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          {["Company profile", "Products & services", "Policies", "SOPs", "Technical documentation", "Business rules", "Documents"].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="field">Department<input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></label>
        <label className="field full">Description<textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      </div>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Globe } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { Alert, ErrorState, InlineError, KV, SkeletonRows, Status, useConfirm, useToast } from "./ui";

/** Web search (Tavily) status for the organization. The key itself never reaches the browser. */
export function useWebSearch() {
  return useQuery({ queryKey: ["web-search"], queryFn: ({ signal }) => api.get("/api/web-search", signal) });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["web-search"] });
  qc.invalidateQueries({ queryKey: ["tool-catalog"] });
}

export function WebSearchKeyForm({ onSaved }: { onSaved?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: () => api.put("/api/web-search", { api_key: key }),
    onSuccess: () => { setKey(""); invalidate(qc); toast("ok", "Tavily key stored encrypted. Agents you allow can now search the web."); onSaved?.(); },
  });
  return (
    <div className="stack tight">
      <div className="row" style={{ alignItems: "flex-end", gap: 8 }}>
        <label className="field grow">Tavily API key
          <input type="password" autoComplete="off" placeholder="tvly-…" value={key} onChange={(e) => setKey(e.target.value)} />
          <span className="help">From <a href="https://app.tavily.com" target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)" }}>app.tavily.com <ExternalLink size={11} style={{ verticalAlign: -1 }} /></a>. Stored encrypted on the server and never shown again.</span>
        </label>
        <button className="btn dark" disabled={save.isPending || key.trim().length < 10} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save key"}</button>
      </div>
      <InlineError error={save.error} />
    </div>
  );
}

/** Settings → Web search. */
export function WebSearchSettings() {
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const ws = useWebSearch();
  const [query, setQuery] = useState("latest news about AI agents");
  const test = useMutation({ mutationFn: () => api.post("/api/web-search/test", { query }) });
  const remove = useMutation({ mutationFn: () => api.del("/api/web-search"), onSuccess: () => { invalidate(qc); test.reset(); toast("ok", "Web search key removed"); }, onError: (e: any) => toast("error", e.message) });
  if (ws.isLoading) return <SkeletonRows rows={4} />;
  if (ws.error) return <ErrorState error={ws.error} what="web search settings" onRetry={() => ws.refetch()} />;
  const s = ws.data;
  const write = can("settings:write");
  return (
    <div className="stack">
      <Alert kind="info">Agents you allow can search the live web and read public pages through Tavily, like the search in Claude or
        ChatGPT. Each agent decides when a question needs the web and when the answer is in its workspace or company knowledge.
        You choose which agents may search when you create or edit them. Search queries are sent to Tavily; agents are told never
        to include secrets or confidential details.</Alert>
      <section className="panel" aria-label="Tavily web search">
        <div className="panel-head">
          <Globe size={22} aria-hidden />
          <div className="grow"><h2>Tavily</h2>
            <div className="tiny muted">{s.configured ? `Key ${s.key_hint} · ${s.source === "deployment" ? "set by the deployment (SCA_TAVILY_API_KEY)" : "stored for this organization"}` : "Not set up"}</div></div>
          {s.configured ? <Status status="connected" label="Ready" /> : <Status status="disconnected" label="Not set up" />}
          {write && s.source === "organization" && <button className="btn sm ghost" disabled={remove.isPending} onClick={async () => {
            if (await confirm({ title: "Remove the Tavily key?", body: "Agents stop being able to search the web until a key is added again.", confirmLabel: "Remove", danger: true })) remove.mutate();
          }}>Remove</button>}
        </div>
        <div className="panel-body stack">
          {write ? <WebSearchKeyForm /> : !s.configured && <p className="small muted">An organization administrator adds the Tavily key here.</p>}
          {s.configured && write && (
            <div className="stack tight">
              <div className="section-title">Test a live search</div>
              <div className="row" style={{ gap: 8 }}>
                <input className="grow" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Test query" />
                <button className="btn" disabled={test.isPending || query.trim().length < 2} onClick={() => test.mutate()}>{test.isPending ? "Searching…" : "Test search"}</button>
              </div>
              <InlineError error={test.error} />
              {test.data && (test.data.ok
                ? <KV items={test.data.results.map((r: any, i: number) => [`Result ${i + 1}`, <a key={i} href={r.url} target="_blank" rel="noreferrer noopener" className="small" style={{ color: "var(--accent)" }}>{r.title || r.url}</a>])} />
                : <Alert kind="error">{test.data.error}</Alert>)}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** Agent wizard: ask explicitly whether this agent may use web search. */
export function WebSearchPermission({ enabled, onChange }: { enabled: boolean; onChange: (on: boolean) => void }) {
  const { can } = useSession();
  const ws = useWebSearch();
  const ready = !!ws.data?.configured;
  return (
    <section className="panel" aria-label="Web search permission" style={{ padding: 14 }}>
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <Globe size={20} aria-hidden style={{ marginTop: 2 }} />
        <div className="grow stack tight">
          <b>Do you want to enable web search for this agent?</b>
          <span className="small muted">With web search, the agent decides on its own when a question needs current or public information
            (news, prices, releases, public documentation) and searches the web, citing its sources. Questions about your project or
            company stay in its workspace and knowledge sources. Queries are sent to Tavily.</span>
          <div className="row wrap" role="radiogroup" aria-label="Web search" style={{ gap: 8 }}>
            <label className="choice" style={{ cursor: ready ? "pointer" : "not-allowed", padding: "6px 10px", opacity: ready ? 1 : 0.6 }}>
              <input type="radio" name="web-search" checked={enabled} disabled={!ready} onChange={() => onChange(true)} /> Yes, allow web search
            </label>
            <label className="choice" style={{ cursor: "pointer", padding: "6px 10px" }}>
              <input type="radio" name="web-search" checked={!enabled} onChange={() => onChange(false)} /> No, workspace and company knowledge only
            </label>
          </div>
          {!ws.isLoading && !ready && (can("settings:write")
            ? <div className="stack tight"><span className="tiny" style={{ color: "var(--warning)" }}>Web search isn't set up yet. Add your Tavily key once for the whole organization:</span><WebSearchKeyForm /></div>
            : <span className="tiny" style={{ color: "var(--warning)" }}>Web search isn't set up yet. Ask an administrator to add the Tavily key in <Link to="/settings?tab=web" style={{ color: "var(--accent)" }}>Settings → Web search</Link>.</span>)}
        </div>
      </div>
    </section>
  );
}

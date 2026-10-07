"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, RotateCcw, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useChat, useMe } from "@/lib/queries";
import { useAppStore } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/misc";

const STARTERS = [
  "What should I focus on today?",
  "Why did revenue fall?",
  "Why are returns increasing?",
  "Which products are performing badly?",
  "What are customers complaining about?",
  "Which products should I reorder?",
  "Which competitor changed prices?",
  "Show me all critical problems",
];

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="font-semibold text-fg">{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>));
}

/** Minimal, safe markdown: paragraphs, bullets, numbered lists, bold. */
export function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list.ordered ? "ol" : "ul";
    blocks.push(
      <L key={blocks.length} className={cn("space-y-1.5 pl-4", list.ordered ? "list-decimal" : "list-disc", "marker:text-fg-3")}>
        {list.items.map((it, i) => <li key={i} className="pl-0.5">{inline(it)}</li>)}
      </L>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const b = line.match(/^\s*[-•*]\s+(.*)$/);
    const n = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (b || n) {
      const ordered = !!n;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((b ?? n)![1]);
      continue;
    }
    flush();
    if (line.trim() === "") continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(h ? <p key={blocks.length} className="font-semibold text-fg">{inline(h[1])}</p> : <p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="space-y-2.5">{blocks}</div>;
}

export function AssistantPanel() {
  const open = useAppStore((s) => s.assistantOpen);
  const setOpen = useAppStore((s) => s.setAssistantOpen);
  const consume = useAppStore((s) => s.consumeQuestion);
  const pending = useAppStore((s) => s.pendingQuestion);
  const { data: me } = useMe();
  const chat = useChat();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || chat.isPending) return;
    const next: ChatMessage[] = [...messages.filter((m) => !m.error), { role: "user", content: q }];
    setMessages(next);
    setInput("");
    chat.mutate(next, {
      onSuccess: (r) => setMessages((m) => [...m, { role: "assistant", content: r.answer, citations: r.citations, suggestions: r.suggestions, engine: r.engine }]),
      onError: (e) =>
        setMessages((m) => [...m, { role: "assistant", content: e instanceof ApiError ? `${e.message} ${e.hint ?? ""}` : "I couldn't reach the analysis service. Try again in a moment.", error: true }]),
    });
  };

  useEffect(() => {
    if (open && pending) {
      const q = consume();
      if (q) send(q);
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, chat.isPending]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen(!useAppStore.getState().assistantOpen);
      }
      if (e.key === "Escape" && useAppStore.getState().assistantOpen && !useAppStore.getState().commandOpen) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  return (
    <aside
      aria-label="AI assistant"
      aria-hidden={!open}
      className={cn(
        "fixed inset-y-0 right-0 z-[55] flex w-full flex-col border-l border-border bg-surface shadow-pop transition-transform duration-300 ease-[cubic-bezier(.2,.7,.2,1)] sm:w-[440px]",
        open ? "visible translate-x-0" : "pointer-events-none invisible translate-x-full",
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent"><Sparkles className="size-4" /></span>
          <div>
            <div className="text-[14px] font-semibold">Ask your AI team</div>
            <div className="text-[11px] text-fg-3">
              {me?.llm.enabled ? `Reasoning with ${me.llm.model}` : "Answers grounded in your agents' live findings"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <Button variant="ghost" size="icon-sm" onClick={() => setMessages([])} aria-label="New conversation"><RotateCcw /></Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="Close assistant"><X /></Button>
        </div>
      </header>

      <div ref={scroller} className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-4 py-5" aria-live="polite">
        {messages.length === 0 && (
          <div className="animate-fade-in">
            <p className="text-[13.5px] leading-relaxed text-fg-2">
              Ask anything about your business. I answer using what your ten agents found, and cite the data so you can verify it.
            </p>
            <div className="mt-4 grid gap-1.5">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => send(s)} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-[13px] text-fg-2 transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-fg">
                  {s} <ArrowUpRight className="size-3.5 text-fg-3" />
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end animate-rise">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-fg px-3.5 py-2 text-[13.5px] leading-relaxed text-bg">{m.content}</div>
            </div>
          ) : (
            <div key={i} className="animate-rise">
              <div className={cn("text-[13.5px] leading-relaxed text-fg-2", m.error && "rounded-lg bg-crit-soft p-3 text-crit-text")}>
                <Markdown text={m.content} />
              </div>
              {m.citations && m.citations.length > 0 && (
                <div className="mt-3">
                  <div className="eyebrow mb-1.5 !text-[10px]">Sources</div>
                  <div className="flex flex-wrap gap-1.5">
                    {m.citations.map((c, j) => (
                      <Link key={j} href={c.href} onClick={() => window.innerWidth < 640 && setOpen(false)}
                        className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[12px] text-fg-2 hover:border-accent-border hover:text-accent-text">
                        <span className="truncate">{c.label}</span> <ArrowUpRight className="size-3 shrink-0" />
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {i === messages.length - 1 && m.suggestions && m.suggestions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.suggestions.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-full border border-border px-2.5 py-1 text-[12px] text-fg-2 hover:bg-surface-3 hover:text-fg">{s}</button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {chat.isPending && (
          <div className="flex items-center gap-2 text-[12.5px] text-fg-3 animate-fade-in" role="status">
            <span className="flex gap-1">
              {[0, 1, 2].map((d) => <span key={d} className="size-1.5 rounded-full bg-accent animate-pulse-soft" style={{ animationDelay: `${d * 160}ms` }} />)}
            </span>
            Consulting your agents…
          </div>
        )}
      </div>

      <form className="border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <div className="flex items-end gap-2 rounded-xl border border-border bg-surface-2 p-1.5 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent-soft">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Why did revenue fall this month?"
            aria-label="Ask a question"
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-[13.5px] outline-none placeholder:text-fg-3"
          />
          <Button type="submit" size="icon-sm" variant="primary" disabled={!input.trim() || chat.isPending} aria-label="Send"><ArrowUp /></Button>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-1 text-[10.5px] text-fg-3">
          <span>Numbers come from deterministic agent analysis.</span>
          <span className="flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>J</Kbd></span>
        </div>
      </form>
    </aside>
  );
}

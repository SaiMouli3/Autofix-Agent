"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, Boxes, LayoutDashboard, Moon, Package, Receipt, Search, Sparkles, Sun, User, Wallet } from "lucide-react";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { AGENTS } from "@/lib/agents";
import { usd } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { Kbd } from "@/components/ui/misc";

interface SearchResult {
  orders: { id: string; number: string; customer: string; amount: number; status: string }[];
  customers: { id: string; name: string; email: string; city: string }[];
  products: { id: string; name: string; sku: string; category: string }[];
}

function useDebounced<T>(v: T, ms = 180) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

const item = "flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-fg-2 data-[selected=true]:bg-surface-3 data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:text-fg-3";
const group = "px-1.5 pb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-3";

export function CommandPalette() {
  const open = useAppStore((s) => s.commandOpen);
  const setOpen = useAppStore((s) => s.setCommandOpen);
  const ask = useAppStore((s) => s.setAssistantOpen);
  const storeId = useAppStore((s) => s.storeId);
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const { data, isFetching } = useQuery({
    queryKey: ["search", storeId, dq],
    queryFn: () => api<SearchResult>(`/search${qs({ q: dq })}`),
    enabled: open && dq.length >= 2,
    staleTime: 30_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useAppStore.getState().commandOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[2px] animate-fade-in dark:bg-black/60" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[14vh] z-[81] w-[calc(100vw-24px)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-pop animate-rise">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search orders, customers and products, open agents or ask AI.</DialogPrimitive.Description>
          <Command shouldFilter={true} loop label="Command palette">
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search className="size-4 text-fg-3" />
              <Command.Input value={q} onValueChange={setQ} autoFocus placeholder="Search orders, customers, products — or ask AI…"
                className="h-12 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-3" />
              {isFetching && <span className="size-3 animate-spin rounded-full border-2 border-border border-t-fg-2" />}
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="scrollbar-thin max-h-[min(420px,55vh)] overflow-y-auto py-1.5">
              <Command.Empty className="px-4 py-8 text-center text-[13px] text-fg-3">No matches. Press Enter on “Ask AI” to ask your operations team.</Command.Empty>
              {q.trim().length > 0 && (
                <Command.Group heading="Ask AI" className={group}>
                  <Command.Item value={`ask ${q}`} className={item} onSelect={() => { setOpen(false); ask(true, q.trim()); setQ(""); }}>
                    <Sparkles className="!text-accent" /> Ask AI: <span className="truncate text-fg">“{q.trim()}”</span>
                  </Command.Item>
                </Command.Group>
              )}
              {data?.orders?.length ? (
                <Command.Group heading="Orders" className={group}>
                  {data.orders.map((o) => (
                    <Command.Item key={o.id} value={`order ${o.number} ${o.customer} ${q}`} className={item} onSelect={() => go(`/agents/orders?tab=data&q=${encodeURIComponent(o.number)}`)}>
                      <Receipt /> <span className="text-fg">{o.number}</span> <span className="truncate">{o.customer}</span>
                      <span className="ml-auto tabular text-[12px] text-fg-3">{usd(o.amount)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {data?.customers?.length ? (
                <Command.Group heading="Customers" className={group}>
                  {data.customers.map((c) => (
                    <Command.Item key={c.id} value={`customer ${c.name} ${c.email} ${q}`} className={item} onSelect={() => go(`/agents/customers?customer=${c.id}`)}>
                      <User /> <span className="text-fg">{c.name}</span> <span className="truncate text-fg-3">{c.city}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {data?.products?.length ? (
                <Command.Group heading="Products" className={group}>
                  {data.products.map((p) => (
                    <Command.Item key={p.id} value={`product ${p.name} ${p.sku} ${q}`} className={item} onSelect={() => go(`/agents/products?product=${p.id}`)}>
                      <Package /> <span className="truncate text-fg">{p.name}</span> <span className="ml-auto text-[12px] text-fg-3">{p.sku}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              <Command.Group heading="Quick actions" className={group}>
                <Command.Item className={item} onSelect={() => go("/insights")} value="view critical issues problems">
                  <AlertTriangle /> View critical issues
                </Command.Item>
                <Command.Item className={item} onSelect={() => go("/agents/finance")} value="view revenue finance profit">
                  <Wallet /> View revenue
                </Command.Item>
                <Command.Item className={item} onSelect={() => go("/agents/inventory?tab=data")} value="view inventory stock">
                  <Boxes /> View inventory
                </Command.Item>
                <Command.Item className={item} onSelect={() => { setOpen(false); ask(true); }} value="ask ai assistant">
                  <Sparkles /> Ask AI
                </Command.Item>
                <Command.Item className={item} onSelect={() => go("/dashboard")} value="overview dashboard home">
                  <LayoutDashboard /> Go to overview
                </Command.Item>
                <Command.Item className={item} onSelect={() => { setTheme(resolvedTheme === "dark" ? "light" : "dark"); setOpen(false); }} value="toggle theme dark light mode">
                  {resolvedTheme === "dark" ? <Sun /> : <Moon />} Switch to {resolvedTheme === "dark" ? "light" : "dark"} mode
                </Command.Item>
              </Command.Group>
              <Command.Group heading="Open agent" className={group}>
                {AGENTS.map((a) => (
                  <Command.Item key={a.id} className={item} value={`open agent ${a.name}`} onSelect={() => go(`/agents/${a.id}`)}>
                    <a.icon style={{ color: a.hue }} /> {a.name}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
            <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-fg-3">
              <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
              <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
              <span className="ml-auto flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd> toggle</span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell, BellOff, Check, X } from "lucide-react";
import { agentMeta, SEVERITY } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { useMarkNotifications, useNotifications } from "@/lib/queries";
import type { Severity } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { AgentIcon } from "@/components/agents/primitives";

const FILTERS: { key: "all" | "unread" | Severity; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "critical", label: "Critical" },
  { key: "important", label: "Important" },
  { key: "market", label: "Market" },
];

export function NotificationCenter() {
  const { data } = useNotifications();
  const mark = useMarkNotifications();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const items = (data?.notifications ?? []).filter((n) => filter === "all" || (filter === "unread" ? !n.read : n.severity === filter));
  const unread = data?.unread ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-crit px-1 text-[9.5px] font-bold text-white tabular animate-fade-in">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(420px,calc(100vw-24px))] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-[14px] font-semibold">Notifications</div>
            <div className="text-[11.5px] text-fg-3">{unread} unread from your agents</div>
          </div>
          <Button size="xs" variant="ghost" disabled={!unread || mark.isPending} onClick={() => mark.mutate({ action: "read", all: true })}>
            <Check /> Mark all read
          </Button>
        </div>
        <div className="scrollbar-thin flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={cn("h-6 shrink-0 rounded-full px-2.5 text-[11.5px] font-medium text-fg-3 hover:text-fg", filter === f.key && "bg-surface-3 text-fg")}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="scrollbar-thin max-h-[min(460px,60vh)] overflow-y-auto">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <BellOff className="size-5 text-fg-3" />
              <p className="text-[13px] font-medium">You&apos;re all caught up</p>
              <p className="text-[12px] text-fg-3">Agents will notify you the moment something needs attention.</p>
            </div>
          ) : (
            items.map((n) => (
              <div key={n.id} className={cn("group relative flex gap-3 border-b border-border px-4 py-3 last:border-0 hover:bg-surface-2", !n.read && "bg-accent-soft/40")}>
                <AgentIcon id={n.agentId} size="sm" className="mt-0.5" />
                <Link href={n.href} className="min-w-0 flex-1" onClick={() => { setOpen(false); if (!n.read) mark.mutate({ action: "read", ids: [n.id] }); }}>
                  <div className="flex items-center gap-1.5 text-[11px] text-fg-3">
                    <span className={cn("size-1.5 rounded-full", SEVERITY[n.severity].dot)} />
                    <span>{agentMeta(n.agentId).short}</span>
                    <span>·</span>
                    <span>{relativeTime(n.at)}</span>
                  </div>
                  <p className={cn("mt-0.5 text-[13px] leading-snug", n.read ? "text-fg-2" : "font-medium text-fg")}>{n.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[12px] text-fg-3">{n.body}</p>
                </Link>
                <button onClick={() => mark.mutate({ action: "dismiss", ids: [n.id] })} aria-label="Dismiss notification"
                  className="h-6 rounded-md p-1 text-fg-3 opacity-0 transition-opacity hover:bg-surface-3 hover:text-fg focus:opacity-100 group-hover:opacity-100">
                  <X className="size-3.5" />
                </button>
                {!n.read && <span className="absolute right-3 top-3.5 size-1.5 rounded-full bg-accent group-hover:hidden" aria-label="Unread" />}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

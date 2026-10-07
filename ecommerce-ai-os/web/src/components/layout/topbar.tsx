"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, LogOut, Menu, Monitor, Moon, Plus, Search, Sparkles, Store as StoreIcon, Sun } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useMe } from "@/lib/queries";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/misc";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Sheet,
} from "@/components/ui/overlay";
import { Logo } from "./logo";
import { NotificationCenter } from "./notifications";
import { RangePicker } from "./range-picker";
import { SidebarContent } from "./sidebar";

export function StoreSwitcher() {
  const { data } = useMe();
  const storeId = useAppStore((s) => s.storeId);
  const setStoreId = useAppStore((s) => s.setStoreId);
  const qc = useQueryClient();
  const stores = data?.stores ?? [];
  const current = stores.find((s) => s.id === storeId) ?? stores[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="min-w-0 max-w-[150px] gap-2 px-2 sm:max-w-[220px]" aria-label="Switch store">
          <span className="grid size-5 place-items-center rounded-md bg-surface-3 text-fg-2"><StoreIcon className="!size-3" /></span>
          <span className="truncate font-medium text-fg">{current?.name ?? "Store"}</span>
          <ChevronsUpDown className="!size-3.5 text-fg-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{data?.organization?.name ?? "Stores"}</DropdownMenuLabel>
        {stores.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => { setStoreId(s.id); qc.invalidateQueries(); }}>
            <StoreIcon />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-fg">{s.name}</span>
              <span className="block text-[11px] capitalize text-fg-3">{s.platform === "demo" ? "Demo store" : s.platform} · {s.businessType}</span>
            </span>
            {current?.id === s.id && <Check className="!text-fg" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding?step=business"><Plus /> Connect another store</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const { data } = useMe();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const name = data?.user.name ?? "";
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "·";
  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    qc.clear();
    useAppStore.getState().setStoreId(undefined);
    router.replace("/login");
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="grid size-8 place-items-center rounded-full bg-fg text-[11.5px] font-semibold text-bg ring-offset-2 ring-offset-bg transition-shadow hover:ring-2 hover:ring-border-strong" aria-label="Account menu">
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <div className="px-2 py-2">
          <div className="text-[13px] font-medium">{name}</div>
          <div className="truncate text-[12px] text-fg-3">{data?.user.email}</div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {([["light", Sun, "Light"], ["dark", Moon, "Dark"], ["system", Monitor, "System"]] as const).map(([k, Icon, label]) => (
          <DropdownMenuItem key={k} onSelect={(e) => { e.preventDefault(); setTheme(k); }}>
            <Icon /> {label} {theme === k && <Check className="ml-auto !text-fg" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout}><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar() {
  const setCommand = useAppStore((s) => s.setCommandOpen);
  const setAssistant = useAppStore((s) => s.setAssistantOpen);
  const assistantOpen = useAppStore((s) => s.assistantOpen);
  const [menu, setMenu] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
      <div className="flex h-14 items-center gap-1.5 px-3 sm:gap-2 sm:px-4 lg:px-6">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMenu(true)} aria-label="Open navigation"><Menu /></Button>
        <Link href="/dashboard" className="hidden sm:block lg:hidden" aria-label="Home"><Logo collapsed /></Link>
        <StoreSwitcher />
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <RangePicker className="hidden md:flex" />
          <button onClick={() => setCommand(true)} aria-label="Search (Ctrl K)"
            className="flex h-8 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[12.5px] text-fg-3 shadow-xs transition-colors hover:border-border-strong hover:text-fg-2">
            <Search className="size-4" />
            <span className="hidden w-28 text-left lg:inline">Search…</span>
            <Kbd className="hidden lg:inline-flex">⌘K</Kbd>
          </button>
          <NotificationCenter />
          <Button size="sm" variant={assistantOpen ? "subtle" : "secondary"} onClick={() => setAssistant(!assistantOpen)} aria-pressed={assistantOpen} className="gap-1.5">
            <Sparkles className="!text-accent" /> <span className="hidden sm:inline">Ask AI</span>
          </Button>
          <UserMenu />
        </div>
      </div>
      <div className="flex items-center border-t border-border px-4 py-2 md:hidden">
        <RangePicker />
      </div>
      <Sheet open={menu} onOpenChange={setMenu} title={<Logo />} width="max-w-[300px] !left-0 !right-auto border-r">
        <div className={cn("h-full p-3")}><SidebarContent onNavigate={() => setMenu(false)} /></div>
      </Sheet>
    </header>
  );
}

export function PageHeader({ title, description, actions, eyebrow, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.025em] sm:text-[26px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

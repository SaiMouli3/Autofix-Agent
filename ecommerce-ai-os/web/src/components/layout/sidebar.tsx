"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, LayoutDashboard, PanelLeftClose, PanelLeft, Sparkles, Store } from "lucide-react";
import { AGENTS } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { useAgents } from "@/lib/queries";
import { useAppStore } from "@/lib/store";
import { StatusDot } from "@/components/agents/primitives";
import { Tooltip } from "@/components/ui/misc";
import { Logo } from "./logo";

function NavItem({ href, label, icon: Icon, active, collapsed, badge, status, hue }: {
  href: string; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; active: boolean; collapsed: boolean;
  badge?: number; status?: Parameters<typeof StatusDot>[0]["status"]; hue?: string;
}) {
  const link = (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] text-fg-2 transition-colors hover:bg-surface-3 hover:text-fg",
        active && "bg-surface text-fg shadow-xs ring-1 ring-border",
        collapsed && "justify-center px-0",
      )}
    >
      <Icon className="size-4 shrink-0" style={hue && active ? { color: hue } : undefined} />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {!collapsed && status && status !== "monitoring" && <StatusDot status={status} />}
      {!collapsed && !!badge && (
        <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-crit-soft px-1 text-[10.5px] font-semibold text-crit-text tabular">{badge}</span>
      )}
      {collapsed && !!badge && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-crit" />}
    </Link>
  );
  return collapsed ? <Tooltip content={label} side="right">{link}</Tooltip> : link;
}

export function SidebarContent({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data } = useAgents();
  const byId = new Map((data?.agents ?? []).map((a) => [a.id, a]));
  return (
    <nav className="flex h-full flex-col" aria-label="Primary" onClick={onNavigate}>
      <div className={cn("space-y-0.5", collapsed && "px-0")}>
        <NavItem href="/dashboard" label="Overview" icon={LayoutDashboard} active={pathname === "/dashboard"} collapsed={collapsed} />
        <NavItem href="/insights" label="Business Insights" icon={Sparkles} active={pathname === "/insights"} collapsed={collapsed}
          badge={data?.business.issues} hue="var(--accent)" />
        <NavItem href="/agents" label="AI Team" icon={Bot} active={pathname === "/agents"} collapsed={collapsed} />
        <NavItem href="/shop" label="Storefront" icon={Store} active={false} collapsed={collapsed} />
      </div>
      <div className={cn("eyebrow mb-1.5 mt-5 px-2", collapsed && "sr-only")}>Agents</div>
      {collapsed && <div className="my-3 h-px bg-border" />}
      <div className="scrollbar-thin -mr-1 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {AGENTS.map((a) => {
          const s = byId.get(a.id);
          return (
            <NavItem key={a.id} href={`/agents/${a.id}`} label={a.short} icon={a.icon} hue={a.hue} active={pathname.startsWith(`/agents/${a.id}`)}
              collapsed={collapsed} status={s?.status} badge={s?.issues} />
          );
        })}
      </div>
    </nav>
  );
}

export function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggle = useAppStore((s) => s.toggleSidebar);
  return (
    <aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-bg px-3 py-4 transition-[width] duration-200 lg:flex", collapsed ? "w-[60px]" : "w-[232px]")}>
      <div className={cn("mb-6 flex items-center justify-between", collapsed && "justify-center")}>
        <Link href="/dashboard" aria-label="E-commerce AI OS home"><Logo collapsed={collapsed} /></Link>
      </div>
      <SidebarContent collapsed={collapsed} />
      <button onClick={toggle} className={cn("mt-3 flex h-8 items-center gap-2 rounded-lg px-2 text-[12.5px] text-fg-3 hover:bg-surface-3 hover:text-fg", collapsed && "justify-center px-0")}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? <PanelLeft className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse</>}
      </button>
    </aside>
  );
}

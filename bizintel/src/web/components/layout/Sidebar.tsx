import { NavLink } from "react-router-dom";
import {
  BookOpen,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  Compass,
  Database,
  Download,
  FlaskConical,
  History,
  LayoutDashboard,
  ListChecks,
  Mail,
  Settings,
  Target,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import type { Branding } from "@/lib/types";
import { Tooltip } from "../ui/primitives";

export const NAV_PRIMARY = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/discover", label: "Discover Businesses", icon: Compass },
  { to: "/businesses", label: "All Businesses", icon: Building2 },
  { to: "/lists", label: "Saved Lists", icon: ListChecks },
  { to: "/research", label: "Research Workspace", icon: FlaskConical },
  { to: "/opportunities", label: "Opportunities", icon: Target },
  { to: "/outreach", label: "Outreach", icon: Mail },
  { to: "/exports", label: "Exports", icon: Download },
];

export const NAV_SECONDARY = [
  { to: "/searches", label: "Search History", icon: History },
  { to: "/data-sources", label: "Data Sources", icon: Database },
  { to: "/settings", label: "Settings", icon: Settings },
];

function Item({ to, label, icon: Icon, end, collapsed, onNavigate }: { to: string; label: string; icon: typeof Compass; end?: boolean; collapsed: boolean; onNavigate?: () => void }) {
  const link = (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "group flex h-8 items-center gap-2.5 rounded px-2 text-sm font-medium transition-colors duration-fast",
          collapsed && "justify-center px-0",
          isActive ? "bg-primary-subtle text-primary" : "text-fg-2 hover:bg-subtle hover:text-fg",
        )
      }
    >
      <Icon size={16} strokeWidth={1.9} className="shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={label} side="bottom">
      <div className="w-full">{link}</div>
    </Tooltip>
  ) : (
    link
  );
}

export function BrandMark({ branding, collapsed }: { branding: Branding; collapsed: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
      {branding.logoUrl ? (
        <img src={branding.logoUrl} alt="" className="h-7 w-7 shrink-0 rounded object-contain" />
      ) : (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-primary text-primary-fg" aria-hidden>
          <svg viewBox="0 0 32 32" width="18" height="18">
            <path d="M7 23l6-14 5 9 2.5-4.5L25 23" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">{branding.productName}</div>
          <div className="truncate text-2xs text-fg-3">{branding.workspaceName}</div>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ branding, collapsed, onToggle, onNavigate, footer }: { branding: Branding; collapsed: boolean; onToggle?: () => void; onNavigate?: () => void; footer?: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-header items-center border-b border-border", collapsed ? "justify-center px-2" : "px-3")}>
        <BrandMark branding={branding} collapsed={collapsed} />
      </div>
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2 py-3 scrollbar-thin">
        <ul className="space-y-0.5">
          {NAV_PRIMARY.map((n) => (
            <li key={n.to}>
              <Item {...n} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
        <div className={cn("mb-1.5 mt-5 px-2 t-th", collapsed && "sr-only")}>Workspace</div>
        {collapsed && <div className="my-3 h-px bg-border" aria-hidden />}
        <ul className="space-y-0.5" aria-label="Workspace">
          {NAV_SECONDARY.map((n) => (
            <li key={n.to}>
              <Item {...n} collapsed={collapsed} onNavigate={onNavigate} />
            </li>
          ))}
          <li>
            <Item to="/help" label="Help & documentation" icon={BookOpen} collapsed={collapsed} onNavigate={onNavigate} />
          </li>
        </ul>
      </nav>
      <div className="border-t border-border p-2">
        {footer}
        {onToggle && (
          <button
            onClick={onToggle}
            className={cn("mt-1 flex h-8 w-full items-center gap-2.5 rounded px-2 text-sm text-fg-3 hover:bg-subtle hover:text-fg", collapsed && "justify-center px-0")}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        )}
      </div>
    </div>
  );
}

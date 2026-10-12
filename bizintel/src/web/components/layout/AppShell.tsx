import { useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ChevronRight, HelpCircle, Laptop, Menu as MenuIcon, Moon, Settings, Sun, UserRound } from "lucide-react";
import { useConfig } from "@/lib/queries";
import { cn } from "@/lib/format";
import type { Branding } from "@/lib/types";
import { IconButton } from "../ui/Button";
import { Drawer } from "../ui/Dialog";
import { Menu } from "../ui/Menu";
import { useCrumbState } from "./crumbs";
import { GlobalSearch } from "./GlobalSearch";
import { Sidebar } from "./Sidebar";
import { useTheme, type ThemePref } from "./theme";
import { useNavigate } from "react-router-dom";

const FALLBACK_BRANDING: Branding = { productName: "Business Intelligence", workspaceName: "Workspace", logoUrl: null, theme: "system" };

function readCollapsed() {
  try {
    return localStorage.getItem("sidebar-collapsed") === "1";
  } catch {
    return false;
  }
}

function Breadcrumbs() {
  const crumbs = useCrumbState();
  if (!crumbs.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="shrink-0 text-fg-3" aria-hidden />}
            {c.to && i < crumbs.length - 1 ? (
              <Link to={c.to} className="truncate text-fg-2 hover:text-fg">
                {c.label}
              </Link>
            ) : (
              <span className="truncate font-medium text-fg" aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function WorkspaceFooter({ branding, collapsed, theme, setTheme }: { branding: Branding; collapsed: boolean; theme: ThemePref; setTheme: (t: ThemePref) => void }) {
  const navigate = useNavigate();
  return (
    <Menu
      label="Workspace and preferences"
      align="start"
      className="flex w-full"
      items={[
        { label: "Workspace settings", icon: <Settings size={14} />, onSelect: () => navigate("/settings/branding") },
        { label: "Help & documentation", icon: <HelpCircle size={14} />, onSelect: () => navigate("/help") },
        "separator",
        { label: `Light theme${theme === "light" ? " ✓" : ""}`, icon: <Sun size={14} />, onSelect: () => setTheme("light") },
        { label: `Dark theme${theme === "dark" ? " ✓" : ""}`, icon: <Moon size={14} />, onSelect: () => setTheme("dark") },
        { label: `Match system${theme === "system" ? " ✓" : ""}`, icon: <Laptop size={14} />, onSelect: () => setTheme("system") },
      ]}
      trigger={(p) => (
        <button {...p} className={cn("flex h-10 w-full items-center gap-2.5 rounded px-2 text-left hover:bg-subtle", collapsed && "justify-center px-0")} aria-label="Workspace and preferences">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-fg-2" aria-hidden>
            <UserRound size={15} />
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">Local user</span>
              <span className="block truncate text-2xs text-fg-3">{branding.workspaceName} · no sign-in configured</span>
            </span>
          )}
        </button>
      )}
    />
  );
}

export function AppShell() {
  const { data: cfg } = useConfig();
  const branding = cfg?.branding ?? FALLBACK_BRANDING;
  const [theme, setTheme] = useTheme(branding.theme);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("sidebar-collapsed", c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-toast focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow-md">
        Skip to content
      </a>
      <aside className={cn("sticky top-0 hidden h-screen shrink-0 border-r border-border bg-surface transition-[width] duration-base lg:block", collapsed ? "w-sidebar-collapsed" : "w-sidebar")}>
        <Sidebar branding={branding} collapsed={collapsed} onToggle={toggle} footer={<WorkspaceFooter branding={branding} collapsed={collapsed} theme={theme} setTheme={setTheme} />} />
      </aside>
      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} title="Navigation" side="left">
        <Sidebar branding={branding} collapsed={false} onNavigate={() => setMobileOpen(false)} footer={<WorkspaceFooter branding={branding} collapsed={false} theme={theme} setTheme={setTheme} />} />
      </Drawer>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-header flex h-header items-center gap-3 border-b border-border bg-surface/90 px-3 backdrop-blur sm:px-4">
          <IconButton label="Open navigation" className="lg:hidden" onClick={() => setMobileOpen(true)}>
            <MenuIcon size={18} />
          </IconButton>
          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>
          <div className="flex w-full max-w-[420px] justify-end">
            <GlobalSearch />
          </div>
          <IconButton label="Help & documentation" onClick={() => navigate("/help")} className="hidden sm:inline-flex">
            <HelpCircle size={17} />
          </IconButton>
        </header>
        <main id="main" className="min-w-0 flex-1" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

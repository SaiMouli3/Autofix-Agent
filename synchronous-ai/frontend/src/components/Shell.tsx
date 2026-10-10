import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  Bot,
  CalendarClock,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  LayoutGrid,
  Library,
  ListFilter,
  LogOut,
  Menu as MenuIcon,
  Pin,
  Plug,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { BRAND } from "../brand";
import { BrandLockup } from "./BrandLockup";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import { useDebounced, usePref } from "../lib/prefs";
import { useSession } from "../lib/session";
import { statusOf } from "../lib/status";
import { ActivityEvent, useActivityStream } from "../lib/stream";
import { BotMark } from "./BotMark";
import { ErrorBoundary, Menu } from "./ui";

// ------------------------------------------------------------------ live store (unread markers + notifications)

interface Notif { id: number; agentId: string; taskId: string; text: string; ts: string; kind: "approval" | "completed" | "failed" }
interface Live { unread: Record<string, number>; notifs: Notif[]; seenAt: number; markSeen: (agentId: string) => void; markRead: () => void; stream: string }
const LiveCtx = createContext<Live>({ unread: {}, notifs: [], seenAt: 0, markSeen: () => {}, markRead: () => {}, stream: "connecting" });
export const useLive = () => useContext(LiveCtx);

export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const loc = useLocation();
  const path = useRef(loc.pathname);
  path.current = loc.pathname;
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [seenAt, setSeenAt] = useState(Date.now());
  const timer = useRef<number | null>(null);
  const stream = useActivityStream((e: ActivityEvent) => {
    if (timer.current === null) {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        for (const k of ["agents", "approvals-count", "overview", "tasks"]) qc.invalidateQueries({ queryKey: [k] });
      }, 700);
    }
    const st = e.data?.status;
    const kind: Notif["kind"] | null =
      e.type === "approval" && st === "waiting_for_approval" ? "approval"
        : e.type === "status" && st === "completed" ? "completed"
          : e.type === "status" && (st === "failed" || st === "timed_out") ? "failed" : null;
    if (!kind) return;
    if (!path.current.startsWith(`/agents/${e.agent_id}`)) setUnread((u) => ({ ...u, [e.agent_id]: (u[e.agent_id] ?? 0) + 1 }));
    setNotifs((n) => [{ id: e.id, agentId: e.agent_id, taskId: e.task_id, text: e.summary, ts: e.ts, kind }, ...n].slice(0, 40));
  });
  const markSeen = useCallback((id: string) => setUnread((u) => (u[id] ? { ...u, [id]: 0 } : u)), []);
  const markRead = useCallback(() => setSeenAt(Date.now()), []);
  const value = useMemo(() => ({ unread, notifs, seenAt, markSeen, markRead, stream }), [unread, notifs, seenAt, markSeen, markRead, stream]);
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

// ------------------------------------------------------------------ shell

export interface Crumb { label: string; to?: string }

export function Shell({ crumbs, children, full, actions }: { crumbs: Crumb[]; children: ReactNode; full?: boolean; actions?: ReactNode }) {
  const [collapsed, setCollapsed] = usePref("nav.collapsed", false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);
  return (
    <div className={`app ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-nav" : ""}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      {mobileOpen && <div className="backdrop" style={{ zIndex: 115 }} onClick={() => setMobileOpen(false)} aria-hidden />}
      <div className="main">
        <Topbar crumbs={crumbs} actions={actions} onMenu={() => setMobileOpen(true)} />
        <main className="content" id="main" tabIndex={-1}>
          <ErrorBoundary resetKey={loc.pathname}>
            {full ? children : <div className="page">{children}</div>}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

const NAV = [
  { to: "/", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/agents", label: "Agents", icon: Bot, end: true },
  { to: "/tasks", label: "Tasks", icon: ClipboardList },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/knowledge", label: "Knowledge", icon: Library },
  { to: "/workflows", label: "Workflows", icon: CalendarClock },
  { to: "/approvals", label: "Approvals", icon: ShieldCheck, badge: true },
  { to: "/monitoring", label: "Monitoring", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings },
];

const AGENT_FILTERS = [
  { key: "", label: "All agents" },
  { key: "attention", label: "Needs attention" },
  { key: "running", label: "Running" },
  { key: "idle", label: "Idle" },
  { key: "inactive", label: "Draft or disabled" },
];

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { me, can } = useSession();
  const { unread } = useLive();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [filter, setFilter] = usePref("agents.filter", "");
  const [group, setGroup] = usePref<"none" | "category" | "team">("agents.group", "none");
  const [pins, setPins] = usePref<string[]>(`agents.pins.${me.user.id}`, []);
  const agents = useQuery({ queryKey: ["agents", "nav"], queryFn: ({ signal }) => api.get("/api/agents?page_size=500", signal), refetchInterval: 20000 });
  const teams = useQuery({ queryKey: ["teams"], queryFn: ({ signal }) => api.get("/api/teams", signal), enabled: group === "team" });
  const approvals = useQuery({ queryKey: ["approvals-count"], queryFn: ({ signal }) => api.get("/api/approvals?status=pending&page_size=1", signal), refetchInterval: 30000 });
  const pending = approvals.data?.total ?? 0;
  const all: any[] = agents.data?.items ?? [];
  const visible = all.filter((a) => {
    if (q && !a.name.toLowerCase().includes(q.toLowerCase())) return false;
    const s = a.live_status;
    if (filter === "attention") return s === "waiting_for_approval" || s === "failed" || (unread[a.id] ?? 0) > 0;
    if (filter === "running") return s === "running" || s === "queued";
    if (filter === "idle") return a.status === "active" && ["idle", "completed"].includes(s);
    if (filter === "inactive") return a.status !== "active";
    return true;
  });
  const pinned = visible.filter((a) => pins.includes(a.id));
  const rest = visible.filter((a) => !pins.includes(a.id));
  const teamName = (id: string | null) => (teams.data ?? []).find((t: any) => t.id === id)?.name ?? "No team";
  const groups: [string, any[]][] = group === "none" ? [["", rest]]
    : Object.entries(rest.reduce((acc: Record<string, any[]>, a) => {
      const k = group === "category" ? a.category || "General" : teamName(a.team_id);
      (acc[k] ||= []).push(a);
      return acc;
    }, {})).sort(([a], [b]) => a.localeCompare(b));
  const togglePin = (id: string) => setPins(pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id]);
  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => {});
    qc.clear();
    window.location.href = "/login";
  };
  const initials = me.user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <div className="side-head">
        <Link to="/" className="grow side-brand" aria-label={`${BRAND.name} home — ${me.org.name}`} title={me.org.name} data-tip={collapsed ? BRAND.name : undefined}>
          <BrandLockup size={34} markOnly={collapsed} />
        </Link>
        {!collapsed && <button className="btn ghost icon sm hide-sm" onClick={onToggle} aria-label="Collapse navigation" data-tip="Collapse"><ChevronsLeft /></button>}
      </div>
      <nav className="nav" aria-label="Sections">
        {collapsed && <button className="nav-item" onClick={onToggle} aria-label="Expand navigation" data-tip="Expand" style={{ border: 0, background: "none", cursor: "pointer" }}><ChevronsRight /></button>}
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`} data-tip={collapsed ? n.label : undefined}>
            <n.icon aria-hidden />
            <span>{n.label}</span>
            {n.badge && pending > 0 && <em className="nav-count" aria-label={`${pending} pending approvals`}>{pending}</em>}
          </NavLink>
        ))}
      </nav>
      <div className="side-section">
        <span className="side-label" id="agents-label">Agents</span>
        <div className="row" style={{ gap: 2 }}>
          <Menu label="Agent list options" trigger={(p) => <button {...p} className="btn ghost icon sm" aria-label="Filter and group agents" data-tip="Filter & group"><ListFilter /></button>}
            items={[
              ...AGENT_FILTERS.map((f) => ({ label: `${filter === f.key ? "✓ " : ""}${f.label}`, onSelect: () => setFilter(f.key) })),
              { label: "", separator: true },
              { label: `${group === "none" ? "✓ " : ""}No grouping`, onSelect: () => setGroup("none") },
              { label: `${group === "category" ? "✓ " : ""}Group by category`, onSelect: () => setGroup("category") },
              { label: `${group === "team" ? "✓ " : ""}Group by team`, onSelect: () => setGroup("team") },
            ]} />
          {can("agents:write") && <Link className="btn ghost icon sm" to="/agents/new" aria-label="Create agent" data-tip="New agent"><Plus /></Link>}
        </div>
      </div>
      <div className="agent-tools">
        <input type="search" placeholder="Find agent" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find agent" />
      </div>
      {filter && !collapsed && (
        <div className="tiny muted" style={{ padding: "0 16px 4px" }}>
          {AGENT_FILTERS.find((f) => f.key === filter)?.label} · <button className="disclose" onClick={() => setFilter("")}>clear</button>
        </div>
      )}
      <div className="agent-list" role="list" aria-labelledby="agents-label">
        {agents.isLoading && <div className="stack tight" style={{ padding: 8 }}>{[1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 30 }} />)}</div>}
        {agents.isError && <p className="tiny muted" style={{ padding: 8 }}>Agents unavailable. <button className="disclose" onClick={() => agents.refetch()}>Retry</button></p>}
        {agents.data && all.length === 0 && !collapsed && (
          <div className="tiny muted" style={{ padding: "6px 8px" }}>
            No agents yet.{can("agents:write") && <> <Link to="/agents/new" style={{ color: "var(--accent)" }}>Create your first agent</Link>.</>}
          </div>
        )}
        {agents.data && all.length > 0 && visible.length === 0 && !collapsed && <div className="tiny muted" style={{ padding: "6px 8px" }}>No agents match.</div>}
        {pinned.length > 0 && <div className="agent-group">Pinned</div>}
        {pinned.map((a) => <AgentRow key={a.id} a={a} unread={unread[a.id] ?? 0} pinned onPin={togglePin} collapsed={collapsed} />)}
        {groups.map(([g, list]) => (
          <div key={g || "all"}>
            {(g || (pinned.length > 0 && list.length > 0)) && <div className="agent-group">{g || "All"}</div>}
            {list.map((a) => <AgentRow key={a.id} a={a} unread={unread[a.id] ?? 0} onPin={togglePin} collapsed={collapsed} />)}
          </div>
        ))}
      </div>
      <div className="side-foot">
        <Menu up label="Account" trigger={(p) => (
          <button {...p} className="user-btn" aria-label={`Account: ${me.user.name}`}>
            <span className="initials" aria-hidden>{initials}</span>
            <span className="meta grow" style={{ minWidth: 0 }}>
              <div className="small strong ellipsis">{me.user.name}</div>
              <div className="tiny muted ellipsis" title={`${me.role_label} · ${me.org.name}`}>{me.role_label} · {me.org.name}</div>
            </span>
          </button>
        )} items={[
          { label: "Account & password", icon: UserRound, onSelect: () => nav("/settings?tab=account") },
          { label: "Organization settings", icon: Settings, onSelect: () => nav("/settings") },
          { label: "", separator: true },
          { label: "Sign out", icon: LogOut, onSelect: logout },
        ]} />
      </div>
    </aside>
  );
}

function AgentRow({ a, unread, pinned, onPin, collapsed }: { a: any; unread: number; pinned?: boolean; onPin: (id: string) => void; collapsed: boolean }) {
  const s = statusOf(a.live_status);
  const running = a.task_counts?.running ?? 0;
  const attention = unread + (a.pending_approvals ?? 0);
  return (
    <div role="listitem" style={{ position: "relative" }}>
      <NavLink to={`/agents/${a.id}`} className={({ isActive }) => `agent-row ${isActive ? "active" : ""}`}
        data-tip={collapsed ? `${a.name} · ${s.label}` : undefined} aria-label={`${a.name}, ${s.label}${attention ? `, ${attention} need attention` : ""}`}>
        <BotMark seed={a.id} avatar={a.avatar} size={26} state={a.status !== "active" ? a.status : a.live_status} />
        <span className="meta grow" style={{ minWidth: 0 }}>
          <div className="name">{a.name}</div>
          <div className="sub">
            <span>{s.label}</span>
            {running > 1 && <span>· {running} tasks</span>}
          </div>
        </span>
        {attention > 0 && <span className="unread" aria-hidden>{attention}</span>}
        <button className={`pin ${pinned ? "on" : ""}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPin(a.id); }}
          aria-label={pinned ? `Unpin ${a.name}` : `Pin ${a.name}`} aria-pressed={!!pinned}>
          <Pin fill={pinned ? "currentColor" : "none"} />
        </button>
      </NavLink>
    </div>
  );
}

// ------------------------------------------------------------------ topbar

function Topbar({ crumbs, actions, onMenu }: { crumbs: Crumb[]; actions?: ReactNode; onMenu: () => void }) {
  const { me } = useSession();
  return (
    <header className="topbar">
      <button className="btn ghost icon show-sm" onClick={onMenu} aria-label="Open navigation"><MenuIcon /></button>
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={i} className="row" style={{ gap: 6, minWidth: 0 }}>
            {i > 0 && <ChevronRight aria-hidden />}
            {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span className="cur" aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>}
          </span>
        ))}
      </nav>
      <GlobalSearch />
      {actions}
      <span className={`env-tag ${me.env} hide-sm`} title={`Environment ${me.env}, ${me.runtime} runtime`}>{me.env === "production" ? "prod" : me.env} · {me.runtime}</span>
      <Notifications />
    </header>
  );
}

function Notifications() {
  const { notifs, seenAt, markRead, stream } = useLive();
  const nav = useNavigate();
  const fresh = notifs.filter((n) => new Date(n.ts).getTime() > seenAt).length;
  return (
    <Menu label="Notifications" trigger={(p) => (
      <button {...p} className="btn ghost icon" aria-label={`Notifications${fresh ? `, ${fresh} new` : ""}`} onClick={() => { p.onClick(); markRead(); }} style={{ position: "relative" }}>
        <Bell />
        {fresh > 0 && <span style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: 4, background: "var(--accent)" }} aria-hidden />}
      </button>
    )} items={notifs.length === 0
      ? [{ label: stream === "live" ? "No new activity this session" : "Connecting to live activity…", disabled: true }]
      : notifs.slice(0, 12).map((n) => ({
        label: `${n.kind === "approval" ? "Approval needed" : n.kind === "completed" ? "Completed" : "Failed"} — ${n.text.slice(0, 70)} · ${timeAgo(n.ts)}`,
        icon: n.kind === "approval" ? ShieldCheck : n.kind === "completed" ? ClipboardList : Activity,
        onSelect: () => nav(n.kind === "approval" ? "/approvals" : `/tasks/${n.taskId}`),
      }))} />
  );
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const debounced = useDebounced(q.trim(), 200);
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const agents = useQuery({ queryKey: ["search-agents", debounced], queryFn: ({ signal }) => api.get(`/api/agents?q=${encodeURIComponent(debounced)}&page_size=5`, signal), enabled: debounced.length > 1 });
  const tasks = useQuery({ queryKey: ["search-tasks", debounced], queryFn: ({ signal }) => api.get(`/api/tasks?q=${encodeURIComponent(debounced)}&page_size=6`, signal), enabled: debounced.length > 1 });
  const results = [
    ...(agents.data?.items ?? []).map((a: any) => ({ kind: "Agent", id: a.id, label: a.name, sub: a.category, to: `/agents/${a.id}`, a })),
    ...(tasks.data?.items ?? []).map((t: any) => ({ kind: "Task", id: t.id, label: t.title, sub: t.agent_name, to: `/tasks/${t.id}`, t })),
  ];
  useEffect(() => setHl(0), [debounced]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const go = (to: string) => { setOpen(false); setQ(""); input.current?.blur(); nav(to); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHl((h) => Math.min(h + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    if (e.key === "Enter" && results[hl]) { e.preventDefault(); go(results[hl].to); }
    if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
  };
  const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
  return (
    <div className="search" role="combobox" aria-expanded={open && debounced.length > 1} aria-haspopup="listbox" aria-owns="search-results">
      <Search aria-hidden />
      <input ref={input} type="search" placeholder="Search agents and tasks" value={q} aria-label="Search agents and tasks" aria-controls="search-results"
        aria-activedescendant={results[hl] ? `sr-${results[hl].id}` : undefined}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      <span className="kbd" aria-hidden>{isMac ? "⌘K" : "Ctrl K"}</span>
      {open && debounced.length > 1 && (
        <div className="search-pop" id="search-results" role="listbox">
          {(agents.isFetching || tasks.isFetching) && !results.length && <div className="tiny muted" style={{ padding: 8 }}>Searching…</div>}
          {!agents.isFetching && !tasks.isFetching && !results.length && <div className="tiny muted" style={{ padding: 8 }}>No agents or tasks match “{debounced}”.</div>}
          {results.map((r, i) => (
            <a key={r.id} id={`sr-${r.id}`} role="option" aria-selected={i === hl} href={r.to}
              onMouseDown={(e) => { e.preventDefault(); go(r.to); }} onMouseEnter={() => setHl(i)}>
              {r.kind === "Agent" ? <BotMark seed={r.a.id} avatar={r.a.avatar} size={20} /> : <ClipboardList size={16} className="muted" aria-hidden />}
              <span className="grow ellipsis">{r.label}</span>
              <span className="tiny muted">{r.kind} · {r.sub}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

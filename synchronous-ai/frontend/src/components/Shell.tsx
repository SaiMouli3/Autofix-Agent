import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Bell,
  Bot,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  Library,
  LogOut,
  Plug,
  Plus,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { BRAND } from "../brand";
import { api } from "../lib/api";
import { STATUS_LABEL, timeAgo } from "../lib/format";
import { useSession } from "../lib/session";
import { ActivityEvent, useActivityStream } from "../lib/stream";
import { AgentAvatar } from "./ui";

// ------------------------------------------------------------------ live activity store (unread + notifications)

interface Notif { id: number; agentId: string; taskId: string; text: string; ts: string; kind: string }
const LiveCtx = createContext<{ unread: Record<string, number>; notifs: Notif[]; markSeen: (agentId: string) => void; clear: () => void }>({
  unread: {}, notifs: [], markSeen: () => {}, clear: () => {},
});
export const useLive = () => useContext(LiveCtx);

export function Shell({ title, crumbs, actions, children }: { title?: string; crumbs?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar title={title} crumbs={crumbs} actions={actions} />
        <main className="content" id="main">
          <div className="content-inner">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const loc = useLocation();
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const path = useRef(loc.pathname);
  path.current = loc.pathname;
  const timer = useRef<number | null>(null);

  useActivityStream((e: ActivityEvent) => {
    // Coalesce cache invalidations so bursts of events do not hammer the API.
    if (timer.current === null) {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        qc.invalidateQueries({ queryKey: ["agents"] });
        qc.invalidateQueries({ queryKey: ["approvals-count"] });
        qc.invalidateQueries({ queryKey: ["overview"] });
      }, 800);
    }
    const terminal = e.type === "status" && ["completed", "failed", "timed_out"].includes(e.data?.status);
    const approval = e.type === "approval" && e.data?.status === "waiting_for_approval";
    if (terminal || approval) {
      const viewing = path.current.startsWith(`/agents/${e.agent_id}`);
      if (!viewing) setUnread((u) => ({ ...u, [e.agent_id]: (u[e.agent_id] ?? 0) + 1 }));
      setNotifs((n) => [{ id: e.id, agentId: e.agent_id, taskId: e.task_id, text: e.summary, ts: e.ts, kind: approval ? "approval" : e.data.status }, ...n].slice(0, 30));
    }
  });
  const markSeen = useCallback((agentId: string) => setUnread((u) => (u[agentId] ? { ...u, [agentId]: 0 } : u)), []);
  const clear = useCallback(() => setNotifs([]), []);
  const value = useMemo(() => ({ unread, notifs, markSeen, clear }), [unread, notifs, markSeen, clear]);
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

// ------------------------------------------------------------------ sidebar

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/agents", label: "My Agents", icon: Bot },
  { to: "/tasks", label: "Tasks", icon: ClipboardList },
  { to: "/workspaces", label: "Agent Workspaces", icon: FolderKanban },
  { to: "/integrations", label: "Integrations", icon: Plug },
  { to: "/knowledge", label: "Company Knowledge", icon: Library },
  { to: "/schedules", label: "Workflows & Schedules", icon: CalendarClock },
  { to: "/approvals", label: "Approvals", icon: ShieldCheck, badge: "approvals" },
  { to: "/monitoring", label: "Monitoring & Usage", icon: Activity },
  { to: "/audit", label: "Audit Logs", icon: ScrollText, perm: "audit:read" },
  { to: "/team", label: "Team Management", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

function Sidebar() {
  const { can } = useSession();
  const { unread } = useLive();
  const agents = useQuery({ queryKey: ["agents", "sidebar"], queryFn: () => api.get("/api/agents?page_size=200"), refetchInterval: 15000 });
  const approvals = useQuery({ queryKey: ["approvals-count"], queryFn: () => api.get("/api/approvals?status=pending&page_size=1"), refetchInterval: 20000 });
  const pending = approvals.data?.total ?? 0;
  return (
    <aside className="sidebar" aria-label="Primary">
      <Link to="/" className="brand" aria-label={BRAND.name}>
        <img src={BRAND.logo} alt="" />
        <div>
          <div className="brand-name">{BRAND.name}</div>
          <div className="brand-sub">{BRAND.tagline}</div>
        </div>
      </Link>
      <nav className="nav">
        {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
            <n.icon />
            <span>{n.label}</span>
            {n.badge === "approvals" && pending > 0 && <em className="nav-count" aria-label={`${pending} pending`}>{pending}</em>}
          </NavLink>
        ))}
      </nav>
      <div className="nav-section">
        <span>My Agents</span>
        {can("agents:write") && (
          <Link to="/agents/new" className="btn xs primary" title="Create agent" aria-label="Create agent">
            <Plus /> <span>New</span>
          </Link>
        )}
      </div>
      <div className="agent-list">
        {agents.isLoading && <div className="skeleton" style={{ height: 120 }} />}
        {agents.data?.items?.length === 0 && <div className="faint small" style={{ padding: "6px 10px" }}>No agents yet.</div>}
        {agents.data?.items?.map((a: any) => (
          <NavLink key={a.id} to={`/agents/${a.id}`} className={({ isActive }) => `agent-link ${isActive ? "active" : ""}`} title={`${a.name} — ${STATUS_LABEL[a.live_status] ?? a.live_status}`}>
            <AgentAvatar avatar={a.avatar} size="sm" status={a.live_status} />
            <div className="meta">
              <div className="name">{a.name}</div>
              <div className="sub">
                <span>{a.category}</span>·<span>{STATUS_LABEL[a.live_status] ?? a.live_status}</span>
                {(a.task_counts?.running ?? 0) > 0 && <span className="badge running" style={{ padding: "0 6px" }}>{a.task_counts.running} active</span>}
              </div>
            </div>
            {(unread[a.id] ?? 0) + (a.pending_approvals ?? 0) > 0 && (
              <span className="nav-count" style={{ display: "grid" }} aria-label="unread">{(unread[a.id] ?? 0) + (a.pending_approvals ?? 0)}</span>
            )}
          </NavLink>
        ))}
      </div>
      <div className="legal">Built on the OpenHands Software Agent SDK (MIT).</div>
    </aside>
  );
}

// ------------------------------------------------------------------ topbar

function Topbar({ title, crumbs, actions }: { title?: string; crumbs?: ReactNode; actions?: ReactNode }) {
  const { me } = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { notifs, clear } = useLive();
  const [menu, setMenu] = useState<"" | "user" | "notif">("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu("");
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const logout = async () => {
    await api.post("/api/auth/logout").catch(() => {});
    qc.clear();
    window.location.href = "/login";
  };
  const initials = me.user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <header className="topbar">
      <div>
        {crumbs && <div className="crumbs">{crumbs}</div>}
        {title && <div className="topbar-title">{title}</div>}
      </div>
      <GlobalSearch />
      {actions}
      <span className={`env-pill ${me.env}`} title={`Runtime: ${me.runtime}`}>{me.env} · {me.runtime}</span>
      <div className="row" ref={ref} style={{ position: "relative" }}>
        <button className="icon-btn" aria-label="Notifications" onClick={() => setMenu(menu === "notif" ? "" : "notif")}>
          <Bell />
          {notifs.length > 0 && <span className="dot-badge" />}
        </button>
        <button className="user-chip" onClick={() => setMenu(menu === "user" ? "" : "user")} aria-haspopup="menu">
          <span className="initials">{initials}</span>
          <span className="small" style={{ textAlign: "left", lineHeight: 1.2 }}>
            <div className="strong">{me.user.name}</div>
            <div className="faint tiny">{me.org.name}</div>
          </span>
          <ChevronDown size={14} />
        </button>
        {menu === "notif" && (
          <div className="menu" style={{ width: 360 }} role="menu">
            <div className="row between" style={{ padding: "4px 8px 8px" }}>
              <b className="small">Notifications</b>
              {notifs.length > 0 && <button className="btn xs ghost" onClick={clear}>Clear</button>}
            </div>
            {notifs.length === 0 && <div className="faint small" style={{ padding: 10 }}>Completions and approval requests appear here in real time.</div>}
            {notifs.map((n) => (
              <button key={n.id} className="menu-item" onClick={() => { setMenu(""); nav(n.kind === "approval" ? "/approvals" : `/tasks/${n.taskId}`); }}>
                <span className={`status-dot ${n.kind === "approval" ? "waiting_for_approval" : n.kind}`} />
                <span className="grow small">{n.text}<div className="faint tiny">{timeAgo(n.ts)}</div></span>
              </button>
            ))}
          </div>
        )}
        {menu === "user" && (
          <div className="menu" role="menu">
            <div style={{ padding: "6px 10px 8px" }}>
              <div className="strong">{me.user.name}</div>
              <div className="faint small">{me.user.email}</div>
              <div className="badge accent mt8">{me.role_label}</div>
            </div>
            <div className="menu-sep" />
            <button className="menu-item" onClick={() => { setMenu(""); nav("/settings?tab=account"); }}><KeyRound /> Account & password</button>
            <button className="menu-item" onClick={() => { setMenu(""); nav("/settings"); }}><Settings /> Organization settings</button>
            <div className="menu-sep" />
            <button className="menu-item" onClick={logout}><LogOut /> Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const nav = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const agents = useQuery({ queryKey: ["search-agents", debounced], queryFn: () => api.get(`/api/agents?q=${encodeURIComponent(debounced)}&page_size=5`), enabled: debounced.length > 1 });
  const tasks = useQuery({ queryKey: ["search-tasks", debounced], queryFn: () => api.get(`/api/tasks?q=${encodeURIComponent(debounced)}&page_size=6`), enabled: debounced.length > 1 });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const go = (path: string) => { setOpen(false); setQ(""); nav(path); };
  return (
    <div className="search" onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <Search />
      <input id="global-search" placeholder="Search agents and tasks  (Ctrl K)" value={q} aria-label="Global search"
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      {open && debounced.length > 1 && (
        <div className="search-results">
          {agents.data?.items?.map((a: any) => (
            <a key={a.id} onMouseDown={() => go(`/agents/${a.id}`)} href={`/agents/${a.id}`}>
              <AgentAvatar avatar={a.avatar} size="sm" /> <span className="grow">{a.name}</span><span className="faint tiny">Agent</span>
            </a>
          ))}
          {tasks.data?.items?.map((t: any) => (
            <a key={t.id} onMouseDown={() => go(`/tasks/${t.id}`)} href={`/tasks/${t.id}`}>
              <span className={`status-dot ${t.status}`} /> <span className="grow ellipsis">{t.title}</span><span className="faint tiny">{t.agent_name}</span>
            </a>
          ))}
          {!agents.data?.items?.length && !tasks.data?.items?.length && <div className="faint small" style={{ padding: 8 }}>No matches.</div>}
        </div>
      )}
    </div>
  );
}

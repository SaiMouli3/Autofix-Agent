import {
  AlertTriangle,
  BarChart3,
  Bot,
  Brain,
  Briefcase,
  CheckCircle2,
  Code2,
  FileText,
  Globe,
  Inbox,
  Info,
  Landmark,
  LifeBuoy,
  Megaphone,
  Search,
  Server,
  Settings,
  Shield,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { STATUS_LABEL } from "../lib/format";

export const AGENT_ICONS: Record<string, any> = {
  bot: Bot, search: Search, briefcase: Briefcase, "life-buoy": LifeBuoy, landmark: Landmark, settings: Settings,
  code: Code2, server: Server, "bar-chart": BarChart3, brain: Brain, shield: Shield, megaphone: Megaphone,
  "file-text": FileText, users: Users, globe: Globe,
};
export const AGENT_COLORS = ["#F97316", "#4F8DF7", "#10B981", "#A78BFA", "#F59E0B", "#22D3EE", "#EC4899", "#64748B"];

export function AgentAvatar({ avatar, size, status }: { avatar?: { icon?: string; color?: string }; size?: "sm" | "lg"; status?: string }) {
  const Icon = AGENT_ICONS[avatar?.icon ?? "bot"] ?? Bot;
  const color = avatar?.color ?? "#F97316";
  return (
    <div className={`avatar ${size ?? ""}`} style={{ background: `${color}22`, color }} aria-hidden>
      <Icon />
      {status && <span className={`corner status-dot ${status}`} />}
    </div>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`badge ${status}`}>
      <span className="dot" />
      {label ?? STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="row muted" style={{ padding: 24, justifyContent: "center" }} role="status">
      <span className="spinner" /> {label}
    </div>
  );
}

export function Empty({ icon: Icon = Inbox, title, children, action }: { icon?: any; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ error, title = "Something went wrong" }: { error: any; title?: string }) {
  if (!error) return null;
  const status = error?.status;
  if (status === 403)
    return (
      <div className="notice error" role="alert">
        <Shield /> <div><b>Permission denied.</b> Your role does not allow this action. {String(error.message ?? "")}</div>
      </div>
    );
  return (
    <div className="notice error" role="alert">
      <XCircle />
      <div>
        <b>{title}.</b> {String(error?.message ?? error)}
      </div>
    </div>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const Icon = kind === "warn" ? AlertTriangle : kind === "error" ? XCircle : kind === "ok" ? CheckCircle2 : Info;
  return (
    <div className={`notice ${kind}`}>
      <Icon />
      <div>{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; icon?: any; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={`tab ${value === t.key ? "active" : ""}`} onClick={() => onChange(t.key)}>
          {t.icon && <t.icon />}
          {t.label}
          {t.count ? <span className="count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    if (draft.trim()) {
      onChange([...value, draft.trim()]);
      setDraft("");
    }
  };
  return (
    <div className="list-input">
      {value.map((v, i) => (
        <div className="item" key={i}>
          <input value={v} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="btn ghost sm" aria-label="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <X />
          </button>
        </div>
      ))}
      <div className="item">
        <input value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn sm" onClick={add}>Add</button>
      </div>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span>
        {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <button className="btn xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <button className="btn xs" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

// ------------------------------------------------------------------ toasts

type Toast = { id: number; kind: "ok" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

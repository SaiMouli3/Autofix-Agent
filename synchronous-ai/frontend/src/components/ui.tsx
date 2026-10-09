import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Circle,
  Clock,
  Info,
  Lock,
  Minus,
  Pause,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import {
  Component,
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { statusOf, Sym } from "../lib/status";

// ------------------------------------------------------------------ status

export function Dots({ label = "Working" }: { label?: string }) {
  return (
    <span className="dots" role="img" aria-label={label}>
      <i /><i /><i />
    </span>
  );
}

function SymIcon({ sym }: { sym: Sym }) {
  switch (sym) {
    case "running": return <Dots />;
    case "check": return <Check />;
    case "x": return <X />;
    case "clock": return <Clock />;
    case "pause": return <Pause />;
    case "minus": return <Minus />;
    case "alert": return <AlertTriangle />;
    case "dot": return <Circle fill="currentColor" style={{ width: 8, height: 8 }} />;
    default: return <Circle style={{ width: 9, height: 9 }} />;
  }
}

export function Status({ status, label, quiet }: { status: string; label?: string; quiet?: boolean }) {
  const s = statusOf(status);
  return (
    <span className={`status ${s.tone}`}>
      <span className="sym" aria-hidden><SymIcon sym={s.sym} /></span>
      {quiet ? <span className="sr-only">{label ?? s.label}</span> : (label ?? s.label)}
    </span>
  );
}

export function Tag({ tone, children, mono, title }: { tone?: string; children: ReactNode; mono?: boolean; title?: string }) {
  return <span className={`tag ${tone ?? ""} ${mono ? "mono" : ""}`} title={title}>{children}</span>;
}

// ------------------------------------------------------------------ states

export function Empty({ icon: Icon = Info, title, children, action }: { icon?: any; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico"><Icon /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Alert({ kind = "info", children, actions }: { kind?: "info" | "warn" | "error" | "ok" | "neutral"; children: ReactNode; actions?: ReactNode }) {
  const Icon = kind === "warn" ? AlertTriangle : kind === "error" ? XCircle : kind === "ok" ? CheckCircle2 : Info;
  return (
    <div className={`alert ${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon />
      <div className="grow">{children}</div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, what = "this data" }: { error: any; onRetry?: () => void; what?: string }) {
  if (!error) return null;
  if (error?.status === 403)
    return (
      <Empty icon={Lock} title="You don't have access">
        Your role does not permit viewing {what}. Ask an organization administrator if you need access.
      </Empty>
    );
  if (error?.status === 404) return <Empty title="Not found">It may have been removed, or it belongs to another organization.</Empty>;
  return (
    <Alert kind="error" actions={onRetry && <button className="btn sm" onClick={onRetry}><RefreshCw /> Retry</button>}>
      <b>Couldn't load {what}.</b> {String(error?.message ?? error)}
    </Alert>
  );
}

export function InlineError({ error }: { error: any }) {
  if (!error) return null;
  const msg = error?.status === 403 ? "Your role does not permit this action." : String(error?.message ?? error);
  return <Alert kind="error">{msg}</Alert>;
}

export function Skeleton({ h = 14, w = "100%", style }: { h?: number; w?: number | string; style?: any }) {
  return <div className="skel" style={{ height: h, width: w, ...style }} aria-hidden />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="stack" style={{ padding: 16 }} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} h={18} w={`${90 - (i % 3) * 15}%`} />)}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

// ------------------------------------------------------------------ dialog

export function Dialog({ title, description, onClose, children, footer, size }: {
  title: string; description?: ReactNode; onClose: () => void; children?: ReactNode; footer?: ReactNode; size?: "wide" | "narrow";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close]), [href]");
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "Tab" && el) {
        const nodes = Array.from(el.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), input:not(:disabled), select, textarea, [tabindex='0']"));
        if (!nodes.length) return;
        const [a, b] = [nodes[0], nodes[nodes.length - 1]];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${size ?? ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="dialog-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="btn ghost icon sm" data-close onClick={onClose} aria-label="Close dialog"><X /></button>
        </div>
        {children && <div className="dialog-body">{children}</div>}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmOpts { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean; requireText?: string }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState("");
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => { setTyped(""); setState({ ...o, resolve }); }), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Dialog title={state.title} onClose={() => close(false)} size="narrow" footer={<>
          <button className="btn" onClick={() => close(false)}>Cancel</button>
          <button className={`btn ${state.danger ? "danger solid" : "dark"}`} disabled={!!state.requireText && typed !== state.requireText} onClick={() => close(true)}>
            {state.confirmLabel ?? "Confirm"}
          </button></>}>
          <div className="stack">
            {state.body && <div className="muted">{state.body}</div>}
            {state.requireText && (
              <label className="field">Type <code>{state.requireText}</code> to confirm
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </label>
            )}
          </div>
        </Dialog>
      )}
    </ConfirmCtx.Provider>
  );
}

// ------------------------------------------------------------------ menu

export interface MenuItem { label: string; icon?: any; onSelect?: () => void; danger?: boolean; disabled?: boolean; hint?: string; separator?: boolean }

export function Menu({ trigger, items, label, up }: { trigger: (p: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode; items: MenuItem[]; label: string; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const first = wrap.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
    const onDoc = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const nodes = Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); nodes[(i + 1) % nodes.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); nodes[(i - 1 + nodes.length) % nodes.length]?.focus(); }
    if (e.key === "Escape") { setOpen(false); }
  };
  return (
    <div className="menu-wrap" ref={wrap} onKeyDown={onKey}>
      {trigger({ onClick: () => setOpen(!open), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div className={`menu ${up ? "up" : ""}`} role="menu" aria-label={label}>
          {items.map((it, i) => it.separator ? <div key={i} className="menu-sep" role="separator" /> : (
            <button key={i} role="menuitem" className={it.danger ? "danger" : ""} aria-disabled={it.disabled || undefined} title={it.disabled ? it.hint : undefined}
              onClick={() => { if (it.disabled) return; setOpen(false); it.onSelect?.(); }}>
              {it.icon && <it.icon />}<span className="grow">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ tabs, pager, search, sort

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { key: T; label: string; icon?: any; count?: number | null }[]; value: T; onChange: (t: T) => void; label?: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className="tab" onClick={() => onChange(t.key)}>
          {t.icon && <t.icon aria-hidden />}{t.label}
          {t.count ? <span className="count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span className="num">{total === 0 ? "No results" : `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}`}</span>
      <div className="row">
        <button className="btn xs" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="num">Page {page} of {pages}</span>
        <button className="btn xs" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="search-field">
      <Search aria-hidden />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
    </div>
  );
}

export function SortHeader({ label, k, sort, order, onSort }: { label: string; k: string; sort: string; order: "asc" | "desc"; onSort: (k: string) => void }) {
  const active = sort === k;
  return (
    <th aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => onSort(k)}>
        {label}
        {active ? (order === "asc" ? <ArrowUp /> : <ArrowDown />) : <ChevronsUpDown style={{ opacity: 0.4 }} />}
      </button>
    </th>
  );
}

// ------------------------------------------------------------------ misc

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

export function ListInput({ value, onChange, placeholder, label }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; label: string }) {
  const [draft, setDraft] = useState("");
  const add = () => { if (draft.trim()) { onChange([...value, draft.trim()]); setDraft(""); } };
  return (
    <div className="stack tight">
      {value.map((v, i) => (
        <div className="row" key={i}>
          <input value={v} aria-label={`${label} ${i + 1}`} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="btn ghost icon sm" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><X /></button>
        </div>
      ))}
      <div className="row">
        <input value={draft} placeholder={placeholder} aria-label={`New ${label.toLowerCase()}`} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn sm" onClick={add} disabled={!draft.trim()}>Add</button>
      </div>
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
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "error" ? <XCircle /> : t.kind === "ok" ? <CheckCircle2 /> : <Info />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ------------------------------------------------------------------ error boundary

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div className="page">
          <Alert kind="error" actions={<button className="btn sm" onClick={() => this.setState({ error: null })}><RefreshCw /> Try again</button>}>
            <b>This view failed to render.</b> The rest of the application still works. If this repeats, reload the page.
          </Alert>
        </div>
      );
    return this.props.children;
  }
}

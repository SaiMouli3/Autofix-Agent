import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/format";

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  success: (title: string, description?: string, action?: ToastItem["action"]) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string, action?: ToastItem["action"]) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = ++seq;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 9000 : 5000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      success: (title, description, action) => push({ tone: "success", title, description, action }),
      error: (title, description) => push({ tone: "error", title, description }),
      info: (title, description, action) => push({ tone: "info", title, description, action }),
    }),
    [push],
  );
  const icon = { success: <CheckCircle2 size={16} className="text-success" />, error: <AlertCircle size={16} className="text-danger" />, info: <Info size={16} className="text-info" /> };
  return (
    <Ctx.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-toast flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite" aria-atomic="false">
          {items.map((t) => (
            <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={cn("pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3 shadow-lg animate-pop")}>
              <span className="mt-0.5">{icon[t.tone]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{t.title}</p>
                {t.description && <p className="mt-0.5 text-sm text-fg-2">{t.description}</p>}
                {t.action && (
                  <button
                    className="mt-1.5 text-sm font-medium text-primary hover:underline"
                    onClick={() => {
                      t.action!.onClick();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button className="rounded p-0.5 text-fg-3 hover:bg-subtle hover:text-fg" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast must be used inside ToastProvider");
  return v;
}

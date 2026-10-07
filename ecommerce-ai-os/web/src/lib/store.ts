import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type RangeKey = "today" | "yesterday" | "7d" | "30d" | "90d" | "custom";

interface AppState {
  range: RangeKey;
  from?: string;
  to?: string;
  storeId?: string;
  sidebarCollapsed: boolean;
  assistantOpen: boolean;
  commandOpen: boolean;
  pendingQuestion?: string;
  setRange: (r: RangeKey, from?: string, to?: string) => void;
  setStoreId: (id?: string) => void;
  toggleSidebar: () => void;
  setAssistantOpen: (open: boolean, question?: string) => void;
  consumeQuestion: () => string | undefined;
  setCommandOpen: (open: boolean) => void;
}

const safeStorage = createJSONStorage(() => {
  try {
    const k = "__eaos";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  }
});

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      range: "30d",
      sidebarCollapsed: false,
      assistantOpen: false,
      commandOpen: false,
      setRange: (range, from, to) => set({ range, from, to }),
      setStoreId: (storeId) => set({ storeId }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setAssistantOpen: (assistantOpen, question) => set({ assistantOpen, pendingQuestion: question }),
      consumeQuestion: () => {
        const q = get().pendingQuestion;
        if (q) set({ pendingQuestion: undefined });
        return q;
      },
      setCommandOpen: (commandOpen) => set({ commandOpen }),
    }),
    {
      name: "eaos-ui",
      storage: safeStorage,
      partialize: (s) => ({ range: s.range, from: s.from, to: s.to, storeId: s.storeId, sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);

/** Query-string params for the active date range. */
export function useRangeParams() {
  const range = useAppStore((s) => s.range);
  const from = useAppStore((s) => s.from);
  const to = useAppStore((s) => s.to);
  return range === "custom" ? { range, from, to } : { range };
}

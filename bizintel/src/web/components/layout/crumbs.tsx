import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface Crumb {
  label: string;
  to?: string;
}

const Ctx = createContext<{ crumbs: Crumb[]; set: (c: Crumb[]) => void }>({ crumbs: [], set: () => {} });

export function CrumbProvider({ children }: { children: ReactNode }) {
  const [crumbs, set] = useState<Crumb[]>([]);
  return <Ctx.Provider value={{ crumbs, set }}>{children}</Ctx.Provider>;
}

export const useCrumbState = () => useContext(Ctx).crumbs;

/** Pages declare their breadcrumb trail; the last crumb also becomes the document title. */
export function useCrumbs(crumbs: Crumb[], productName?: string) {
  const { set } = useContext(Ctx);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(JSON.parse(key));
    const last = (JSON.parse(key) as Crumb[]).at(-1)?.label;
    document.title = [last, productName].filter(Boolean).join(" · ");
  }, [key, set, productName]);
}

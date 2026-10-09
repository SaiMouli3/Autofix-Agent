import { createContext, useContext } from "react";

export interface Me {
  user: { id: string; email: string; name: string; must_change_password: boolean };
  org: { id: string; name: string; slug: string; settings: Record<string, any> };
  role: string;
  role_label: string;
  permissions: string[];
  env: string;
  runtime: string;
}

export const SessionContext = createContext<{ me: Me; can: (p: string) => boolean } | null>(null);

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("SessionContext missing");
  return ctx;
}

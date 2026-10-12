import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

function apply(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

function readLocal(): ThemePref | null {
  try {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "dark" || v === "system" ? v : null;
  } catch {
    return null;
  }
}

/** A viewer's own choice wins; otherwise the workspace default from branding settings applies. */
export function useTheme(workspaceDefault: ThemePref = "system") {
  const [local, setLocal] = useState<ThemePref | null>(readLocal);
  const effective = local ?? workspaceDefault;
  useEffect(() => apply(effective), [effective]);
  const set = (p: ThemePref) => {
    setLocal(p);
    try {
      localStorage.setItem("theme", p);
    } catch {
      /* storage unavailable; preference lasts for this session only */
    }
  };
  return [effective, set] as const;
}

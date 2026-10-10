/** Per-viewer UI preferences (convenience only; never security- or data-bearing). */
import { useCallback, useEffect, useState } from "react";

export function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`sca.${key}`);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback((v: T) => {
    setValue(v);
    try {
      localStorage.setItem(`sca.${key}`, JSON.stringify(v));
    } catch {
      /* storage unavailable: keep in memory */
    }
  }, [key]);
  return [value, set];
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}


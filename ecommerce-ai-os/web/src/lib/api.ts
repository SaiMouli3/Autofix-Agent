import { useAppStore } from "./store";

export class ApiError extends Error {
  status: number;
  code: string;
  hint?: string;
  constructor(status: number, code: string, message: string, hint?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function api<T>(path: string, opts: { method?: Method; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const storeId = useAppStore.getState().storeId;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (storeId) headers["X-Store-ID"] = storeId;
  const method = opts.method ?? "GET";
  // A sleeping API (e.g. a free Render instance) answers 502/503/504 for up to a minute while it
  // wakes. GETs are safe to repeat, so wait it out instead of failing the page.
  const retryDelaysMs = method === "GET" ? [2000, 4000, 8000, 16000, 20000] : [];
  let res: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        credentials: "same-origin",
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      if (attempt >= retryDelaysMs.length) {
        throw new ApiError(0, "network", "We couldn't reach the server.", "Check your connection — data will refresh automatically when it's back.");
      }
      res = undefined;
    }
    if (res && ![502, 503, 504].includes(res.status)) break;
    if (attempt >= retryDelaysMs.length) break;
    await sleep(retryDelaysMs[attempt], opts.signal);
  }
  if (!res) {
    throw new ApiError(0, "network", "We couldn't reach the server.", "Check your connection — data will refresh automatically when it's back.");
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; hint?: string } })?.error;
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}&reason=${err?.code ?? "expired"}`;
    }
    if ((res.status === 502 || res.status === 503 || res.status === 504) && !err) {
      throw new ApiError(res.status, "api_unavailable", "The analysis service isn't responding.", "It may be restarting. Try again in a few seconds.");
    }
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? "Something went wrong.", err?.hint);
  }
  return data as T;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
}

/** Build a query string from a params object, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

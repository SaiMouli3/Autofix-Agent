/** Thin fetch wrapper: same-origin cookies + CSRF header on mutations, typed JSON errors. */

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : formatDetail(detail));
    this.status = status;
    this.detail = detail;
  }
}

function formatDetail(detail: unknown): string {
  if (Array.isArray(detail)) {
    return detail
      .map((d: any) => (d?.loc ? `${d.loc.filter((x: any) => x !== "body").join(".")}: ${d.msg}` : String(d?.msg ?? d)))
      .join("; ");
  }
  if (detail && typeof detail === "object" && "message" in (detail as any)) return String((detail as any).message);
  return detail ? JSON.stringify(detail) : "Request failed";
}

function csrf(): string {
  const m = document.cookie.match(/(?:^|; )sca_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: { ...headers } };
  if (method !== "GET") (init.headers as Record<string, string>)["x-csrf-token"] = csrf();
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/auth/")) window.dispatchEvent(new Event("sca:unauthorized"));
    throw new ApiError(res.status, data?.detail ?? data ?? res.statusText);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, b?: unknown, h?: Record<string, string>) => request<T>("POST", p, b ?? {}, h),
  put: <T = any>(p: string, b?: unknown) => request<T>("PUT", p, b ?? {}),
  del: <T = any>(p: string) => request<T>("DELETE", p),
  upload: <T = any>(p: string, form: FormData) => request<T>("POST", p, form),
};

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  });
  const s = u.toString();
  return s ? `?${s}` : "";
}

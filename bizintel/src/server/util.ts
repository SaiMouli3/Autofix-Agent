import { randomUUID } from "node:crypto";

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
export const nowIso = () => new Date().toISOString();

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, "not_found", `${what} was not found.`);

export function maskSecret(secret: string | null): string | null {
  if (!secret) return null;
  if (secret.length <= 8) return "••••";
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/** Run async work over items with bounded concurrency. Stops scheduling when the signal aborts. */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>, signal?: AbortSignal) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length && !signal?.aborted) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

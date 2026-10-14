import { config } from "../config";
import { recordFailure, recordSuccess, type ProviderKey } from "./registry";

export class ProviderError extends Error {
  // The API error handler matches on name to answer 502 with the provider's message; Error
  // subclasses keep name "Error" unless set, which turned every provider failure into a 500.
  override name = "ProviderError";
  constructor(
    public provider: ProviderKey,
    message: string,
    public status: number | null = null,
  ) {
    super(message);
  }
  get rateLimited() {
    return this.status === 429;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function providerFetch(provider: ProviderKey, url: string, opts: RequestOptions = {}): Promise<Response> {
  const signals = [AbortSignal.timeout(opts.timeoutMs ?? 20_000)];
  if (opts.signal) signals.push(opts.signal);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { "User-Agent": config.userAgent, ...opts.headers },
      body: opts.body,
      signal: AbortSignal.any(signals),
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    const err = e as Error & { cause?: { code?: string } };
    const reason = err.name === "TimeoutError" ? "request timed out" : (err.cause?.code ?? err.message);
    recordFailure(provider, reason);
    throw new ProviderError(provider, `${provider}: ${reason}`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    recordFailure(provider, `HTTP ${res.status} ${text}`, res.status === 429);
    throw new ProviderError(provider, `${provider}: HTTP ${res.status}${text ? ` — ${text}` : ""}`, res.status);
  }
  recordSuccess(provider);
  return res;
}

export async function providerJson<T>(provider: ProviderKey, url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await providerFetch(provider, url, opts);
  return (await res.json()) as T;
}

/** Serializes calls so a provider is hit at most once per `intervalMs` (OSM public instance policy). */
export function rateLimiter(intervalMs: number) {
  let chain = Promise.resolve();
  let last = 0;
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const result = chain.then(async () => {
      const wait = last + intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    });
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

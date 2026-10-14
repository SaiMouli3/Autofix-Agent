import { config, llmConfigured } from "../config";
import { activeModel } from "../repo/workspace";
import { semaphore, sleep } from "../util";
import { ProviderError, providerJson } from "./http";

export { llmConfigured };

interface ChatResponse {
  choices: { message: { content: string | null }; finish_reason?: string }[];
}

/**
 * Calls an OpenAI-compatible chat-completions endpoint and parses a JSON object from the reply.
 * The caller is responsible for validating the shape of the returned object.
 */
// Searches and research jobs each fan out (2 search lanes × 3 research workers + 3 research jobs),
// so without a server-wide cap ~10 long generations hit the gateway at once and time out together.
const llmSlot = semaphore(Math.max(1, Number(process.env.LLM_CONCURRENCY ?? 4)));
const MAX_ATTEMPTS = 4;

/** Timeouts, network errors, malformed replies (status null), rate limits and gateway 5xx are worth retrying. */
// A reply cut off at max_tokens would be cut off again at the same cap, so it is not retried as transient.
const cutOff = (e: unknown) => e instanceof ProviderError && /cut off/.test(e.message);
const transient = (e: unknown) => e instanceof ProviderError && (e.status === null || e.status === 429 || e.status >= 500) && !cutOff(e);
const MAX_GROWN_TOKENS = 32_000;

export async function llmJson<T>(system: string, user: string, opts: { signal?: AbortSignal; maxTokens?: number } = {}): Promise<T> {
  let callOpts = opts;
  let grown = false;
  for (let attempt = 1; ; attempt++) {
    try {
      return await llmSlot(() => llmJsonOnce<T>(system, user, callOpts), opts.signal);
    } catch (e) {
      // Reasoning models spend hidden "thinking" tokens from the same max_tokens budget, so a reply can be
      // cut off after ~1/3 of its answer. Retry once with a larger cap; billing follows tokens actually used.
      const cap = callOpts.maxTokens ?? 1800;
      if (cutOff(e) && !grown && cap < MAX_GROWN_TOKENS && !opts.signal?.aborted) {
        grown = true;
        callOpts = { ...opts, maxTokens: Math.min(MAX_GROWN_TOKENS, Math.ceil(cap * 2.5)) };
        continue;
      }
      if (!transient(e) || attempt >= MAX_ATTEMPTS || opts.signal?.aborted) throw e;
      // Exponential backoff with jitter; rate limits start higher so the gateway's window can reset.
      const base = (e as ProviderError).status === 429 ? 5_000 : 2_000;
      await sleep(Math.min(30_000, base * 2 ** (attempt - 1)) * (0.75 + Math.random() * 0.5), opts.signal);
    }
  }
}

async function llmJsonOnce<T>(system: string, user: string, opts: { signal?: AbortSignal; maxTokens?: number }): Promise<T> {
  if (!llmConfigured()) throw new ProviderError("llm", "Language model is not configured (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL).");
  const url = `${config.llm.baseUrl!.replace(/\/$/, "")}/chat/completions`;
  // Optional parameters; some gateway routes reject them, so a rejected one is dropped and the call retried.
  const optional: Record<string, unknown> = {
    max_tokens: opts.maxTokens ?? 1800,
    response_format: { type: "json_object" },
    ...(config.llm.temperature != null ? { temperature: config.llm.temperature } : {}),
  };
  let data: ChatResponse | undefined;
  for (let attempt = 0; attempt < 3 && !data; attempt++) {
    try {
      data = await providerJson<ChatResponse>("llm", url, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.llm.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: activeModel(),
          ...optional,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        // Long generations (deep research asks for 8000 tokens) outlast a flat 90s on a busy gateway.
        timeoutMs: Math.max(90_000, (opts.maxTokens ?? 1800) * 30),
        signal: opts.signal,
      });
    } catch (e) {
      const rejected = e instanceof ProviderError && e.status === 400 ? Object.keys(optional).find((k) => e.message.includes(k)) : undefined;
      if (!rejected) throw e;
      delete optional[rejected];
    }
  }
  if (!data) throw new ProviderError("llm", "The model endpoint rejected the request parameters.");
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? "";
  try {
    return parseJsonObject<T>(content);
  } catch (e) {
    console.warn(`[llm] unparseable reply (finish_reason=${choice?.finish_reason}, ${content.length} chars): ${content.slice(0, 300)} … ${content.slice(-300)}`);
    if (choice?.finish_reason === "length") throw new ProviderError("llm", "The model reply was cut off at the token limit before it finished.");
    throw e;
  }
}

export function parseJsonObject<T>(content: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const raw = fenced ? fenced[1] : content;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ProviderError("llm", "Model reply did not contain a JSON object.");
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch {
    throw new ProviderError("llm", "Model reply contained malformed JSON.");
  }
}

export const llmModelName = () => (llmConfigured() ? activeModel() : null);

export interface LlmModel {
  id: string;
  /** USD per million tokens; null when the gateway publishes no price. */
  inputUsdPerM: number | null;
  outputUsdPerM: number | null;
  contextTokens: number | null;
}

interface GatewayModel {
  id: string;
  context_window_tokens?: number | null;
  supports_embeddings?: boolean | null;
  supports_image_generation?: boolean | null;
  pricing?: { input_nano_usd_per_million_tokens?: number | null; output_nano_usd_per_million_tokens?: number | null };
}

let modelCache: { at: number; models: LlmModel[] } | null = null;

/** Chat models from the gateway's /models list, cached for 10 minutes (the list is ~300 entries). */
export async function llmModels(): Promise<LlmModel[]> {
  if (modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache.models;
  if (!config.llm.baseUrl || !config.llm.apiKey) return [];
  const data = await providerJson<{ data: GatewayModel[] }>("llm", `${config.llm.baseUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${config.llm.apiKey}` },
  });
  const usd = (nano: number | null | undefined) => (nano == null ? null : nano / 1e9);
  const models = data.data
    .filter((m) => !m.supports_embeddings && !m.supports_image_generation)
    .map((m) => ({ id: m.id, inputUsdPerM: usd(m.pricing?.input_nano_usd_per_million_tokens), outputUsdPerM: usd(m.pricing?.output_nano_usd_per_million_tokens), contextTokens: m.context_window_tokens ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
  modelCache = { at: Date.now(), models };
  return models;
}

/**
 * Account balance. Experiential Labs serves it at <origin>/api/v1/credits; other OpenAI-compatible
 * gateways have no standard equivalent, so any failure means "unknown" rather than an error.
 */
export async function llmCredits(): Promise<{ totalUsd: number; usedUsd: number; remainingUsd: number } | null> {
  if (!config.llm.baseUrl || !config.llm.apiKey) return null;
  try {
    const res = await fetch(`${new URL(config.llm.baseUrl).origin}/api/v1/credits`, {
      headers: { Authorization: `Bearer ${config.llm.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const { data } = (await res.json()) as { data?: { total_credits?: number; total_usage?: number } };
    if (typeof data?.total_credits !== "number" || typeof data.total_usage !== "number") return null;
    return { totalUsd: data.total_credits, usedUsd: data.total_usage, remainingUsd: data.total_credits - data.total_usage };
  } catch {
    return null;
  }
}

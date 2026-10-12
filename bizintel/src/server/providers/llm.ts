import { config, llmConfigured } from "../config";
import { ProviderError, providerJson } from "./http";

export { llmConfigured };

interface ChatResponse {
  choices: { message: { content: string | null }; finish_reason?: string }[];
}

/**
 * Calls an OpenAI-compatible chat-completions endpoint and parses a JSON object from the reply.
 * The caller is responsible for validating the shape of the returned object.
 */
export async function llmJson<T>(system: string, user: string, opts: { signal?: AbortSignal; maxTokens?: number } = {}): Promise<T> {
  // Replies are occasionally cut short or malformed; one retry recovers most of these.
  try {
    return await llmJsonOnce<T>(system, user, opts);
  } catch (e) {
    if (!(e instanceof ProviderError) || e.status !== null || opts.signal?.aborted) throw e;
    return llmJsonOnce<T>(system, user, opts);
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
          model: config.llm.model,
          ...optional,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        timeoutMs: 90_000,
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

export const llmModelName = () => (llmConfigured() ? config.llm.model : null);

import { config, llmConfigured } from "../config";
import { ProviderError, providerJson } from "./http";

export { llmConfigured };

interface ChatResponse {
  choices: { message: { content: string | null } }[];
}

/**
 * Calls an OpenAI-compatible chat-completions endpoint and parses a JSON object from the reply.
 * The caller is responsible for validating the shape of the returned object.
 */
export async function llmJson<T>(system: string, user: string, opts: { signal?: AbortSignal; maxTokens?: number } = {}): Promise<T> {
  if (!llmConfigured()) throw new ProviderError("llm", "Language model is not configured (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL).");
  const url = `${config.llm.baseUrl!.replace(/\/$/, "")}/chat/completions`;
  const data = await providerJson<ChatResponse>("llm", url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.llm.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.llm.model,
      temperature: 0.1,
      max_tokens: opts.maxTokens ?? 1800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    timeoutMs: 90_000,
    signal: opts.signal,
  });
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseJsonObject<T>(content);
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

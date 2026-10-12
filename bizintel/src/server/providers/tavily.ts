import { config } from "../config";
import { ProviderError, providerJson } from "./http";

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

const BASE = "https://api.tavily.com";

function headers() {
  if (!config.tavilyApiKey) throw new ProviderError("tavily", "Tavily API key is not configured (TAVILY_API_KEY).");
  return { Authorization: `Bearer ${config.tavilyApiKey}`, "Content-Type": "application/json" };
}

export const tavilyConfigured = () => Boolean(config.tavilyApiKey);

export async function tavilySearch(
  query: string,
  opts: { maxResults?: number; includeDomains?: string[]; excludeDomains?: string[]; topic?: "general" | "news"; signal?: AbortSignal } = {},
): Promise<TavilyResult[]> {
  const data = await providerJson<{ results: TavilyResult[] }>("tavily", `${BASE}/search`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      query,
      max_results: opts.maxResults ?? 5,
      search_depth: "basic",
      topic: opts.topic ?? "general",
      include_domains: opts.includeDomains,
      exclude_domains: opts.excludeDomains,
    }),
    timeoutMs: 30_000,
    signal: opts.signal,
  });
  return data.results ?? [];
}

export interface TavilyExtracted {
  url: string;
  raw_content: string;
}

export async function tavilyExtract(urls: string[], signal?: AbortSignal): Promise<{ results: TavilyExtracted[]; failed: string[] }> {
  const data = await providerJson<{ results: TavilyExtracted[]; failed_results?: { url: string }[] }>("tavily", `${BASE}/extract`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ urls, extract_depth: "basic" }),
    timeoutMs: 45_000,
    signal,
  });
  return { results: data.results ?? [], failed: (data.failed_results ?? []).map((f) => f.url) };
}

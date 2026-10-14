import type { ProviderInfo, ProviderState } from "../../shared/types";
import { activeModel } from "../repo/workspace";
import { config, llmConfigured } from "../config";
import { get, run } from "../db";
import { maskSecret, nowIso } from "../util";

export type ProviderKey = "photon" | "locationiq" | "nominatim" | "overpass" | "tavily" | "llm" | "website_crawler";

interface ProviderMeta {
  name: string;
  purpose: string;
  requiresKey: boolean;
  docsUrl: string;
  testable: boolean;
  configured: () => boolean;
  key: () => string | null;
  detail?: () => string | null;
}

export const PROVIDERS: Record<ProviderKey, ProviderMeta> = {
  photon: {
    name: "Photon (OpenStreetMap)",
    purpose: "Location autocomplete",
    requiresKey: false,
    docsUrl: "https://photon.komoot.io",
    testable: true,
    configured: () => true,
    key: () => null,
  },
  locationiq: {
    name: "LocationIQ",
    purpose: "Location autocomplete fallback when Photon is unreachable",
    requiresKey: true,
    docsUrl: "https://locationiq.com/docs",
    testable: false,
    configured: () => Boolean(config.locationiqApiKey),
    key: () => config.locationiqApiKey,
    detail: () => (config.locationiqApiKey ? null : "Not set: when Photon fails, autocomplete falls back to the public Nominatim instance (1 request per second)."),
  },
  nominatim: {
    name: "Nominatim (OpenStreetMap)",
    purpose: "Geocoding and fallback business discovery",
    requiresKey: false,
    docsUrl: "https://operations.osmfoundation.org/policies/nominatim/",
    testable: true,
    configured: () => true,
    key: () => null,
    detail: () => "Public instance limited to 1 request per second. Fallback discovery has lower coverage than Overpass.",
  },
  overpass: {
    name: "Overpass API (OpenStreetMap)",
    purpose: "Radius-based business discovery",
    requiresKey: false,
    docsUrl: "https://wiki.openstreetmap.org/wiki/Overpass_API",
    testable: true,
    configured: () => config.overpassUrls.length > 0,
    key: () => null,
    detail: () => `${config.overpassUrls.length} endpoint(s) configured with automatic failover.`,
  },
  tavily: {
    name: "Tavily",
    purpose: "Official website lookup, third-party source research, page extraction fallback",
    requiresKey: true,
    docsUrl: "https://docs.tavily.com",
    testable: true,
    configured: () => Boolean(config.tavilyApiKey),
    key: () => config.tavilyApiKey,
  },
  llm: {
    name: config.llm.providerName,
    purpose: "Structured company summaries, evidence classification, opportunity analysis, outreach drafts",
    requiresKey: true,
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    testable: true,
    configured: llmConfigured,
    key: () => config.llm.apiKey,
    detail: () => (llmConfigured() ? `Model: ${activeModel()}` : "Set LLM_BASE_URL, LLM_API_KEY and LLM_MODEL (any OpenAI-compatible endpoint)."),
  },
  website_crawler: {
    name: "Website crawler",
    purpose: "Retrieves public pages from official company websites",
    requiresKey: false,
    docsUrl: "",
    testable: false,
    configured: () => true,
    key: () => null,
    detail: () => "Built-in. Respects robots.txt and fetches a bounded number of pages per company.",
  },
};

interface StatRow {
  request_count: number;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  rate_limited_until: string | null;
}

export function recordSuccess(provider: ProviderKey) {
  run(
    `INSERT INTO provider_stats (provider, request_count, last_success_at) VALUES (?, 1, ?)
     ON CONFLICT(provider) DO UPDATE SET request_count = request_count + 1, last_success_at = excluded.last_success_at`,
    [provider, nowIso()],
  );
}

export function recordFailure(provider: ProviderKey, message: string, rateLimited = false) {
  const until = rateLimited ? new Date(Date.now() + 5 * 60_000).toISOString() : null;
  run(
    `INSERT INTO provider_stats (provider, request_count, last_error, last_error_at, rate_limited_until) VALUES (?, 1, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET request_count = request_count + 1, last_error = excluded.last_error,
       last_error_at = excluded.last_error_at, rate_limited_until = COALESCE(excluded.rate_limited_until, rate_limited_until)`,
    [provider, message.slice(0, 500), nowIso(), until],
  );
}

export function providerInfo(key: ProviderKey): ProviderInfo {
  const meta = PROVIDERS[key];
  const stat = get<StatRow>(`SELECT * FROM provider_stats WHERE provider = ?`, [key]);
  const configured = meta.configured();
  let state: ProviderState = "not_tested";
  if (!configured) state = meta.requiresKey ? "missing_credentials" : "configuration_error";
  else if (stat?.rate_limited_until && stat.rate_limited_until > nowIso()) state = "rate_limited";
  else if (stat?.last_error_at && (!stat.last_success_at || stat.last_error_at > stat.last_success_at)) {
    state = /401|403|unauthori[sz]ed|invalid api key/i.test(stat.last_error ?? "") ? "configuration_error" : "unavailable";
  } else if (stat?.last_success_at) state = "connected";
  return {
    key,
    name: meta.name,
    purpose: meta.purpose,
    requiresKey: meta.requiresKey,
    configured,
    state,
    maskedKey: maskSecret(meta.key()),
    lastSuccessAt: stat?.last_success_at ?? null,
    lastError: stat?.last_error ?? null,
    lastErrorAt: stat?.last_error_at ?? null,
    requestCount: stat?.request_count ?? 0,
    docsUrl: meta.docsUrl,
    testable: meta.testable && configured,
    detail: meta.detail?.() ?? null,
  };
}

export const listProviders = () => (Object.keys(PROVIDERS) as ProviderKey[]).map(providerInfo);

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const env = process.env;

const dataDir = resolve(env.BIZINTEL_DATA_DIR ?? "data");
mkdirSync(resolve(dataDir, "exports"), { recursive: true });

export const config = {
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? "127.0.0.1",
  production: env.NODE_ENV === "production",
  dataDir,
  dbPath: resolve(dataDir, "bizintel.db"),
  exportDir: resolve(dataDir, "exports"),
  exportTtlDays: Number(env.EXPORT_TTL_DAYS ?? 7),
  /** Identifies this application to public data providers (required by OSM usage policies). */
  userAgent: env.BIZINTEL_USER_AGENT ?? "BizIntel/0.1 (business research platform)",
  contactEmail: env.BIZINTEL_CONTACT_EMAIL ?? null,
  tavilyApiKey: env.TAVILY_API_KEY ?? null,
  /** When both are set, every request except the health check requires HTTP Basic auth. */
  basicAuth: env.BASIC_AUTH_USER && env.BASIC_AUTH_PASSWORD ? { user: env.BASIC_AUTH_USER, password: env.BASIC_AUTH_PASSWORD } : null,
  llm: {
    /** Any OpenAI-compatible chat-completions endpoint. */
    baseUrl: env.LLM_BASE_URL ?? null,
    apiKey: env.LLM_API_KEY ?? null,
    model: env.LLM_MODEL ?? null,
    providerName: env.LLM_PROVIDER_NAME ?? "Language model",
    /** Unset by default: some model routes only accept their default temperature. */
    temperature: env.LLM_TEMPERATURE ? Number(env.LLM_TEMPERATURE) : null,
  },
  overpassUrls: (env.OVERPASS_URLS ??
    "https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  nominatimUrl: env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org",
  photonUrl: env.PHOTON_URL ?? "https://photon.komoot.io",
  /** Optional location-autocomplete fallback when Photon is unreachable (free key at locationiq.com). */
  locationiqApiKey: env.LOCATIONIQ_API_KEY ?? null,
  locationiqUrl: env.LOCATIONIQ_URL ?? "https://api.locationiq.com",
};

export const llmConfigured = () => Boolean(config.llm.baseUrl && config.llm.apiKey && config.llm.model);

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
  llm: {
    /** Any OpenAI-compatible chat-completions endpoint. */
    baseUrl: env.LLM_BASE_URL ?? null,
    apiKey: env.LLM_API_KEY ?? null,
    model: env.LLM_MODEL ?? null,
    providerName: env.LLM_PROVIDER_NAME ?? "Language model",
  },
  overpassUrls: (env.OVERPASS_URLS ??
    "https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  nominatimUrl: env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org",
  photonUrl: env.PHOTON_URL ?? "https://photon.komoot.io",
};

export const llmConfigured = () => Boolean(config.llm.baseUrl && config.llm.apiKey && config.llm.model);

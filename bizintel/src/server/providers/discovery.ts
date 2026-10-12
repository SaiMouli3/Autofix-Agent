import { classifyOsmTags, expandIndustries, type IndustryLeaf } from "../../shared/industries";
import { haversineMeters } from "../../shared/domain";
import { config } from "../config";
import { ProviderError, providerJson } from "./http";
import { nominatimLimit } from "./geocode";

export interface DiscoveredBusiness {
  provider: "osm";
  ref: string;
  name: string;
  lat: number;
  lon: number;
  industry: string | null;
  category: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  tags: Record<string, string>;
}

export interface DiscoveryRequest {
  lat: number;
  lon: number;
  radiusMeters: number;
  industries: string[];
  limit: number;
  countryCode: string | null;
  country: string | null;
  signal?: AbortSignal;
}

export interface DiscoveryResult {
  provider: string;
  businesses: DiscoveredBusiness[];
  warnings: string[];
  rawCount: number;
}

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function normalizeUrl(u: string | undefined): string | null {
  if (!u) return null;
  const first = u.split(/[;\s]/)[0].trim();
  if (!first) return null;
  const withScheme = /^https?:\/\//i.test(first) ? first : `https://${first}`;
  try {
    const url = new URL(withScheme);
    return url.toString();
  } catch {
    return null;
  }
}

function firstValue(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.split(";")[0].trim();
  return s || null;
}

export function fromOsmTags(ref: string, lat: number, lon: number, tags: Record<string, string>, req: Pick<DiscoveryRequest, "country" | "countryCode">): DiscoveredBusiness | null {
  const name = tags.name ?? tags.brand ?? tags.operator;
  if (!name) return null;
  const leaf = classifyOsmTags(tags);
  const primaryKey = ["amenity", "shop", "office", "craft", "healthcare", "tourism", "leisure", "industrial", "man_made"].find((k) => tags[k]);
  const categoryBase = primaryKey ? humanize(tags[primaryKey]) : null;
  const category = categoryBase && tags.cuisine ? `${categoryBase} · ${humanize(tags.cuisine.split(";")[0])}` : categoryBase;
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const city = tags["addr:city"] ?? null;
  const address = [street, city, tags["addr:state"], tags["addr:postcode"]].filter(Boolean).join(", ") || tags["addr:full"] || null;
  return {
    provider: "osm",
    ref,
    name,
    lat,
    lon,
    industry: leaf?.key ?? null,
    category,
    address,
    city,
    region: tags["addr:state"] ?? null,
    country: req.country,
    countryCode: tags["addr:country"]?.toUpperCase() ?? req.countryCode,
    website: normalizeUrl(tags.website ?? tags["contact:website"] ?? tags.url),
    phone: firstValue(tags.phone ?? tags["contact:phone"]),
    email: firstValue(tags.email ?? tags["contact:email"]),
    tags,
  };
}

export function buildOverpassQuery(leaves: IndustryLeaf[], lat: number, lon: number, radius: number, limit: number): string {
  const byKey = new Map<string, Set<string>>();
  for (const l of leaves) for (const [k, v] of l.osm) (byKey.get(k) ?? byKey.set(k, new Set()).get(k)!).add(v);
  const around = `(around:${Math.round(radius)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  const clauses = [...byKey.entries()].map(([k, vals]) => `  nwr["${k}"~"^(${[...vals].join("|")})$"]["name"]${around};`);
  return `[out:json][timeout:50];\n(\n${clauses.join("\n")}\n);\nout center tags qt ${limit};`;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function overpass(req: DiscoveryRequest, leaves: IndustryLeaf[]): Promise<DiscoveryResult> {
  const query = buildOverpassQuery(leaves, req.lat, req.lon, req.radiusMeters, Math.ceil(req.limit * 1.5));
  const errors: string[] = [];
  for (const endpoint of config.overpassUrls) {
    try {
      const data = await providerJson<{ elements: OverpassElement[]; remark?: string }>("overpass", endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: 60_000,
        signal: req.signal,
      });
      const businesses: DiscoveredBusiness[] = [];
      for (const el of data.elements) {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null || !el.tags) continue;
        const b = fromOsmTags(`${el.type}/${el.id}`, lat, lon, el.tags, req);
        if (b) businesses.push(b);
      }
      const warnings = data.remark ? [`Overpass: ${data.remark}`] : [];
      return { provider: `OpenStreetMap via Overpass (${new URL(endpoint).hostname})`, businesses, warnings, rawCount: data.elements.length };
    } catch (e) {
      if (req.signal?.aborted) throw e;
      errors.push((e as Error).message);
    }
  }
  throw new ProviderError("overpass", `All Overpass endpoints failed: ${errors.join(" | ")}`);
}

interface NominatimPlace {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  name: string;
  category: string;
  type: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
}

async function nominatimFallback(req: DiscoveryRequest, leaves: IndustryLeaf[]): Promise<DiscoveryResult> {
  const dLat = req.radiusMeters / 111_320;
  const dLon = req.radiusMeters / (111_320 * Math.cos((req.lat * Math.PI) / 180));
  const viewbox = [req.lon - dLon, req.lat + dLat, req.lon + dLon, req.lat - dLat].map((n) => n.toFixed(6)).join(",");
  // Bound the number of requests: the public instance allows one per second.
  const MAX_TERMS = 12;
  const terms = leaves.slice(0, MAX_TERMS);
  const warnings = ["Primary discovery provider (Overpass) was unavailable. Results come from Nominatim, which returns at most 50 places per category and has lower coverage."];
  if (leaves.length > MAX_TERMS) warnings.push(`Only the first ${MAX_TERMS} of ${leaves.length} selected categories were searched by the fallback provider.`);
  const out = new Map<string, DiscoveredBusiness>();
  let raw = 0;
  for (const leaf of terms) {
    if (req.signal?.aborted) break;
    const url = `${config.nominatimUrl}/search?format=jsonv2&q=${encodeURIComponent(leaf.term)}&viewbox=${viewbox}&bounded=1&extratags=1&addressdetails=1&limit=50`;
    let places: NominatimPlace[];
    try {
      places = await nominatimLimit(() => providerJson<NominatimPlace[]>("nominatim", url, { signal: req.signal, timeoutMs: 20_000 }));
    } catch (e) {
      if (req.signal?.aborted) throw e;
      warnings.push(`Nominatim search for "${leaf.term}" failed: ${(e as Error).message}`);
      continue;
    }
    raw += places.length;
    for (const p of places) {
      const lat = Number(p.lat);
      const lon = Number(p.lon);
      if (haversineMeters(req.lat, req.lon, lat, lon) > req.radiusMeters) continue;
      const a = p.address ?? {};
      const tags: Record<string, string> = {
        ...p.extratags,
        [p.category]: p.type,
        name: p.name,
        ...(a.house_number ? { "addr:housenumber": a.house_number } : {}),
        ...(a.road ? { "addr:street": a.road } : {}),
        ...((a.city ?? a.town ?? a.village) ? { "addr:city": (a.city ?? a.town ?? a.village)! } : {}),
        ...(a.state ? { "addr:state": a.state } : {}),
        ...(a.postcode ? { "addr:postcode": a.postcode } : {}),
        ...(a.country_code ? { "addr:country": a.country_code } : {}),
      };
      const b = fromOsmTags(`${p.osm_type}/${p.osm_id}`, lat, lon, tags, { country: a.country ?? req.country, countryCode: req.countryCode });
      if (b && !out.has(b.ref)) out.set(b.ref, { ...b, industry: b.industry ?? leaf.key });
    }
    if (out.size >= req.limit * 1.5) break;
  }
  return { provider: "OpenStreetMap via Nominatim (fallback)", businesses: [...out.values()], warnings, rawCount: raw };
}

export async function discoverBusinesses(req: DiscoveryRequest): Promise<DiscoveryResult> {
  const leaves = expandIndustries(req.industries);
  try {
    return await overpass(req, leaves);
  } catch (e) {
    if (req.signal?.aborted) throw e;
    const fallback = await nominatimFallback(req, leaves);
    fallback.warnings.unshift((e as Error).message);
    return fallback;
  }
}

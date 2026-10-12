import type { LocationSuggestion, ResolvedLocation } from "../../shared/types";
import { config } from "../config";
import { providerJson, rateLimiter } from "./http";

interface PhotonFeature {
  properties: {
    osm_type?: string;
    osm_id?: number;
    osm_value?: string;
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    district?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    extent?: [number, number, number, number]; // [minLon, maxLat, maxLon, minLat]
  };
  geometry: { coordinates: [number, number] };
}

const KIND_CONFIDENCE: Record<string, number> = {
  house: 0.95,
  street: 0.85,
  locality: 0.8,
  district: 0.85,
  city: 0.9,
  county: 0.75,
  state: 0.6,
  country: 0.5,
  other: 0.6,
};

function photonLabel(p: PhotonFeature["properties"]): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const primary = p.name ?? street ?? p.postcode;
  const parts = [primary, p.name && street ? street : null, p.postcode && p.postcode !== primary ? p.postcode : null, p.city !== primary ? p.city : null, p.state !== primary ? p.state : null, p.country !== primary ? p.country : null];
  return [...new Set(parts.filter(Boolean))].join(", ");
}

const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** Parse "lat, lon" input into a location without calling a provider. */
export function parseCoordinates(q: string): LocationSuggestion | null {
  const m = COORD_RE.exec(q);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    id: `coord:${lat},${lon}`,
    label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    lat,
    lon,
    country: null,
    countryCode: null,
    region: null,
    confidence: 1,
    kind: "coordinates",
    bbox: null,
  };
}

export async function autocomplete(q: string, signal?: AbortSignal): Promise<LocationSuggestion[]> {
  const coords = parseCoordinates(q);
  if (coords) {
    const rev = await reverse(coords.lat, coords.lon, signal).catch(() => null);
    return [rev ? { ...coords, country: rev.country, countryCode: rev.countryCode, region: rev.region, label: `${coords.label} — ${rev.label}` } : coords];
  }
  const url = `${config.photonUrl}/api/?q=${encodeURIComponent(q)}&limit=7&lang=en`;
  const data = await providerJson<{ features: PhotonFeature[] }>("photon", url, { signal, timeoutMs: 8000 });
  const seen = new Set<string>();
  const out: LocationSuggestion[] = [];
  data.features.forEach((f, i) => {
    const p = f.properties;
    const label = photonLabel(p);
    if (!label || seen.has(label)) return;
    seen.add(label);
    const [lon, lat] = f.geometry.coordinates;
    // Earlier results rank higher; confidence is a coarse signal used only to prompt for confirmation.
    const base = KIND_CONFIDENCE[p.type ?? "other"] ?? 0.6;
    out.push({
      id: `${p.osm_type ?? "x"}${p.osm_id ?? i}`,
      label,
      lat,
      lon,
      country: p.country ?? null,
      countryCode: p.countrycode?.toUpperCase() ?? null,
      region: p.state ?? null,
      confidence: Math.max(0.3, base - i * 0.08),
      kind: p.type ?? p.osm_value ?? "place",
      bbox: p.extent ? [p.extent[3], p.extent[1], p.extent[0], p.extent[2]] : null,
    });
  });
  return out;
}

const nominatimLimit = rateLimiter(1100);

interface NominatimReverse {
  display_name: string;
  address?: { country?: string; country_code?: string; state?: string; city?: string; town?: string; village?: string };
}

export async function reverse(lat: number, lon: number, signal?: AbortSignal): Promise<Omit<ResolvedLocation, "lat" | "lon" | "confidence" | "kind" | "bbox">> {
  const url = `${config.nominatimUrl}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
  const r = await nominatimLimit(() => providerJson<NominatimReverse>("nominatim", url, { signal, timeoutMs: 10_000 }));
  const a = r.address ?? {};
  return {
    label: [a.city ?? a.town ?? a.village, a.state, a.country].filter(Boolean).join(", ") || r.display_name,
    country: a.country ?? null,
    countryCode: a.country_code?.toUpperCase() ?? null,
    region: a.state ?? null,
  };
}

export { nominatimLimit };

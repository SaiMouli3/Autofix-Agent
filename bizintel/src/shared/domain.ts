import type {
  ContactVerification,
  DistanceUnit,
  EvidenceClass,
  QualificationConfig,
  ReportSectionKey,
  ResearchDepth,
  ResearchSettings,
  ResearchStatus,
  StageKey,
} from "./types";

export const METERS_PER_MILE = 1609.344;

export function toMeters(value: number, unit: DistanceUnit): number {
  return unit === "mi" ? value * METERS_PER_MILE : value * 1000;
}

export function fromMeters(meters: number, unit: DistanceUnit): number {
  return unit === "mi" ? meters / METERS_PER_MILE : meters / 1000;
}

/** Countries that conventionally use miles for road distances. */
const MILE_COUNTRIES = new Set(["US", "GB", "LR", "MM"]);

export function defaultUnitFor(countryCode: string | null | undefined): DistanceUnit {
  return countryCode && MILE_COUNTRIES.has(countryCode.toUpperCase()) ? "mi" : "km";
}

export function haversineMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export const STAGE_LABELS: Record<StageKey, string> = {
  resolve_location: "Resolving location",
  discover: "Discovering businesses",
  dedupe: "Removing duplicates",
  identify_websites: "Identifying official websites",
  enrich_contacts: "Enriching contact information",
  research: "Researching companies",
  analyze_opportunities: "Analyzing opportunities",
  prepare_results: "Preparing results",
};

export function stagesForDepth(depth: ResearchDepth): StageKey[] {
  const base: StageKey[] = ["resolve_location", "discover", "dedupe", "identify_websites"];
  if (depth === "fast") return [...base, "prepare_results"];
  return [...base, "enrich_contacts", "research", "analyze_opportunities", "prepare_results"];
}

export const DEPTH_INFO: Record<ResearchDepth, { label: string; summary: string; includes: string[]; tradeoff: string }> = {
  fast: {
    label: "Fast",
    summary: "Quick discovery and basic business details.",
    includes: ["Map-provider business listings", "Address, category and published website", "Published phone where listed"],
    tradeoff: "Fastest and lowest cost. No website visits or web-search calls.",
  },
  standard: {
    label: "Standard",
    summary: "Discovery, website inspection, public contact extraction and structured summaries.",
    includes: ["Everything in Fast", "Official website lookup when missing", "Crawl of key website pages", "Public contact extraction", "Structured company summary"],
    tradeoff: "Takes longer — each company's website is visited. Uses web-search and model calls within your configured limits.",
  },
  deep: {
    label: "Deep research",
    summary: "Broader website investigation, additional public sources and evidence-backed profiles.",
    includes: ["Everything in Standard", "More pages per website", "Third-party public source research", "Opportunity analysis with cited evidence"],
    tradeoff: "Slowest and highest cost. Best for short-listed companies rather than broad sweeps.",
  },
};

export const RESEARCH_STATUS_LABELS: Record<ResearchStatus, string> = {
  discovered: "Discovered",
  website_identified: "Website identified",
  enrichment_pending: "Enrichment pending",
  research_in_progress: "Research in progress",
  completed: "Completed",
  completed_with_warnings: "Completed with warnings",
  failed: "Failed",
};

export const EVIDENCE_LABELS: Record<EvidenceClass, string> = {
  verified_fact: "Verified fact",
  third_party: "Third-party report",
  inference: "Supported inference",
  hypothesis: "Hypothesis",
  unknown: "Unknown",
};

export const VERIFICATION_LABELS: Record<ContactVerification, string> = {
  official_website: "Published on official website",
  permitted_source: "Published by another source",
  provider_supplied: "Provider supplied",
  verified: "Verified",
  unverified: "Unverified",
  invalid: "Invalid",
};

export const REPORT_SECTIONS: { key: ReportSectionKey; title: string }[] = [
  { key: "executive_summary", title: "Executive summary" },
  { key: "overview", title: "Company overview" },
  { key: "products_services", title: "Products and services" },
  { key: "target_customers", title: "Target customers" },
  { key: "geography", title: "Geographic operations" },
  { key: "size_scale", title: "Company size and scale" },
  { key: "technology", title: "Publicly documented technology context" },
  { key: "announcements", title: "Relevant announcements" },
  { key: "opportunities", title: "Potential operational opportunities" },
  { key: "missing_information", title: "Missing information" },
];

export const SIZE_BANDS = ["1–10", "11–50", "51–200", "201–1,000", "1,000+"] as const;

export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  defaultDepth: "standard",
  maxPagesPerCompany: 6,
  crawlConcurrency: 4,
  maxBusinessesPerSearch: 150,
  defaultRadius: 5,
  defaultUnit: "auto",
  maxLlmCallsPerSearch: 40,
  maxWebSearchCallsPerSearch: 40,
  supportedCountries: [],
  defaultIndustries: [],
};

export const DEFAULT_QUALIFICATION: QualificationConfig = {
  criteria: [
    { key: "industry_fit", label: "Industry fit", weight: 25, enabled: true },
    { key: "size_fit", label: "Company-size fit", weight: 10, enabled: true },
    { key: "geo_fit", label: "Geographic fit", weight: 15, enabled: true },
    { key: "need_signals", label: "Evidence of relevant needs", weight: 20, enabled: true },
    { key: "contactability", label: "Contactability", weight: 20, enabled: true },
    { key: "research_confidence", label: "Research confidence", weight: 10, enabled: true },
  ],
  targetIndustries: [],
  targetSizes: [],
  targetCountries: [],
  needKeywords: [],
  offeringDescription: "",
  qualifiedThreshold: 60,
};

export function formatDistance(meters: number | null | undefined, unit: DistanceUnit): string {
  if (meters == null) return "—";
  const v = fromMeters(meters, unit);
  return `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString()} ${unit}`;
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Shared domain types used by both the API server and the web client.
// Keep these free of runtime dependencies.

export type DistanceUnit = "mi" | "km";
export type ResearchDepth = "fast" | "standard" | "deep";

export type SearchStatus = "queued" | "running" | "completed" | "completed_with_warnings" | "failed" | "cancelled";

export type StageKey =
  | "resolve_location"
  | "discover"
  | "dedupe"
  | "identify_websites"
  | "enrich_contacts"
  | "research"
  | "analyze_opportunities"
  | "prepare_results";

export type StageStatus = "pending" | "running" | "completed" | "skipped" | "failed";

export type ResearchStatus =
  | "discovered"
  | "website_identified"
  | "enrichment_pending"
  | "research_in_progress"
  | "completed"
  | "completed_with_warnings"
  | "failed";

export type QualificationStatus = "unreviewed" | "qualified" | "disqualified" | "needs_review";

export type EvidenceClass = "verified_fact" | "third_party" | "inference" | "hypothesis" | "unknown";

export type ContactType = "general" | "sales" | "support" | "department" | "person";

export type ContactVerification =
  | "official_website"
  | "permitted_source"
  | "provider_supplied"
  | "verified"
  | "unverified"
  | "invalid";

export interface ResolvedLocation {
  label: string;
  lat: number;
  lon: number;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  /** 0..1 — how confident the geocoder is that this is the intended place. */
  confidence: number;
  kind: string;
  /** Bounding box [south, north, west, east] when the geocoder supplies one. */
  bbox: [number, number, number, number] | null;
}

export interface LocationSuggestion extends ResolvedLocation {
  id: string;
}

export interface SearchCounters {
  discovered: number;
  unique: number;
  websites: number;
  contacts: number;
  researched: number;
  failed: number;
  skipped: number;
}

export interface SearchStage {
  key: StageKey;
  status: StageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  detail: string | null;
}

export interface ProviderIssue {
  provider: string;
  message: string;
  at: string;
}

export interface SearchRecord {
  id: string;
  name: string;
  location: ResolvedLocation;
  radiusMeters: number;
  unit: DistanceUnit;
  industries: string[];
  depth: ResearchDepth;
  maxBusinesses: number;
  status: SearchStatus;
  currentStage: StageKey | null;
  stages: SearchStage[];
  counters: SearchCounters;
  issues: ProviderIssue[];
  discoveryProvider: string | null;
  error: string | null;
  saved: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Live counts over this search's stored results (only on single-search reads). */
  resultSummary?: { withEmail: number; withPhone: number };
}

export interface CreateSearchInput {
  name?: string;
  location: ResolvedLocation;
  radius: number;
  unit: DistanceUnit;
  industries: string[];
  depth: ResearchDepth;
  maxBusinesses?: number;
}

export interface Business {
  id: string;
  name: string;
  category: string | null;
  industry: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number;
  lon: number;
  website: string | null;
  websiteSource: string | null;
  phone: string | null;
  phoneSource: string | null;
  email: string | null;
  emailSource: string | null;
  sizeEstimate: string | null;
  sizeEvidenceClass: EvidenceClass | null;
  researchStatus: ResearchStatus;
  opportunityScore: number | null;
  qualificationStatus: QualificationStatus;
  sourceProvider: string;
  sourceRef: string;
  tags: string[];
  saved: boolean;
  lastResearchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present when the business is listed in the context of a search. */
  distanceMeters?: number | null;
}

export type BusinessSortKey = "name" | "distance" | "industry" | "researchStatus" | "opportunityScore" | "updatedAt";

export interface BusinessQuery {
  searchId?: string;
  listId?: string;
  q?: string;
  industries?: string[];
  countryCode?: string;
  region?: string;
  hasEmail?: boolean;
  hasPhone?: boolean;
  hasWebsite?: boolean;
  researchStatus?: ResearchStatus[];
  minScore?: number;
  qualification?: QualificationStatus[];
  sort?: BusinessSortKey;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Contact {
  id: string;
  businessId: string;
  name: string | null;
  title: string | null;
  type: ContactType;
  email: string | null;
  phone: string | null;
  location: string | null;
  sourceUrl: string | null;
  sourceLabel: string;
  verification: ContactVerification;
  lastCheckedAt: string;
}

export type PageCategory =
  | "home"
  | "about"
  | "contact"
  | "services"
  | "products"
  | "team"
  | "locations"
  | "careers"
  | "case_studies"
  | "news"
  | "other";

export type PageRetrievalStatus = "pending" | "retrieved" | "failed" | "blocked" | "skipped";

export interface WebsitePage {
  id: string;
  businessId: string;
  url: string;
  title: string | null;
  category: PageCategory;
  status: PageRetrievalStatus;
  httpStatus: number | null;
  retrievedAt: string | null;
  extractedFields: string[];
  warnings: string[];
  summary: string | null;
  textLength: number;
}

export interface Evidence {
  id: string;
  businessId: string;
  section: ReportSectionKey;
  claim: string;
  classification: EvidenceClass;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceType: "official_website" | "third_party" | "map_provider" | "model_inference";
  excerpt: string | null;
  publishedAt: string | null;
  retrievedAt: string | null;
  reviewed: boolean;
}

export type ReportSectionKey =
  | "executive_summary"
  | "overview"
  | "products_services"
  | "target_customers"
  | "geography"
  | "size_scale"
  | "technology"
  | "announcements"
  | "opportunities"
  | "missing_information";

export interface ReportSection {
  key: ReportSectionKey;
  title: string;
  body: string | null;
  evidenceIds: string[];
}

export interface CompanyReport {
  businessId: string;
  generatedAt: string;
  depth: ResearchDepth;
  model: string | null;
  confidence: "high" | "medium" | "low";
  confidenceRationale: string;
  sections: ReportSection[];
  warnings: string[];
}

export interface ScoreComponent {
  key: string;
  label: string;
  weight: number;
  /** 0..1 */
  value: number;
  rationale: string;
}

export interface Opportunity {
  businessId: string;
  businessName: string;
  score: number;
  components: ScoreComponent[];
  summary: string | null;
  opportunity: string | null;
  evidenceIds: string[];
  gaps: string[];
  questions: string[];
  confidence: "high" | "medium" | "low";
  nextAction: string | null;
  qualificationStatus: QualificationStatus;
  overriddenBy: string | null;
  updatedAt: string;
}

export interface QualificationCriterion {
  key: "industry_fit" | "size_fit" | "geo_fit" | "need_signals" | "contactability" | "research_confidence";
  label: string;
  weight: number;
  enabled: boolean;
}

export interface QualificationConfig {
  criteria: QualificationCriterion[];
  targetIndustries: string[];
  targetSizes: string[];
  targetCountries: string[];
  /** Free-text keywords describing needs the client can serve; matched against research evidence. */
  needKeywords: string[];
  /** Client's own offering description, used for opportunity analysis and outreach drafting. */
  offeringDescription: string;
  qualifiedThreshold: number;
}

export interface SavedList {
  id: string;
  name: string;
  description: string | null;
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  businessId: string;
  body: string;
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  businessId: string | null;
  searchId: string | null;
  type: string;
  message: string;
  createdAt: string;
}

export interface OutreachDraft {
  id: string;
  businessId: string;
  contactId: string | null;
  subject: string;
  body: string;
  followUp: string;
  discoveryQuestion: string;
  evidenceIds: string[];
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ExportFormat = "csv" | "xlsx";
export type ExportScope =
  | { kind: "all" }
  | { kind: "search"; searchId: string }
  | { kind: "selected"; businessIds: string[] }
  | { kind: "list"; listId: string }
  | { kind: "qualified" }
  | { kind: "with_email" }
  | { kind: "with_phone" }
  | { kind: "researched" };

export type ExportInclude = "overview" | "contacts" | "website_research" | "sources" | "scores" | "opportunities" | "outreach";

export interface ExportRecord {
  id: string;
  name: string;
  format: ExportFormat;
  scope: ExportScope;
  columns: string[];
  include: ExportInclude[];
  status: "queued" | "running" | "completed" | "failed";
  recordCount: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
}

export interface CreateExportInput {
  name?: string;
  format: ExportFormat;
  scope: ExportScope;
  columns: string[];
  include: ExportInclude[];
}

export type ProviderState = "connected" | "missing_credentials" | "configuration_error" | "unavailable" | "rate_limited" | "not_tested";

export interface ProviderInfo {
  key: string;
  name: string;
  purpose: string;
  requiresKey: boolean;
  configured: boolean;
  state: ProviderState;
  maskedKey: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  requestCount: number;
  docsUrl: string;
  testable: boolean;
  detail: string | null;
}

export interface ResearchSettings {
  defaultDepth: ResearchDepth;
  maxPagesPerCompany: number;
  crawlConcurrency: number;
  maxBusinessesPerSearch: number;
  defaultRadius: number;
  defaultUnit: DistanceUnit | "auto";
  /** Max number of LLM-backed research calls per search. Caps cost. */
  maxLlmCallsPerSearch: number;
  /** Max number of paid web-search calls per search. Caps cost. */
  maxWebSearchCallsPerSearch: number;
  supportedCountries: string[];
  defaultIndustries: string[];
}

export interface Branding {
  productName: string;
  workspaceName: string;
  logoUrl: string | null;
  theme: "system" | "light" | "dark";
}

export interface WorkspaceConfig {
  branding: Branding;
  research: ResearchSettings;
  qualification: QualificationConfig;
}

export interface OverviewStats {
  businesses: number;
  researched: number;
  withEmail: number;
  withPhone: number;
  qualified: number;
  activeJobs: number;
}

export interface ResearchJob {
  id: string;
  businessId: string;
  businessName: string;
  depth: ResearchDepth;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface GlobalSearchResult {
  businesses: Pick<Business, "id" | "name" | "category" | "city" | "website">[];
  lists: Pick<SavedList, "id" | "name" | "count">[];
  searches: Pick<SearchRecord, "id" | "name" | "status">[];
  reports: { businessId: string; businessName: string; generatedAt: string }[];
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

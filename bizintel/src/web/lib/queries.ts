import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ActivityEvent,
  Business,
  BusinessQuery,
  CompanyReport,
  Contact,
  CreateExportInput,
  CreateSearchInput,
  Evidence,
  ExportRecord,
  IndustryGroupDTO,
  Note,
  Opportunity,
  OutreachDraft,
  Page,
  ProviderInfo,
  ResearchDepth,
  ResearchJob,
  SavedList,
  SearchRecord,
  WebsitePage,
  WorkspaceConfig,
  OverviewStats,
  GlobalSearchResult,
  LocationSuggestion,
  QualificationStatus,
} from "./types";
import { api, qs } from "./api";

export const keys = {
  meta: ["meta"] as const,
  overview: ["overview"] as const,
  config: ["config"] as const,
  providers: ["providers"] as const,
  searches: ["searches"] as const,
  search: (id: string) => ["searches", id] as const,
  businesses: (q: BusinessQuery) => ["businesses", q] as const,
  business: (id: string) => ["business", id] as const,
  lists: ["lists"] as const,
  exports: ["exports"] as const,
  jobs: ["jobs"] as const,
  opportunities: ["opportunities"] as const,
  drafts: ["drafts"] as const,
};

export interface Meta {
  industries: IndustryGroupDTO[];
  sizeBands: string[];
  exportColumns: { key: string; label: string }[];
}

export const useMeta = () => useQuery({ queryKey: keys.meta, queryFn: () => api.get<Meta>("/meta"), staleTime: Infinity });
export const useConfig = () => useQuery({ queryKey: keys.config, queryFn: () => api.get<WorkspaceConfig>("/config"), staleTime: 60_000 });
export const useProviders = () => useQuery({ queryKey: keys.providers, queryFn: () => api.get<ProviderInfo[]>("/providers") });

export interface OverviewData {
  stats: OverviewStats;
  recentSearches: SearchRecord[];
  activeResearch: ResearchJob[];
  recentlyResearched: Business[];
  recentBusinesses: Business[];
  recentReports: { businessId: string; businessName: string; generatedAt: string }[];
  lists: SavedList[];
  exports: ExportRecord[];
  providers: ProviderInfo[];
}

export const useOverview = () =>
  useQuery({
    queryKey: keys.overview,
    queryFn: () => api.get<OverviewData>("/overview"),
    refetchInterval: (q) => ((q.state.data?.stats.activeJobs ?? 0) > 0 ? 4000 : false),
  });

export const useGlobalSearch = (q: string) =>
  useQuery({ queryKey: ["global-search", q], queryFn: ({ signal }) => api.get<GlobalSearchResult>(`/search${qs({ q })}`, signal), enabled: q.trim().length >= 1, placeholderData: keepPreviousData });

export const useGeocode = (q: string) =>
  useQuery({
    queryKey: ["geocode", q],
    queryFn: ({ signal }) => api.get<{ items: LocationSuggestion[] }>(`/geocode${qs({ q })}`, signal),
    enabled: q.trim().length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });

export const useSearches = (limit = 50, offset = 0) =>
  useQuery({
    queryKey: [...keys.searches, limit, offset],
    queryFn: () => api.get<{ items: SearchRecord[]; total: number }>(`/searches${qs({ limit, offset })}`),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((s) => s.status === "running" || s.status === "queued") ? 4000 : false),
  });

export const isActive = (s?: { status: string } | null) => s?.status === "running" || s?.status === "queued";

export const useSearch = (id: string) =>
  useQuery({ queryKey: keys.search(id), queryFn: () => api.get<SearchRecord>(`/searches/${id}`), refetchInterval: (q) => (isActive(q.state.data) ? 2000 : false) });

export function businessQs(q: BusinessQuery) {
  return qs({ ...q, industries: q.industries, researchStatus: q.researchStatus, qualification: q.qualification } as never);
}

export const useBusinesses = (q: BusinessQuery, opts: { poll?: boolean } = {}) =>
  useQuery({
    queryKey: keys.businesses(q),
    queryFn: ({ signal }) => api.get<Page<Business>>(`/businesses${businessQs(q)}`, signal),
    placeholderData: keepPreviousData,
    refetchInterval: opts.poll ? 3000 : false,
  });

export interface BusinessDetail {
  business: Business;
  searchId: string | null;
  lists: SavedList[];
  activeJob: ResearchJob | null;
}

export const useBusiness = (id: string) =>
  useQuery({ queryKey: keys.business(id), queryFn: () => api.get<BusinessDetail>(`/businesses/${id}`), refetchInterval: (q) => (q.state.data?.activeJob ? 3000 : false) });

const useSub = <T,>(id: string, path: string, poll = false) =>
  useQuery({ queryKey: [...keys.business(id), path], queryFn: () => api.get<T>(`/businesses/${id}/${path}`), refetchInterval: poll ? 3000 : false });

export const useContacts = (id: string, poll?: boolean) => useSub<Contact[]>(id, "contacts", poll);
export const usePages = (id: string, poll?: boolean) => useSub<WebsitePage[]>(id, "pages", poll);
export const useEvidence = (id: string, poll?: boolean) => useSub<Evidence[]>(id, "evidence", poll);
export const useReport = (id: string, poll?: boolean) => useSub<{ report: CompanyReport | null }>(id, "report", poll);
export const useOpportunity = (id: string, poll?: boolean) => useSub<{ opportunity: Opportunity | null }>(id, "opportunity", poll);
export const useActivity = (id: string) => useSub<ActivityEvent[]>(id, "activity");
export const useNotes = (id: string) => useSub<Note[]>(id, "notes");

export const usePageText = (pageId: string | null) =>
  useQuery({ queryKey: ["page", pageId], queryFn: () => api.get<{ page: WebsitePage; text: string | null }>(`/pages/${pageId}`), enabled: Boolean(pageId) });

export const useLists = () => useQuery({ queryKey: keys.lists, queryFn: () => api.get<SavedList[]>("/lists") });
export const useList = (id: string) => useQuery({ queryKey: [...keys.lists, id], queryFn: () => api.get<SavedList>(`/lists/${id}`) });

export const useExports = () =>
  useQuery({ queryKey: keys.exports, queryFn: () => api.get<ExportRecord[]>("/exports"), refetchInterval: (q) => (q.state.data?.some((e) => e.status === "queued" || e.status === "running") ? 2000 : false) });

export const useJobs = (opts: { active?: boolean; limit?: number } = {}) =>
  useQuery({
    queryKey: [...keys.jobs, opts],
    queryFn: () => api.get<ResearchJob[]>(`/research/jobs${qs(opts)}`),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === "queued" || j.status === "running") ? 3000 : false),
  });

export const useOpportunities = (q: { minScore?: number; status?: QualificationStatus; page: number; pageSize: number }) =>
  useQuery({ queryKey: [...keys.opportunities, q], queryFn: () => api.get<Page<Opportunity>>(`/opportunities${qs(q)}`), placeholderData: keepPreviousData });

export const useDrafts = (businessId?: string) => useQuery({ queryKey: [...keys.drafts, businessId ?? "all"], queryFn: () => api.get<OutreachDraft[]>(`/outreach/drafts${qs({ businessId })}`) });
export const useDraft = (id: string) => useQuery({ queryKey: [...keys.drafts, "one", id], queryFn: () => api.get<OutreachDraft>(`/outreach/drafts/${id}`) });

// ── Mutations ──────────────────────────────────────────────────────────────

export function useInvalidate() {
  const qc = useQueryClient();
  return (...prefixes: (readonly unknown[])[]) => Promise.all(prefixes.map((p) => qc.invalidateQueries({ queryKey: p })));
}

export const useCreateSearch = () => useMutation({ mutationFn: (input: CreateSearchInput) => api.post<SearchRecord>("/searches", input) });

export function useQueueResearch() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (v: { businessIds: string[]; depth: ResearchDepth }) => api.post<{ queued: string[]; skipped: number }>("/research", v),
    onSuccess: () => inv(["businesses"], ["business"], keys.jobs, keys.overview),
  });
}

export function useCreateExport() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (v: CreateExportInput) => api.post<ExportRecord>("/exports", v), onSuccess: () => inv(keys.exports, keys.overview) });
}

export function useAddToList() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (v: { listId: string; businessIds: string[] }) => api.post<{ added: number; alreadyPresent: number }>(`/lists/${v.listId}/members`, { businessIds: v.businessIds }),
    onSuccess: () => inv(keys.lists, ["business"], ["businesses"]),
  });
}

export function useCreateList() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (v: { name: string; description?: string | null }) => api.post<SavedList>("/lists", v), onSuccess: () => inv(keys.lists) });
}

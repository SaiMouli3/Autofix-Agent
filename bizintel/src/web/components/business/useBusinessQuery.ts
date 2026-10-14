import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { BusinessQuery, BusinessSortKey, QualificationStatus, ResearchStatus } from "@/lib/types";

const list = (v: string | null) => (v ? v.split(",").filter(Boolean) : undefined);
const tri = (v: string | null) => (v === "true" ? true : v === "false" ? false : undefined);

/** Business table state lives in the URL so views are shareable and survive reloads. */
export function useBusinessQuery(fixed: Partial<BusinessQuery> = {}, defaults: Partial<BusinessQuery> = {}) {
  const [params, setParams] = useSearchParams();
  const fixedKey = JSON.stringify(fixed);
  const query = useMemo<BusinessQuery>(() => {
    const q: BusinessQuery = {
      ...defaults,
      q: params.get("q") ?? undefined,
      industries: list(params.get("industries")),
      countryCode: params.get("country") ?? undefined,
      region: params.get("region") ?? undefined,
      hasEmail: tri(params.get("email")),
      hasPhone: tri(params.get("phone")),
      hasWebsite: tri(params.get("website")),
      researchStatus: list(params.get("status")) as ResearchStatus[] | undefined,
      qualification: list(params.get("qual")) as QualificationStatus[] | undefined,
      minScore: params.get("minScore") ? Number(params.get("minScore")) : undefined,
      sort: (params.get("sort") as BusinessSortKey | null) ?? defaults.sort,
      dir: (params.get("dir") as "asc" | "desc" | null) ?? defaults.dir,
      page: Number(params.get("page") ?? 1),
      pageSize: Number(params.get("size") ?? defaults.pageSize ?? 50),
      ...(JSON.parse(fixedKey) as Partial<BusinessQuery>),
    };
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, fixedKey]);

  const update = (patch: Record<string, string | number | boolean | string[] | undefined | null>, resetPage = true) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) next.delete(k);
          else next.set(k, Array.isArray(v) ? v.join(",") : String(v));
        }
        if (resetPage && !("page" in patch)) next.delete("page");
        return next;
      },
      { replace: true },
    );
  };

  const activeFilterCount = ["industries", "country", "region", "email", "phone", "website", "status", "qual", "minScore"].filter((k) => params.get(k)).length;
  const clearFilters = () => update({ industries: null, country: null, region: null, email: null, phone: null, website: null, status: null, qual: null, minScore: null, q: null });

  return { query, update, activeFilterCount, clearFilters };
}

import type { SQLInputValue } from "../db";
import { expandIndustries } from "../../shared/industries";
import type { Business, BusinessQuery, Page, QualificationStatus, ResearchStatus } from "../../shared/types";
import { all, get, run } from "../db";
import type { DiscoveredBusiness } from "../providers/discovery";
import { newId, notFound, nowIso, parseJson } from "../util";

export interface BusinessRow {
  id: string;
  source_provider: string;
  source_ref: string;
  name: string;
  category: string | null;
  industry: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  lat: number;
  lon: number;
  website: string | null;
  website_source: string | null;
  phone: string | null;
  phone_source: string | null;
  email: string | null;
  email_source: string | null;
  size_estimate: string | null;
  size_evidence_class: string | null;
  research_status: string;
  opportunity_score: number | null;
  qualification_status: string;
  tags: string;
  saved: number;
  last_researched_at: string | null;
  created_at: string;
  updated_at: string;
  distance_m?: number | null;
}

export function toBusiness(r: BusinessRow): Business {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    industry: r.industry,
    address: r.address,
    city: r.city,
    region: r.region,
    country: r.country,
    countryCode: r.country_code,
    lat: r.lat,
    lon: r.lon,
    website: r.website,
    websiteSource: r.website_source,
    phone: r.phone,
    phoneSource: r.phone_source,
    email: r.email,
    emailSource: r.email_source,
    sizeEstimate: r.size_estimate,
    sizeEvidenceClass: r.size_evidence_class as Business["sizeEvidenceClass"],
    researchStatus: r.research_status as ResearchStatus,
    opportunityScore: r.opportunity_score,
    qualificationStatus: r.qualification_status as QualificationStatus,
    sourceProvider: r.source_provider,
    sourceRef: r.source_ref,
    tags: parseJson<string[]>(r.tags, []),
    saved: r.saved === 1,
    lastResearchedAt: r.last_researched_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.distance_m !== undefined ? { distanceMeters: r.distance_m } : {}),
  };
}

export function getBusinessRow(id: string): BusinessRow {
  const row = get<BusinessRow>(`SELECT * FROM businesses WHERE id = ?`, [id]);
  if (!row) throw notFound("Business");
  return row;
}

export const getBusiness = (id: string) => toBusiness(getBusinessRow(id));

/** Insert or refresh a business discovered by a provider. Never overwrites enriched values with nulls. */
export function upsertDiscovered(d: DiscoveredBusiness): { id: string; created: boolean } {
  const existing = get<{ id: string }>(`SELECT id FROM businesses WHERE source_provider = ? AND source_ref = ?`, [d.provider, d.ref]);
  const now = nowIso();
  if (existing) {
    run(
      `UPDATE businesses SET name=?, category=COALESCE(?, category), industry=COALESCE(?, industry), address=COALESCE(?, address),
        city=COALESCE(?, city), region=COALESCE(?, region), country=COALESCE(?, country), country_code=COALESCE(?, country_code),
        lat=?, lon=?, website=COALESCE(website, ?), website_source=COALESCE(website_source, CASE WHEN ? IS NOT NULL THEN 'Map listing (OpenStreetMap)' END),
        phone=COALESCE(phone, ?), phone_source=COALESCE(phone_source, CASE WHEN ? IS NOT NULL THEN 'Map listing (OpenStreetMap)' END),
        email=COALESCE(email, ?), email_source=COALESCE(email_source, CASE WHEN ? IS NOT NULL THEN 'Map listing (OpenStreetMap)' END),
        raw=?, updated_at=? WHERE id=?`,
      [d.name, d.category, d.industry, d.address, d.city, d.region, d.country, d.countryCode, d.lat, d.lon, d.website, d.website, d.phone, d.phone, d.email, d.email, JSON.stringify(d.tags), now, existing.id],
    );
    return { id: existing.id, created: false };
  }
  const id = newId("biz");
  const src = "Map listing (OpenStreetMap)";
  run(
    `INSERT INTO businesses (id, source_provider, source_ref, name, category, industry, address, city, region, country, country_code, lat, lon,
      website, website_source, phone, phone_source, email, email_source, research_status, raw, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, d.provider, d.ref, d.name, d.category, d.industry, d.address, d.city, d.region, d.country, d.countryCode, d.lat, d.lon,
      d.website, d.website ? src : null, d.phone, d.phone ? src : null, d.email, d.email ? src : null,
      d.website ? "website_identified" : "discovered", JSON.stringify(d.tags), now, now,
    ],
  );
  return { id, created: true };
}

export function updateBusiness(id: string, patch: Partial<Record<keyof BusinessRow, SQLInputValue>>) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  run(`UPDATE businesses SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...keys.map((k) => patch[k as keyof BusinessRow]!), nowIso(), id]);
}

const SORTS: Record<string, string> = {
  name: "b.name COLLATE NOCASE",
  distance: "distance_m",
  industry: "b.industry",
  researchStatus: "b.research_status",
  opportunityScore: "b.opportunity_score",
  updatedAt: "b.updated_at",
};

export function buildBusinessFilter(q: BusinessQuery): { from: string; where: string; params: SQLInputValue[]; distance: string } {
  const params: SQLInputValue[] = [];
  const where: string[] = [];
  let from = "businesses b";
  let distance = "NULL";
  if (q.searchId) {
    from = "businesses b JOIN search_results sr ON sr.business_id = b.id AND sr.search_id = ?";
    params.push(q.searchId);
    distance = "sr.distance_m";
  }
  if (q.listId) {
    from += " JOIN list_members lm ON lm.business_id = b.id AND lm.list_id = ?";
    params.push(q.listId);
  }
  if (q.q) {
    where.push("(b.name LIKE ? OR b.website LIKE ? OR b.city LIKE ? OR b.category LIKE ?)");
    const like = `%${q.q}%`;
    params.push(like, like, like, like);
  }
  if (q.industries?.length) {
    const leaves = expandIndustries(q.industries).map((l) => l.key);
    where.push(`b.industry IN (${leaves.map(() => "?").join(",")})`);
    params.push(...leaves);
  }
  if (q.countryCode) {
    where.push("b.country_code = ?");
    params.push(q.countryCode.toUpperCase());
  }
  if (q.region) {
    where.push("b.region LIKE ?");
    params.push(`%${q.region}%`);
  }
  if (q.hasEmail !== undefined) where.push(q.hasEmail ? "(b.email IS NOT NULL OR EXISTS (SELECT 1 FROM contacts c WHERE c.business_id=b.id AND c.email IS NOT NULL))" : "(b.email IS NULL AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.business_id=b.id AND c.email IS NOT NULL))");
  if (q.hasPhone !== undefined) where.push(q.hasPhone ? "b.phone IS NOT NULL" : "b.phone IS NULL");
  if (q.hasWebsite !== undefined) where.push(q.hasWebsite ? "b.website IS NOT NULL" : "b.website IS NULL");
  if (q.researchStatus?.length) {
    where.push(`b.research_status IN (${q.researchStatus.map(() => "?").join(",")})`);
    params.push(...q.researchStatus);
  }
  if (q.qualification?.length) {
    where.push(`b.qualification_status IN (${q.qualification.map(() => "?").join(",")})`);
    params.push(...q.qualification);
  }
  if (q.minScore !== undefined) {
    where.push("b.opportunity_score >= ?");
    params.push(q.minScore);
  }
  return { from, where: where.length ? `WHERE ${where.join(" AND ")}` : "", params, distance };
}

export function queryBusinesses(q: BusinessQuery): Page<Business> {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
  const f = buildBusinessFilter(q);
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${f.from} ${f.where}`, f.params)?.n ?? 0;
  const sortCol = SORTS[q.sort ?? (q.searchId ? "distance" : "updatedAt")] ?? SORTS.updatedAt;
  const dir = (q.dir ?? (q.sort ? "asc" : q.searchId ? "asc" : "desc")) === "desc" ? "DESC" : "ASC";
  const rows = all<BusinessRow>(
    `SELECT b.*, ${f.distance} AS distance_m FROM ${f.from} ${f.where} ORDER BY ${sortCol} IS NULL, ${sortCol} ${dir}, b.id LIMIT ? OFFSET ?`,
    [...f.params, pageSize, (page - 1) * pageSize],
  );
  return { items: rows.map(toBusiness), total, page, pageSize };
}

/** All matching ids (bounded) — used for bulk actions and exports. */
export function businessIdsFor(q: BusinessQuery, cap = 50_000): string[] {
  const f = buildBusinessFilter(q);
  return all<{ id: string }>(`SELECT b.id FROM ${f.from} ${f.where} LIMIT ?`, [...f.params, cap]).map((r) => r.id);
}

export function setTags(ids: string[], add: string[], remove: string[]) {
  for (const id of ids) {
    const row = getBusinessRow(id);
    const tags = new Set(parseJson<string[]>(row.tags, []));
    add.forEach((t) => tags.add(t));
    remove.forEach((t) => tags.delete(t));
    updateBusiness(id, { tags: JSON.stringify([...tags].sort()) });
  }
}

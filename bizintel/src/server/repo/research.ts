import type {
  ActivityEvent,
  CompanyReport,
  Contact,
  Evidence,
  Note,
  Opportunity,
  ResearchJob,
  WebsitePage,
} from "../../shared/types";
import { all, get, run } from "../db";
import { newId, notFound, nowIso, parseJson } from "../util";

// ── Contacts ────────────────────────────────────────────────────────────────

interface ContactRow {
  id: string;
  business_id: string;
  name: string | null;
  title: string | null;
  type: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  source_url: string | null;
  source_label: string;
  verification: string;
  last_checked_at: string;
}

const toContact = (r: ContactRow): Contact => ({
  id: r.id,
  businessId: r.business_id,
  name: r.name,
  title: r.title,
  type: r.type as Contact["type"],
  email: r.email,
  phone: r.phone,
  location: r.location,
  sourceUrl: r.source_url,
  sourceLabel: r.source_label,
  verification: r.verification as Contact["verification"],
  lastCheckedAt: r.last_checked_at,
});

export function upsertContact(c: Omit<Contact, "id" | "lastCheckedAt">): boolean {
  const existing = get<{ id: string }>(
    `SELECT id FROM contacts WHERE business_id = ? AND COALESCE(email,'') = COALESCE(?,'') AND COALESCE(phone,'') = COALESCE(?,'')`,
    [c.businessId, c.email, c.phone],
  );
  if (existing) {
    run(`UPDATE contacts SET last_checked_at = ?, source_url = COALESCE(source_url, ?) WHERE id = ?`, [nowIso(), c.sourceUrl, existing.id]);
    return false;
  }
  run(
    `INSERT INTO contacts (id, business_id, name, title, type, email, phone, location, source_url, source_label, verification, last_checked_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [newId("con"), c.businessId, c.name, c.title, c.type, c.email, c.phone, c.location, c.sourceUrl, c.sourceLabel, c.verification, nowIso()],
  );
  return true;
}

export const listContacts = (businessId: string) =>
  all<ContactRow>(`SELECT * FROM contacts WHERE business_id = ? ORDER BY CASE type WHEN 'general' THEN 0 WHEN 'sales' THEN 1 WHEN 'support' THEN 2 WHEN 'department' THEN 3 ELSE 4 END, email`, [businessId]).map(toContact);

export const listContactsFor = (businessIds: string[]) =>
  businessIds.length ? all<ContactRow>(`SELECT * FROM contacts WHERE business_id IN (${businessIds.map(() => "?").join(",")})`, businessIds).map(toContact) : [];

// ── Website pages ───────────────────────────────────────────────────────────

interface PageRow {
  id: string;
  business_id: string;
  url: string;
  title: string | null;
  category: string;
  status: string;
  http_status: number | null;
  retrieved_at: string | null;
  extracted_fields: string;
  warnings: string;
  summary: string | null;
  text: string | null;
}

const toPage = (r: PageRow): WebsitePage => ({
  id: r.id,
  businessId: r.business_id,
  url: r.url,
  title: r.title,
  category: r.category as WebsitePage["category"],
  status: r.status as WebsitePage["status"],
  httpStatus: r.http_status,
  retrievedAt: r.retrieved_at,
  extractedFields: parseJson(r.extracted_fields, []),
  warnings: parseJson(r.warnings, []),
  summary: r.summary,
  textLength: r.text?.length ?? 0,
});

export function upsertPage(p: Omit<WebsitePage, "id" | "textLength"> & { text: string | null }): string {
  const existing = get<{ id: string }>(`SELECT id FROM pages WHERE business_id = ? AND url = ?`, [p.businessId, p.url]);
  const id = existing?.id ?? newId("pg");
  run(
    `INSERT INTO pages (id, business_id, url, title, category, status, http_status, retrieved_at, extracted_fields, warnings, summary, text)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(business_id, url) DO UPDATE SET title=excluded.title, category=excluded.category, status=excluded.status,
       http_status=excluded.http_status, retrieved_at=excluded.retrieved_at, extracted_fields=excluded.extracted_fields,
       warnings=excluded.warnings, summary=COALESCE(excluded.summary, summary), text=COALESCE(excluded.text, text)`,
    [id, p.businessId, p.url, p.title, p.category, p.status, p.httpStatus, p.retrievedAt, JSON.stringify(p.extractedFields), JSON.stringify(p.warnings), p.summary, p.text],
  );
  return id;
}

export const listPages = (businessId: string) =>
  all<PageRow>(`SELECT * FROM pages WHERE business_id = ? ORDER BY CASE category WHEN 'home' THEN 0 WHEN 'contact' THEN 1 WHEN 'about' THEN 2 ELSE 3 END, url`, [businessId]).map(toPage);

export function getPageText(pageId: string): { page: WebsitePage; text: string | null } {
  const row = get<PageRow>(`SELECT * FROM pages WHERE id = ?`, [pageId]);
  if (!row) throw notFound("Page");
  return { page: toPage(row), text: row.text };
}

export function pageTexts(businessId: string): { url: string; title: string | null; category: string; text: string }[] {
  return all<PageRow>(`SELECT * FROM pages WHERE business_id = ? AND status = 'retrieved' AND text IS NOT NULL`, [businessId]).map((r) => ({
    url: r.url,
    title: r.title,
    category: r.category,
    text: r.text!,
  }));
}

// ── Evidence ────────────────────────────────────────────────────────────────

interface EvidenceRow {
  id: string;
  business_id: string;
  section: string;
  claim: string;
  classification: string;
  source_url: string | null;
  source_title: string | null;
  source_type: string;
  excerpt: string | null;
  published_at: string | null;
  retrieved_at: string | null;
  reviewed: number;
}

const toEvidence = (r: EvidenceRow): Evidence => ({
  id: r.id,
  businessId: r.business_id,
  section: r.section as Evidence["section"],
  claim: r.claim,
  classification: r.classification as Evidence["classification"],
  sourceUrl: r.source_url,
  sourceTitle: r.source_title,
  sourceType: r.source_type as Evidence["sourceType"],
  excerpt: r.excerpt,
  publishedAt: r.published_at,
  retrievedAt: r.retrieved_at,
  reviewed: r.reviewed === 1,
});

export type EvidenceOrigin = "extraction" | "model";

export function insertEvidence(e: Omit<Evidence, "id" | "reviewed"> & { origin?: EvidenceOrigin }): string {
  const id = newId("ev");
  run(
    `INSERT INTO evidence (id, origin, business_id, section, claim, classification, source_url, source_title, source_type, excerpt, published_at, retrieved_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, e.origin ?? "model", e.businessId, e.section, e.claim, e.classification, e.sourceUrl, e.sourceTitle, e.sourceType, e.excerpt, e.publishedAt, e.retrievedAt],
  );
  return id;
}

export const clearEvidence = (businessId: string, origin: EvidenceOrigin) => run(`DELETE FROM evidence WHERE business_id = ? AND origin = ?`, [businessId, origin]);
export const listEvidence = (businessId: string) => all<EvidenceRow>(`SELECT * FROM evidence WHERE business_id = ? ORDER BY section, classification`, [businessId]).map(toEvidence);

export function setEvidenceReviewed(id: string, reviewed: boolean) {
  const r = run(`UPDATE evidence SET reviewed = ? WHERE id = ?`, [reviewed ? 1 : 0, id]);
  if (r.changes === 0) throw notFound("Evidence");
}

// ── Reports & opportunities ─────────────────────────────────────────────────

export function saveReport(report: CompanyReport) {
  run(`INSERT INTO reports (business_id, body, generated_at) VALUES (?,?,?) ON CONFLICT(business_id) DO UPDATE SET body=excluded.body, generated_at=excluded.generated_at`, [
    report.businessId,
    JSON.stringify(report),
    report.generatedAt,
  ]);
}

export function getReport(businessId: string): CompanyReport | null {
  const r = get<{ body: string }>(`SELECT body FROM reports WHERE business_id = ?`, [businessId]);
  return r ? (JSON.parse(r.body) as CompanyReport) : null;
}

export function saveOpportunity(o: Opportunity) {
  run(`INSERT INTO opportunities (business_id, body, updated_at) VALUES (?,?,?) ON CONFLICT(business_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at`, [
    o.businessId,
    JSON.stringify(o),
    o.updatedAt,
  ]);
}

export function getOpportunity(businessId: string): Opportunity | null {
  const r = get<{ body: string }>(`SELECT body FROM opportunities WHERE business_id = ?`, [businessId]);
  return r ? (JSON.parse(r.body) as Opportunity) : null;
}

export function listOpportunities(opts: { minScore?: number; status?: string; page: number; pageSize: number }): { items: Opportunity[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.minScore !== undefined) {
    where.push("b.opportunity_score >= ?");
    params.push(opts.minScore);
  }
  if (opts.status) {
    where.push("b.qualification_status = ?");
    params.push(opts.status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM opportunities o JOIN businesses b ON b.id = o.business_id ${w}`, params)?.n ?? 0;
  const rows = all<{ body: string; qs: string }>(
    `SELECT o.body, b.qualification_status AS qs FROM opportunities o JOIN businesses b ON b.id = o.business_id ${w}
     ORDER BY b.opportunity_score DESC LIMIT ? OFFSET ?`,
    [...params, opts.pageSize, (opts.page - 1) * opts.pageSize],
  );
  return { items: rows.map((r) => ({ ...(JSON.parse(r.body) as Opportunity), qualificationStatus: r.qs as Opportunity["qualificationStatus"] })), total };
}

// ── Research jobs ───────────────────────────────────────────────────────────

interface JobRow {
  id: string;
  business_id: string;
  name: string;
  depth: string;
  status: string;
  stage: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

const toJob = (r: JobRow): ResearchJob => ({
  id: r.id,
  businessId: r.business_id,
  businessName: r.name,
  depth: r.depth as ResearchJob["depth"],
  status: r.status as ResearchJob["status"],
  stage: r.stage,
  error: r.error,
  createdAt: r.created_at,
  finishedAt: r.finished_at,
});

export function insertJob(businessId: string, depth: string, searchId: string | null): string {
  const id = newId("job");
  run(`INSERT INTO research_jobs (id, business_id, search_id, depth, status, created_at) VALUES (?,?,?,?, 'queued', ?)`, [id, businessId, searchId, depth, nowIso()]);
  return id;
}

export function patchJob(id: string, patch: { status?: string; stage?: string | null; error?: string | null; finished_at?: string }) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  run(`UPDATE research_jobs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => patch[k] ?? null), id]);
}

export function listJobs(opts: { active?: boolean; limit?: number; businessId?: string }): ResearchJob[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.active) where.push("j.status IN ('queued','running')");
  if (opts.businessId) {
    where.push("j.business_id = ?");
    params.push(opts.businessId);
  }
  return all<JobRow>(
    `SELECT j.*, b.name FROM research_jobs j JOIN businesses b ON b.id = j.business_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY j.created_at DESC LIMIT ?`,
    [...params, opts.limit ?? 50],
  ).map(toJob);
}

export const getJob = (id: string) => {
  const r = get<JobRow>(`SELECT j.*, b.name FROM research_jobs j JOIN businesses b ON b.id = j.business_id WHERE j.id = ?`, [id]);
  if (!r) throw notFound("Research job");
  return toJob(r);
};

// ── Notes & activity ────────────────────────────────────────────────────────

export function addNote(businessId: string, body: string): Note {
  const note = { id: newId("note"), businessId, body, createdAt: nowIso() };
  run(`INSERT INTO notes (id, business_id, body, created_at) VALUES (?,?,?,?)`, [note.id, businessId, body, note.createdAt]);
  return note;
}

export const listNotes = (businessId: string) =>
  all<{ id: string; business_id: string; body: string; created_at: string }>(`SELECT * FROM notes WHERE business_id = ? ORDER BY created_at DESC`, [businessId]).map(
    (r): Note => ({ id: r.id, businessId: r.business_id, body: r.body, createdAt: r.created_at }),
  );

export function deleteNote(id: string) {
  if (run(`DELETE FROM notes WHERE id = ?`, [id]).changes === 0) throw notFound("Note");
}

export function logActivity(e: { businessId?: string | null; searchId?: string | null; type: string; message: string }) {
  run(`INSERT INTO activity (id, business_id, search_id, type, message, created_at) VALUES (?,?,?,?,?,?)`, [
    newId("act"),
    e.businessId ?? null,
    e.searchId ?? null,
    e.type,
    e.message,
    nowIso(),
  ]);
}

export const listActivity = (businessId: string, limit = 100) =>
  all<{ id: string; business_id: string | null; search_id: string | null; type: string; message: string; created_at: string }>(
    `SELECT * FROM activity WHERE business_id = ? ORDER BY created_at DESC LIMIT ?`,
    [businessId, limit],
  ).map((r): ActivityEvent => ({ id: r.id, businessId: r.business_id, searchId: r.search_id, type: r.type, message: r.message, createdAt: r.created_at }));

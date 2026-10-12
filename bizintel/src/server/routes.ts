import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { z } from "zod";
import { SIZE_BANDS } from "../shared/domain";
import { INDUSTRIES } from "../shared/industries";
import type { GlobalSearchResult, OverviewStats } from "../shared/types";
import { config } from "./config";
import { all, get } from "./db";
import { analyzeBusiness } from "./jobs/analyze";
import { createExport, EXPORT_COLUMNS } from "./jobs/exportJob";
import { cancelResearch, queueResearch } from "./jobs/researchJob";
import { cancelSearch, createSearch, failedBusinessIds } from "./jobs/searchJob";
import { autocomplete } from "./providers/geocode";
import { llmJson } from "./providers/llm";
import { listProviders, providerInfo, PROVIDERS, type ProviderKey } from "./providers/registry";
import { tavilySearch } from "./providers/tavily";
import { businessIdsFor, getBusiness, queryBusinesses, setTags, updateBusiness } from "./repo/businesses";
import { getExport, getExportRow, listExports } from "./repo/exports";
import { addMembers, createList, deleteList, getList, listLists, listsForBusiness, removeMembers, updateList } from "./repo/lists";
import { deleteDraft, getDraft, insertDraft, listDrafts, updateDraft } from "./repo/outreach";
import {
  addNote,
  deleteNote,
  getOpportunity,
  getPageText,
  getReport,
  listActivity,
  listContacts,
  listEvidence,
  listJobs,
  listNotes,
  listOpportunities,
  listPages,
  logActivity,
  saveOpportunity,
  setEvidenceReviewed,
} from "./repo/research";
import { deleteSearch, getSearch, listSearches, patchSearch } from "./repo/searches";
import { getConfig, saveConfig } from "./repo/workspace";
import { enrichFromWebsite } from "./research/researcher";
import { generateDraft } from "./research/outreach";
import { HttpError, nowIso } from "./util";

const depth = z.enum(["fast", "standard", "deep"]);
const researchStatus = z.enum(["discovered", "website_identified", "enrichment_pending", "research_in_progress", "completed", "completed_with_warnings", "failed"]);
const qualification = z.enum(["unreviewed", "qualified", "disqualified", "needs_review"]);
const csv = (s: z.ZodTypeAny) => z.preprocess((v) => (typeof v === "string" ? (v ? v.split(",") : []) : v), z.array(s));
const bool = z.preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean());

const businessQuery = z.object({
  searchId: z.string().optional(),
  listId: z.string().optional(),
  q: z.string().max(200).optional(),
  industries: csv(z.string()).optional(),
  countryCode: z.string().length(2).optional(),
  region: z.string().max(100).optional(),
  hasEmail: bool.optional(),
  hasPhone: bool.optional(),
  hasWebsite: bool.optional(),
  researchStatus: csv(researchStatus).optional(),
  qualification: csv(qualification).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  sort: z.enum(["name", "distance", "industry", "researchStatus", "opportunityScore", "updatedAt"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const location = z.object({
  label: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  country: z.string().nullable(),
  countryCode: z.string().nullable(),
  region: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  kind: z.string(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
});

const ids = z.object({ businessIds: z.array(z.string()).min(1).max(5000) });

export async function registerRoutes(app: FastifyInstance) {
  // ── Meta ────────────────────────────────────────────────────────────────
  app.get("/api/health", async () => ({ ok: true, time: nowIso() }));
  app.get("/api/meta", async () => ({ industries: INDUSTRIES, sizeBands: SIZE_BANDS, exportColumns: EXPORT_COLUMNS.map(({ key, label }) => ({ key, label })) }));

  app.get("/api/overview", async () => {
    const n = (sql: string) => get<{ n: number }>(sql)?.n ?? 0;
    const stats: OverviewStats = {
      businesses: n(`SELECT COUNT(*) n FROM businesses`),
      researched: n(`SELECT COUNT(*) n FROM businesses WHERE research_status IN ('completed','completed_with_warnings')`),
      withEmail: n(`SELECT COUNT(*) n FROM businesses b WHERE b.email IS NOT NULL OR EXISTS (SELECT 1 FROM contacts c WHERE c.business_id=b.id AND c.email IS NOT NULL)`),
      withPhone: n(`SELECT COUNT(*) n FROM businesses WHERE phone IS NOT NULL`),
      qualified: n(`SELECT COUNT(*) n FROM businesses WHERE qualification_status = 'qualified'`),
      activeJobs: n(`SELECT (SELECT COUNT(*) FROM searches WHERE status IN ('queued','running')) + (SELECT COUNT(*) FROM research_jobs WHERE status IN ('queued','running')) n`),
    };
    const recentReports = all<{ business_id: string; name: string; generated_at: string }>(
      `SELECT r.business_id, b.name, r.generated_at FROM reports r JOIN businesses b ON b.id = r.business_id ORDER BY r.generated_at DESC LIMIT 6`,
    ).map((r) => ({ businessId: r.business_id, businessName: r.name, generatedAt: r.generated_at }));
    return {
      stats,
      recentSearches: listSearches(6).items,
      activeResearch: listJobs({ active: true, limit: 8 }),
      recentlyResearched: queryBusinesses({ researchStatus: ["completed", "completed_with_warnings"], sort: "updatedAt", dir: "desc", pageSize: 6 }).items,
      recentBusinesses: queryBusinesses({ sort: "updatedAt", dir: "desc", pageSize: 8 }).items,
      recentReports,
      lists: listLists().slice(0, 6),
      exports: listExports(5),
      providers: listProviders(),
    };
  });

  app.get("/api/search", async (req) => {
    const { q } = z.object({ q: z.string().min(1).max(100) }).parse(req.query);
    const like = `%${q}%`;
    const result: GlobalSearchResult = {
      businesses: all<{ id: string; name: string; category: string | null; city: string | null; website: string | null }>(
        `SELECT id, name, category, city, website FROM businesses WHERE name LIKE ? OR website LIKE ? ORDER BY name LIMIT 8`,
        [like, like],
      ),
      lists: listLists()
        .filter((l) => l.name.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 5)
        .map(({ id, name, count }) => ({ id, name, count })),
      searches: all<{ id: string; name: string; status: string }>(`SELECT id, name, status FROM searches WHERE name LIKE ? ORDER BY created_at DESC LIMIT 5`, [like]).map(
        (s) => ({ ...s, status: s.status as never }),
      ),
      reports: all<{ business_id: string; name: string; generated_at: string }>(
        `SELECT r.business_id, b.name, r.generated_at FROM reports r JOIN businesses b ON b.id = r.business_id WHERE b.name LIKE ? OR r.body LIKE ? LIMIT 5`,
        [like, like],
      ).map((r) => ({ businessId: r.business_id, businessName: r.name, generatedAt: r.generated_at })),
    };
    return result;
  });

  // ── Geocoding ───────────────────────────────────────────────────────────
  app.get("/api/geocode", async (req) => {
    const { q } = z.object({ q: z.string().min(2).max(200) }).parse(req.query);
    return { items: await autocomplete(q) };
  });

  // ── Searches ────────────────────────────────────────────────────────────
  app.post("/api/searches", async (req, reply) => {
    const body = z
      .object({
        name: z.string().max(120).optional(),
        location,
        radius: z.number().positive(),
        unit: z.enum(["mi", "km"]),
        industries: z.array(z.string()).max(100),
        depth,
        maxBusinesses: z.number().int().min(1).max(1000).optional(),
      })
      .parse(req.body);
    reply.code(201);
    return createSearch(body);
  });
  app.get("/api/searches", async (req) => {
    const { limit, offset } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    return listSearches(limit, offset);
  });
  app.get("/api/searches/:id", async (req) => {
    const { id } = req.params as { id: string };
    const s = getSearch(id);
    const n = (cond: string) => get<{ n: number }>(`SELECT COUNT(*) n FROM search_results sr JOIN businesses b ON b.id = sr.business_id WHERE sr.search_id = ? AND ${cond}`, [id])?.n ?? 0;
    return {
      ...s,
      resultSummary: {
        withEmail: n("(b.email IS NOT NULL OR EXISTS (SELECT 1 FROM contacts c WHERE c.business_id = b.id AND c.email IS NOT NULL))"),
        withPhone: n("b.phone IS NOT NULL"),
      },
    };
  });
  app.patch("/api/searches/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().min(1).max(120).optional(), saved: z.boolean().optional() }).parse(req.body);
    getSearch(id);
    patchSearch(id, { ...(body.name ? { name: body.name } : {}), ...(body.saved !== undefined ? { saved: body.saved ? 1 : 0 } : {}) });
    return getSearch(id);
  });
  app.post("/api/searches/:id/cancel", async (req) => cancelSearch((req.params as { id: string }).id));
  app.post("/api/searches/:id/retry-failed", async (req) => {
    const { id } = req.params as { id: string };
    const s = getSearch(id);
    const failed = failedBusinessIds(id);
    if (!failed.length) throw new HttpError(409, "nothing_to_retry", "There are no failed businesses in this search.");
    return queueResearch(failed, s.depth === "fast" ? "standard" : s.depth, id);
  });
  app.delete("/api/searches/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = getSearch(id);
    if (s.status === "running" || s.status === "queued") throw new HttpError(409, "running", "Cancel the search before deleting it.");
    deleteSearch(id);
    reply.code(204);
  });

  // ── Businesses ──────────────────────────────────────────────────────────
  app.get("/api/businesses", async (req) => queryBusinesses(businessQuery.parse(req.query)));
  app.get("/api/businesses/:id", async (req) => {
    const { id } = req.params as { id: string };
    const business = getBusiness(id);
    const search = get<{ distance_m: number; search_id: string }>(`SELECT distance_m, search_id FROM search_results WHERE business_id = ? ORDER BY rowid DESC LIMIT 1`, [id]);
    return {
      business: { ...business, distanceMeters: search?.distance_m ?? null },
      searchId: search?.search_id ?? null,
      lists: listsForBusiness(id),
      activeJob: listJobs({ active: true, businessId: id, limit: 1 })[0] ?? null,
    };
  });
  app.patch("/api/businesses/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ saved: z.boolean().optional(), tags: z.array(z.string().min(1).max(40)).max(30).optional() }).parse(req.body);
    getBusiness(id);
    if (body.saved !== undefined) updateBusiness(id, { saved: body.saved ? 1 : 0 });
    if (body.tags) updateBusiness(id, { tags: JSON.stringify([...new Set(body.tags)].sort()) });
    return getBusiness(id);
  });
  app.get("/api/businesses/:id/contacts", async (req) => listContacts((req.params as { id: string }).id));
  app.get("/api/businesses/:id/pages", async (req) => listPages((req.params as { id: string }).id));
  app.get("/api/pages/:id", async (req) => {
    const { page, text } = getPageText((req.params as { id: string }).id);
    return { page, text: text?.slice(0, 20_000) ?? null };
  });
  app.post("/api/businesses/:id/pages/retry", async (req) => {
    const { id } = req.params as { id: string };
    const r = await enrichFromWebsite(id, getConfig().research.maxPagesPerCompany);
    analyzeBusiness(id);
    return r;
  });
  app.get("/api/businesses/:id/evidence", async (req) => listEvidence((req.params as { id: string }).id));
  app.patch("/api/evidence/:id", async (req) => {
    const { reviewed } = z.object({ reviewed: z.boolean() }).parse(req.body);
    setEvidenceReviewed((req.params as { id: string }).id, reviewed);
    return { ok: true };
  });
  app.get("/api/businesses/:id/report", async (req) => ({ report: getReport((req.params as { id: string }).id) }));
  app.get("/api/businesses/:id/opportunity", async (req) => ({ opportunity: getOpportunity((req.params as { id: string }).id) }));
  app.post("/api/businesses/:id/opportunity/rescore", async (req) => analyzeBusiness((req.params as { id: string }).id));
  app.get("/api/businesses/:id/activity", async (req) => listActivity((req.params as { id: string }).id));
  app.get("/api/businesses/:id/notes", async (req) => listNotes((req.params as { id: string }).id));
  app.post("/api/businesses/:id/notes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { body } = z.object({ body: z.string().trim().min(1).max(5000) }).parse(req.body);
    getBusiness(id);
    const note = addNote(id, body);
    logActivity({ businessId: id, type: "note_added", message: "Note added." });
    reply.code(201);
    return note;
  });
  app.delete("/api/notes/:id", async (req, reply) => {
    deleteNote((req.params as { id: string }).id);
    reply.code(204);
  });

  // Qualification override
  app.post("/api/businesses/:id/qualification", async (req) => {
    const { id } = req.params as { id: string };
    const { status, reason } = z.object({ status: qualification, reason: z.string().max(500).optional() }).parse(req.body);
    const b = getBusiness(id);
    const opp = getOpportunity(id) ?? analyzeBusiness(id);
    saveOpportunity({ ...opp, qualificationStatus: status, overriddenBy: "user", updatedAt: nowIso() });
    updateBusiness(id, { qualification_status: status });
    logActivity({ businessId: id, type: "qualification_changed", message: `Qualification changed from ${b.qualificationStatus.replace("_", " ")} to ${status.replace("_", " ")}${reason ? ` — ${reason}` : ""}.` });
    return getOpportunity(id);
  });
  app.post("/api/businesses/:id/qualification/reset", async (req) => {
    const { id } = req.params as { id: string };
    const opp = getOpportunity(id);
    if (opp) saveOpportunity({ ...opp, overriddenBy: null });
    logActivity({ businessId: id, type: "qualification_changed", message: "Manual qualification override removed." });
    return analyzeBusiness(id);
  });

  // Bulk
  app.post("/api/businesses/bulk/tags", async (req) => {
    const body = ids.extend({ add: z.array(z.string().min(1).max(40)).default([]), remove: z.array(z.string()).default([]) }).parse(req.body);
    setTags(body.businessIds, body.add, body.remove);
    return { updated: body.businessIds.length };
  });
  app.post("/api/businesses/bulk/qualification", async (req) => {
    const body = ids.extend({ status: qualification }).parse(req.body);
    for (const id of body.businessIds) {
      const opp = getOpportunity(id) ?? analyzeBusiness(id);
      saveOpportunity({ ...opp, qualificationStatus: body.status, overriddenBy: "user", updatedAt: nowIso() });
      updateBusiness(id, { qualification_status: body.status });
      logActivity({ businessId: id, type: "qualification_changed", message: `Qualification set to ${body.status.replace("_", " ")} (bulk update).` });
    }
    return { updated: body.businessIds.length };
  });
  app.post("/api/businesses/ids", async (req) => ({ ids: businessIdsFor(businessQuery.parse(req.body), 5000) }));

  // ── Research jobs ───────────────────────────────────────────────────────
  app.post("/api/research", async (req, reply) => {
    const body = ids.extend({ depth }).parse(req.body);
    reply.code(202);
    return queueResearch(body.businessIds, body.depth);
  });
  app.get("/api/research/jobs", async (req) => {
    const q = z.object({ active: bool.optional(), businessId: z.string().optional(), limit: z.coerce.number().int().max(500).optional() }).parse(req.query);
    return listJobs(q);
  });
  app.post("/api/research/jobs/:id/cancel", async (req) => cancelResearch((req.params as { id: string }).id));

  // ── Opportunities ───────────────────────────────────────────────────────
  app.get("/api/opportunities", async (req) => {
    const q = z
      .object({ minScore: z.coerce.number().optional(), status: qualification.optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) })
      .parse(req.query);
    return { ...listOpportunities(q), page: q.page, pageSize: q.pageSize };
  });
  app.post("/api/opportunities/rescore", async () => {
    const all_ = all<{ business_id: string }>(`SELECT business_id FROM opportunities`);
    all_.forEach((r) => analyzeBusiness(r.business_id));
    return { rescored: all_.length };
  });

  // ── Lists ───────────────────────────────────────────────────────────────
  app.get("/api/lists", async () => listLists());
  app.post("/api/lists", async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500).nullable().optional() }).parse(req.body);
    reply.code(201);
    return createList(body.name, body.description ?? null);
  });
  app.get("/api/lists/:id", async (req) => getList((req.params as { id: string }).id));
  app.patch("/api/lists/:id", async (req) =>
    updateList((req.params as { id: string }).id, z.object({ name: z.string().trim().min(1).max(80).optional(), description: z.string().max(500).nullable().optional() }).parse(req.body)),
  );
  app.delete("/api/lists/:id", async (req, reply) => {
    deleteList((req.params as { id: string }).id);
    reply.code(204);
  });
  app.post("/api/lists/:id/members", async (req) => {
    const { id } = req.params as { id: string };
    const { businessIds } = ids.parse(req.body);
    const r = addMembers(id, businessIds);
    const list = getList(id);
    businessIds.forEach((b) => logActivity({ businessId: b, type: "list_added", message: `Added to list “${list.name}”.` }));
    return r;
  });
  app.post("/api/lists/:id/members/remove", async (req) => ({ removed: removeMembers((req.params as { id: string }).id, ids.parse(req.body).businessIds) }));

  // ── Outreach ────────────────────────────────────────────────────────────
  app.get("/api/outreach/drafts", async (req) => listDrafts(z.object({ businessId: z.string().optional() }).parse(req.query).businessId));
  app.post("/api/outreach/drafts/generate", async (req, reply) => {
    const body = z.object({ businessId: z.string(), contactId: z.string().nullable().optional() }).parse(req.body);
    reply.code(201);
    return generateDraft(body.businessId, body.contactId ?? null);
  });
  app.post("/api/outreach/drafts", async (req, reply) => {
    const body = z.object({ businessId: z.string(), contactId: z.string().nullable().optional() }).parse(req.body);
    getBusiness(body.businessId);
    reply.code(201);
    return insertDraft({ businessId: body.businessId, contactId: body.contactId ?? null, subject: "", body: "", followUp: "", discoveryQuestion: "", evidenceIds: [], model: null });
  });
  app.get("/api/outreach/drafts/:id", async (req) => getDraft((req.params as { id: string }).id));
  app.patch("/api/outreach/drafts/:id", async (req) =>
    updateDraft(
      (req.params as { id: string }).id,
      z
        .object({
          subject: z.string().max(300).optional(),
          body: z.string().max(10_000).optional(),
          followUp: z.string().max(10_000).optional(),
          discoveryQuestion: z.string().max(1000).optional(),
          contactId: z.string().nullable().optional(),
        })
        .parse(req.body),
    ),
  );
  app.delete("/api/outreach/drafts/:id", async (req, reply) => {
    deleteDraft((req.params as { id: string }).id);
    reply.code(204);
  });

  // ── Exports ─────────────────────────────────────────────────────────────
  const scope = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("all") }),
    z.object({ kind: z.literal("search"), searchId: z.string() }),
    z.object({ kind: z.literal("selected"), businessIds: z.array(z.string()).min(1).max(50_000) }),
    z.object({ kind: z.literal("list"), listId: z.string() }),
    z.object({ kind: z.literal("qualified") }),
    z.object({ kind: z.literal("with_email") }),
    z.object({ kind: z.literal("with_phone") }),
    z.object({ kind: z.literal("researched") }),
  ]);
  app.get("/api/exports", async () => listExports());
  app.post("/api/exports", async (req, reply) => {
    const body = z
      .object({
        name: z.string().max(120).optional(),
        format: z.enum(["csv", "xlsx"]),
        scope,
        columns: z.array(z.string()).min(1),
        include: z.array(z.enum(["overview", "contacts", "website_research", "sources", "scores", "opportunities", "outreach"])).default([]),
      })
      .parse(req.body);
    reply.code(202);
    return createExport(body);
  });
  app.get("/api/exports/:id", async (req) => getExport((req.params as { id: string }).id));
  app.get("/api/exports/:id/download", async (req, reply) => {
    const row = getExportRow((req.params as { id: string }).id);
    if (row.status !== "completed" || !row.file_path || !existsSync(row.file_path)) throw new HttpError(410, "unavailable", "This export file is no longer available.");
    const safe = row.name.replace(/[^\w.\- ]+/g, "_").trim() || "export";
    reply.header("Content-Disposition", `attachment; filename="${safe}.${row.format}"`);
    reply.type(row.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return reply.send(createReadStream(row.file_path));
  });

  // ── Data sources & settings ─────────────────────────────────────────────
  app.get("/api/providers", async () => listProviders());
  app.post("/api/providers/:key/test", async (req) => {
    const key = (req.params as { key: string }).key as ProviderKey;
    if (!PROVIDERS[key]) throw new HttpError(404, "not_found", "Unknown provider.");
    if (!PROVIDERS[key].configured()) throw new HttpError(409, "not_configured", "This provider is not configured.");
    try {
      switch (key) {
        case "photon":
          await autocomplete("London");
          break;
        case "nominatim": {
          const { reverse } = await import("./providers/geocode");
          await reverse(51.5074, -0.1278);
          break;
        }
        case "overpass": {
          const { discoverBusinesses } = await import("./providers/discovery");
          await discoverBusinesses({ lat: 51.5074, lon: -0.1278, radiusMeters: 150, industries: ["food.cafe"], limit: 3, country: null, countryCode: null });
          break;
        }
        case "tavily":
          await tavilySearch("OpenStreetMap", { maxResults: 1 });
          break;
        case "llm":
          await llmJson<{ ok: boolean }>("Reply with JSON.", 'Return {"ok": true}.', { maxTokens: 20 });
          break;
        default:
          throw new HttpError(400, "not_testable", "This provider cannot be tested.");
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      return { ok: false, message: (e as Error).message, provider: providerInfo(key) };
    }
    return { ok: true, message: "Connection succeeded.", provider: providerInfo(key) };
  });

  app.get("/api/config", async () => getConfig());
  app.put("/api/config", async (req) => {
    const body = z
      .object({
        branding: z.object({
          productName: z.string().trim().min(1).max(60),
          workspaceName: z.string().trim().min(1).max(60),
          logoUrl: z.string().url().max(2000).nullable(),
          theme: z.enum(["system", "light", "dark"]),
        }),
        research: z.object({
          defaultDepth: depth,
          maxPagesPerCompany: z.number().int().min(1).max(25),
          crawlConcurrency: z.number().int().min(1).max(10),
          maxBusinessesPerSearch: z.number().int().min(10).max(1000),
          defaultRadius: z.number().positive().max(62),
          defaultUnit: z.enum(["auto", "mi", "km"]),
          maxLlmCallsPerSearch: z.number().int().min(0).max(1000),
          maxWebSearchCallsPerSearch: z.number().int().min(0).max(1000),
          supportedCountries: z.array(z.string().length(2).toUpperCase()).max(250),
          defaultIndustries: z.array(z.string()).max(100),
        }),
        qualification: z.object({
          criteria: z
            .array(
              z.object({
                key: z.enum(["industry_fit", "size_fit", "geo_fit", "need_signals", "contactability", "research_confidence"]),
                label: z.string().min(1).max(60),
                weight: z.number().min(0).max(100),
                enabled: z.boolean(),
              }),
            )
            .length(6),
          targetIndustries: z.array(z.string()).max(100),
          targetSizes: z.array(z.string()).max(10),
          targetCountries: z.array(z.string().length(2).toUpperCase()).max(250),
          needKeywords: z.array(z.string().trim().min(2).max(60)).max(30),
          offeringDescription: z.string().max(2000),
          qualifiedThreshold: z.number().min(0).max(100),
        }),
      })
      .parse(req.body);
    saveConfig(body);
    return getConfig();
  });

  app.get("/api/system", async () => ({ exportTtlDays: config.exportTtlDays }));
}

import { domainOf, REPORT_SECTIONS, SIZE_BANDS } from "../../shared/domain";
import { industryLabel } from "../../shared/industries";
import type { Business, CompanyReport, EvidenceClass, ReportSection, ReportSectionKey, ResearchDepth } from "../../shared/types";
import { llmConfigured, llmJson, llmModelName } from "../providers/llm";
import { tavilyConfigured, tavilyExtract, tavilySearch } from "../providers/tavily";
import { getBusiness, updateBusiness } from "../repo/businesses";
import { clearEvidence, insertEvidence, listContacts, logActivity, pageTexts, saveReport, upsertContact, upsertPage } from "../repo/research";
import { getConfig } from "../repo/workspace";
import { mapLimit, nowIso } from "../util";
import { fetchPage, planPages, robotsAllows } from "./crawler";
import { contactTypeFor, excerptIsGrounded, extractEmails, extractJsonLd, extractMetaDescription, extractPhones, htmlToText } from "./extract";

/** Per-search spending caps for paid providers. */
export class Budget {
  constructor(
    public llm: number,
    public web: number,
  ) {}
  take(kind: "llm" | "web"): boolean {
    if (this[kind] <= 0) return false;
    this[kind] -= 1;
    return true;
  }
  static unlimited() {
    return new Budget(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  }
}

export interface StepResult {
  warnings: string[];
}

// Directories and social networks are not official company websites.
const NON_OFFICIAL = [
  "yelp.", "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "tiktok.com", "youtube.com", "tripadvisor.",
  "yellowpages.", "bbb.org", "mapquest.com", "foursquare.com", "google.", "apple.com", "wikipedia.org", "opentable.", "doordash.",
  "ubereats.", "grubhub.", "zomato.", "indeed.", "glassdoor.", "crunchbase.com", "zoominfo.com", "manta.com", "chamberofcommerce.com",
  "nextdoor.com", "angi.com", "houzz.com", "thumbtack.com", "healthgrades.com", "zocdoc.com", "avvo.com", "justia.com", "realtor.com", "zillow.com",
];

const isDirectory = (url: string) => {
  const host = domainOf(url) ?? "";
  return NON_OFFICIAL.some((d) => host.includes(d));
};

// Generic words that appear in many business names and domains; matching on them is not evidence.
const GENERIC_TOKENS = new Set([
  "the", "and", "inc", "llc", "pllc", "ltd", "limited", "company", "corp", "corporation", "gmbh", "group", "services", "service",
  "restaurant", "cafe", "coffee", "bar", "grill", "kitchen", "shop", "store", "market", "law", "legal", "office", "offices", "attorney",
  "attorneys", "lawyer", "lawyers", "firm", "dental", "dentist", "clinic", "medical", "health", "care", "center", "centre", "consulting",
  "solutions", "associates", "partners", "studio", "salon", "auto", "repair", "hotel", "agency", "real", "estate", "insurance", "bank",
  "city", "north", "south", "east", "west", "new", "best", "first", "american", "national", "international", "global",
]);

const nameTokens = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t));

/** Conservative: accept a search result only when its domain contains a distinctive token of the business name. */
export function matchOfficialSite(name: string, results: { url: string; title: string }[]): { url: string; title: string } | null {
  const tokens = nameTokens(name);
  if (!tokens.length) return null;
  for (const r of results) {
    if (isDirectory(r.url)) continue;
    const host = (domainOf(r.url) ?? "").replace(/[^a-z0-9]/g, "");
    if (tokens.some((t) => host.includes(t.replace(/[^a-z0-9]/g, "")))) {
      const u = new URL(r.url);
      return { url: `${u.protocol}//${u.host}/`, title: r.title };
    }
  }
  return null;
}

// ── Stage 1: official website ───────────────────────────────────────────────

export async function identifyWebsite(b: Business, budget: Budget, signal?: AbortSignal): Promise<StepResult & { found: boolean }> {
  if (b.website) return { found: true, warnings: [] };
  if (!tavilyConfigured()) return { found: false, warnings: ["Website lookup skipped: web search provider not configured."] };
  if (!budget.take("web")) return { found: false, warnings: ["Website lookup skipped: web-search limit for this search reached."] };
  const q = `${b.name} ${[b.city, b.region, b.country].filter(Boolean).join(" ")} official website`;
  const results = await tavilySearch(q, { maxResults: 6, signal });
  const match = matchOfficialSite(b.name, results);
  if (!match) return { found: false, warnings: [] };
  updateBusiness(b.id, { website: match.url, website_source: "Web search (Tavily) — domain matches business name; not confirmed by map listing", research_status: "website_identified" });
  logActivity({ businessId: b.id, type: "website_identified", message: `Official website identified via web search: ${match.url}` });
  return { found: true, warnings: [] };
}

// ── Stage 2: crawl + contact extraction ─────────────────────────────────────

export async function enrichFromWebsite(businessId: string, maxPages: number, signal?: AbortSignal): Promise<StepResult & { contactsAdded: number; pagesRetrieved: number }> {
  const b = getBusiness(businessId);
  const warnings: string[] = [];
  if (!b.website) return { warnings: ["No official website identified."], contactsAdded: 0, pagesRetrieved: 0 };
  const home = new URL(b.website);
  const origin = home.origin;
  const allowed = await robotsAllows(origin, signal);
  const homeUrl = `${origin}${home.pathname || "/"}`;
  if (!allowed(home.pathname || "/")) {
    upsertPage({ businessId, url: homeUrl, title: null, category: "home", status: "blocked", httpStatus: null, retrievedAt: nowIso(), extractedFields: [], warnings: ["Disallowed by robots.txt"], summary: null, text: null });
    return { warnings: ["Website disallows automated access (robots.txt)."], contactsAdded: 0, pagesRetrieved: 0 };
  }

  const fetched = [await fetchPage(homeUrl, "home", signal)];
  let homeHtml = fetched[0].html;

  if (!homeHtml && tavilyConfigured()) {
    // Some sites block simple HTTP clients; fall back to the extraction provider for the home page.
    try {
      const ex = await tavilyExtract([homeUrl], signal);
      if (ex.results[0]?.raw_content) {
        homeHtml = null;
        upsertPage({
          businessId, url: homeUrl, title: null, category: "home", status: "retrieved", httpStatus: null, retrievedAt: nowIso(),
          extractedFields: [], warnings: [`Direct retrieval failed (${fetched[0].error}); content retrieved via Tavily Extract.`], summary: null, text: ex.results[0].raw_content.slice(0, 60_000),
        });
        warnings.push("Home page retrieved through extraction fallback; links and structured data unavailable.");
        fetched[0] = { ...fetched[0], status: "skipped" };
      }
    } catch (e) {
      warnings.push(`Extraction fallback failed: ${(e as Error).message}`);
    }
  }

  if (homeHtml) {
    const plan = planPages(homeHtml, fetched[0].finalUrl, maxPages).filter((p) => allowed(new URL(p.url).pathname));
    const rest: typeof fetched = [];
    await mapLimit(plan, 2, async (p) => void rest.push(await fetchPage(p.url, p.category, signal)), signal);
    fetched.push(...rest);
  }

  clearEvidence(businessId, "extraction");
  let contactsAdded = 0;
  let pagesRetrieved = 0;
  const contactPhones: string[] = [];
  const contactEmails: { email: string; url: string }[] = [];

  for (const page of fetched) {
    if (page.status === "skipped" && !page.html) continue;
    const fields: string[] = [];
    const pageWarnings: string[] = page.error ? [page.error] : [];
    let text: string | null = null;
    if (page.html) {
      pagesRetrieved++;
      text = htmlToText(page.html).slice(0, 60_000);
      const emails = extractEmails(page.html);
      const phones = extractPhones(page.html);
      const ld = extractJsonLd(page.html);
      const meta = extractMetaDescription(page.html);
      if (emails.length) fields.push("email");
      if (phones.length) fields.push("phone");
      if (ld) fields.push("structured data");
      if (meta) fields.push("description");
      if (text.length < 200) pageWarnings.push("Very little readable text — the page may rely on client-side rendering.");
      for (const email of emails) {
        contactEmails.push({ email, url: page.finalUrl });
        if (upsertContact({ businessId, name: null, title: null, type: contactTypeFor(email), email, phone: null, location: b.address, sourceUrl: page.finalUrl, sourceLabel: "Official website", verification: "official_website" })) contactsAdded++;
      }
      // Only trust phone numbers from the home and contact pages to limit false positives.
      if (page.category === "home" || page.category === "contact" || page.category === "locations") {
        for (const phone of phones.slice(0, 3)) {
          contactPhones.push(phone);
          if (upsertContact({ businessId, name: null, title: null, type: "general", email: null, phone, location: b.address, sourceUrl: page.finalUrl, sourceLabel: "Official website", verification: "official_website" })) contactsAdded++;
        }
      }
      if (ld) {
        const src = { origin: "extraction" as const, businessId, sourceUrl: page.finalUrl, sourceTitle: page.title, sourceType: "official_website" as const, publishedAt: null, retrievedAt: page.retrievedAt };
        if (ld.description) insertEvidence({ ...src, section: "overview", claim: ld.description.slice(0, 500), classification: "verified_fact", excerpt: "Published in the site's schema.org structured data." });
        if (ld.numberOfEmployees) {
          insertEvidence({ ...src, section: "size_scale", claim: `Employees (published by company): ${ld.numberOfEmployees}`, classification: "verified_fact", excerpt: "schema.org numberOfEmployees" });
          updateBusiness(businessId, { size_estimate: ld.numberOfEmployees, size_evidence_class: "verified_fact" });
        }
        if (ld.foundingDate) insertEvidence({ ...src, section: "overview", claim: `Founded: ${ld.foundingDate}`, classification: "verified_fact", excerpt: "schema.org foundingDate" });
        if (ld.areaServed) insertEvidence({ ...src, section: "geography", claim: `Area served: ${ld.areaServed}`, classification: "verified_fact", excerpt: "schema.org areaServed" });
        if (ld.email && upsertContact({ businessId, name: null, title: null, type: contactTypeFor(ld.email), email: ld.email.toLowerCase(), phone: null, location: b.address, sourceUrl: page.finalUrl, sourceLabel: "Official website (structured data)", verification: "official_website" })) contactsAdded++;
      }
      if (meta && page.category === "home") {
        insertEvidence({ origin: "extraction", businessId, section: "overview", claim: meta, classification: "verified_fact", sourceUrl: page.finalUrl, sourceTitle: page.title, sourceType: "official_website", excerpt: meta, publishedAt: null, retrievedAt: page.retrievedAt });
      }
    }
    upsertPage({ businessId, url: page.finalUrl, title: page.title, category: page.category, status: page.status, httpStatus: page.httpStatus, retrievedAt: page.retrievedAt, extractedFields: fields, warnings: pageWarnings, summary: null, text });
  }

  // Promote the best published contact to the business record when the listing had none.
  const fresh = getBusiness(businessId);
  const patch: Record<string, string> = {};
  if (!fresh.email && contactEmails.length) {
    const site = domainOf(b.website);
    const best = contactEmails.find((c) => c.email.endsWith(`@${site}`) && contactTypeFor(c.email) === "general") ?? contactEmails.find((c) => c.email.endsWith(`@${site}`)) ?? contactEmails[0];
    patch.email = best.email;
    patch.email_source = `Official website (${best.url})`;
  }
  if (!fresh.phone && contactPhones.length) {
    patch.phone = contactPhones[0];
    patch.phone_source = "Official website";
  }
  if (Object.keys(patch).length) updateBusiness(businessId, patch);
  if (pagesRetrieved === 0 && !warnings.length) warnings.push("No pages could be retrieved from the official website.");
  logActivity({ businessId, type: "website_crawled", message: `Website inspected: ${pagesRetrieved} page(s) retrieved, ${contactsAdded} new contact record(s).` });
  return { warnings, contactsAdded, pagesRetrieved };
}

// ── Stage 3: structured research ────────────────────────────────────────────

interface LlmClaim {
  section: ReportSectionKey;
  claim: string;
  classification: EvidenceClass;
  source_url?: string | null;
  excerpt?: string | null;
}

interface LlmResearch {
  sections: Partial<Record<ReportSectionKey, string | null>>;
  claims: LlmClaim[];
  size_band?: string | null;
  size_rationale?: string | null;
  confidence?: "high" | "medium" | "low";
  confidence_rationale?: string;
}

const SYSTEM_PROMPT = `You are a careful business research analyst producing an evidence-backed company brief.
Rules:
- Use ONLY the supplied source documents. Never invent facts, names, numbers, customers or contact details.
- Every claim must cite the URL of the document that supports it and include a short VERBATIM excerpt (8–40 words) copied exactly from that document.
- Classify each claim: "verified_fact" (stated on the company's own website), "third_party" (stated by another source), "inference" (reasonably implied by cited text — still give the excerpt it is inferred from), "hypothesis" (plausible but not supported — no excerpt).
- If information is not present, say so in "missing_information" rather than guessing.
- Write concise, neutral prose suitable for a professional research brief.
Reply with a single JSON object only.`;

function buildPrompt(b: Business, docs: { url: string; title: string | null; kind: string; text: string }[], offering: string, needKeywords: string[]): string {
  const sectionKeys = REPORT_SECTIONS.map((s) => s.key).join(", ");
  const docText = docs.map((d, i) => `### Document ${i + 1} (${d.kind})\nURL: ${d.url}\nTitle: ${d.title ?? "—"}\n${d.text}`).join("\n\n");
  return `Company: ${b.name}
Category: ${b.category ?? "unknown"} (${industryLabel(b.industry)})
Address: ${b.address ?? "unknown"}, ${b.country ?? ""}
Official website: ${b.website ?? "unknown"}
${offering ? `\nThe research is being done by a team that offers: ${offering}\nWhen writing "opportunities", describe only operational needs that the sources give evidence for; label anything else a hypothesis.` : ""}
${needKeywords.length ? `Look specifically for evidence related to: ${needKeywords.join(", ")}.` : ""}

Return JSON:
{
  "sections": { ${REPORT_SECTIONS.map((s) => `"${s.key}": string|null`).join(", ")} },
  "claims": [ { "section": one of [${sectionKeys}], "claim": string, "classification": "verified_fact"|"third_party"|"inference"|"hypothesis", "source_url": string|null, "excerpt": string|null } ],
  "size_band": one of ${JSON.stringify(SIZE_BANDS)} or null,
  "size_rationale": string|null,
  "confidence": "high"|"medium"|"low",
  "confidence_rationale": string
}

Sources:
${docText}`;
}

function budgetDocs<T extends { text: string }>(docs: T[], perDoc: number, total: number): T[] {
  const out: T[] = [];
  let used = 0;
  for (const d of docs) {
    if (used >= total) break;
    const text = d.text.slice(0, Math.min(perDoc, total - used));
    used += text.length;
    out.push({ ...d, text });
  }
  return out;
}

export async function researchCompany(businessId: string, depth: ResearchDepth, budget: Budget, signal?: AbortSignal): Promise<StepResult & { report: CompanyReport }> {
  const b = getBusiness(businessId);
  const cfg = getConfig();
  const warnings: string[] = [];
  const pages = pageTexts(businessId);
  const docs: { url: string; title: string | null; kind: string; text: string; sourceType: "official_website" | "third_party"; publishedAt: string | null }[] = pages.map((p) => ({
    url: p.url,
    title: p.title,
    kind: `official website — ${p.category} page`,
    text: p.text,
    sourceType: "official_website",
    publishedAt: null,
  }));

  if (depth === "deep") {
    if (!tavilyConfigured()) warnings.push("Third-party source research skipped: web search provider not configured.");
    else if (!budget.take("web")) warnings.push("Third-party source research skipped: web-search limit reached.");
    else {
      try {
        const site = domainOf(b.website);
        const results = await tavilySearch(`"${b.name}" ${b.city ?? b.region ?? ""}`.trim(), { maxResults: 6, excludeDomains: site ? [site] : undefined, signal });
        for (const r of results.filter((r) => !isDirectory(r.url) || r.content.length > 200)) {
          docs.push({ url: r.url, title: r.title, kind: "third-party web source", text: r.content, sourceType: "third_party", publishedAt: r.published_date ?? null });
        }
      } catch (e) {
        warnings.push(`Third-party research failed: ${(e as Error).message}`);
      }
    }
  }

  // Keep extraction-derived evidence (structured data, meta descriptions); replace earlier model-derived evidence.
  const sections: ReportSection[] = REPORT_SECTIONS.map((s) => ({ key: s.key, title: s.title, body: null, evidenceIds: [] }));
  const bySection = (k: ReportSectionKey) => sections.find((s) => s.key === k)!;
  let confidence: CompanyReport["confidence"] = "low";
  let confidenceRationale = "";
  let model: string | null = null;

  if (!docs.length) {
    warnings.push("No source documents were available to research.");
    confidenceRationale = "No website pages or third-party sources could be retrieved.";
  } else if (!llmConfigured()) {
    warnings.push("Language model not configured — the report contains only directly extracted facts.");
    confidenceRationale = "Only structured data and descriptions published on the official website were extracted; no synthesis was performed.";
  } else if (!budget.take("llm")) {
    warnings.push("Model-based research skipped: model-call limit for this search reached.");
    confidenceRationale = "Research limit reached before synthesis.";
  } else {
    const prompt = buildPrompt(b, budgetDocs(docs, depth === "deep" ? 7000 : 5000, depth === "deep" ? 32_000 : 20_000), cfg.qualification.offeringDescription, cfg.qualification.needKeywords);
    const result = await llmJson<LlmResearch>(SYSTEM_PROMPT, prompt, { signal, maxTokens: depth === "deep" ? 3000 : 2000 });
    model = llmModelName();
    // Drop previous model-derived evidence before inserting the new set.
    clearEvidence(businessId, "model");
    let downgraded = 0;
    for (const c of Array.isArray(result.claims) ? result.claims : []) {
      if (!c || typeof c.claim !== "string" || !REPORT_SECTIONS.some((s) => s.key === c.section)) continue;
      const doc = docs.find((d) => d.url === c.source_url);
      let classification: EvidenceClass = ["verified_fact", "third_party", "inference", "hypothesis"].includes(c.classification) ? c.classification : "hypothesis";
      let excerpt = typeof c.excerpt === "string" ? c.excerpt : null;
      // Evidence must be grounded: the excerpt has to appear in the cited document.
      if (classification !== "hypothesis" && (!doc || !excerpt || !excerptIsGrounded(doc.text, excerpt))) {
        classification = "hypothesis";
        excerpt = null;
        downgraded++;
      }
      if (classification === "verified_fact" && doc?.sourceType === "third_party") classification = "third_party";
      if (classification === "third_party" && doc?.sourceType === "official_website") classification = "verified_fact";
      const grounded = classification !== "hypothesis" && doc;
      const id = insertEvidence({
        businessId,
        section: c.section,
        claim: c.claim.slice(0, 600),
        classification,
        sourceUrl: grounded ? doc.url : null,
        sourceTitle: grounded ? doc.title : null,
        sourceType: grounded ? doc.sourceType : "model_inference",
        excerpt,
        publishedAt: grounded ? doc.publishedAt : null,
        retrievedAt: grounded ? nowIso() : null,
      });
      bySection(c.section).evidenceIds.push(id);
    }
    if (downgraded) warnings.push(`${downgraded} claim(s) could not be matched to source text and are shown as hypotheses.`);
    for (const s of sections) {
      const body = result.sections?.[s.key];
      s.body = typeof body === "string" && body.trim() ? body.trim() : null;
    }
    if (result.size_band && (SIZE_BANDS as readonly string[]).includes(result.size_band) && getBusiness(businessId).sizeEvidenceClass !== "verified_fact") {
      updateBusiness(businessId, { size_estimate: `${result.size_band} employees (estimate)`, size_evidence_class: "inference" });
    }
    confidence = result.confidence && ["high", "medium", "low"].includes(result.confidence) ? result.confidence : "low";
    confidenceRationale = result.confidence_rationale ?? "";
    // Never report high confidence when the model's citations did not hold up.
    if (downgraded > 2 && confidence === "high") confidence = "medium";
  }

  const contacts = listContacts(businessId);
  const missing: string[] = [];
  if (!b.website) missing.push("Official website not identified.");
  if (!contacts.some((c) => c.email)) missing.push("No public email address found.");
  if (!contacts.some((c) => c.phone) && !b.phone) missing.push("No public phone number found.");
  if (!getBusiness(businessId).sizeEstimate) missing.push("Company size not published.");
  if (missing.length) {
    const s = bySection("missing_information");
    s.body = [s.body, ...missing.map((m) => `• ${m}`)].filter(Boolean).join("\n");
  }

  const report: CompanyReport = { businessId, generatedAt: nowIso(), depth, model, confidence, confidenceRationale, sections, warnings };
  saveReport(report);
  logActivity({ businessId, type: "research_completed", message: `${depth === "deep" ? "Deep" : "Standard"} research completed${model ? ` (${model})` : " (extraction only)"}.` });
  return { warnings, report };
}

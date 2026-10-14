import { haversineMeters, STAGE_LABELS } from "../../shared/domain";
import type { CreateSearchInput, ResearchStatus, SearchRecord, StageKey } from "../../shared/types";
import { toMeters } from "../../shared/domain";
import { all, run, tx } from "../db";
import { discoverBusinesses, type DiscoveredBusiness } from "../providers/discovery";
import { reverse } from "../providers/geocode";
import { getBusiness, updateBusiness, upsertDiscovered } from "../repo/businesses";
import { logActivity } from "../repo/research";
import { addIssue, bumpCounters, getSearch, insertSearch, patchSearch, setCounters, setStage } from "../repo/searches";
import { getConfig } from "../repo/workspace";
import { Budget, enrichFromWebsite, identifyWebsite, researchCompany } from "../research/researcher";
import { industryLabel } from "../../shared/industries";
import { HttpError, mapLimit, newId, nowIso } from "../util";
import { analyzeBusiness } from "./analyze";
import { cancel, isAbort, lanes, registerController, releaseController } from "./runner";

const MAX_RADIUS_M = 100_000;

export function createSearch(input: CreateSearchInput): SearchRecord {
  const settings = getConfig().research;
  const radiusMeters = toMeters(input.radius, input.unit);
  if (!(radiusMeters > 0) || radiusMeters > MAX_RADIUS_M) throw new HttpError(400, "invalid_radius", "Radius must be greater than 0 and at most 100 km (62 mi).");
  if (settings.supportedCountries.length && input.location.countryCode && !settings.supportedCountries.includes(input.location.countryCode))
    throw new HttpError(400, "unsupported_country", `Searches in ${input.location.country ?? input.location.countryCode} are not enabled for this workspace.`);
  const maxBusinesses = Math.min(input.maxBusinesses ?? settings.maxBusinessesPerSearch, settings.maxBusinessesPerSearch, 1000);
  const industriesText = input.industries.length ? input.industries.slice(0, 2).map(industryLabel).join(", ") + (input.industries.length > 2 ? ` +${input.industries.length - 2}` : "") : "All industries";
  const name = input.name?.trim() || `${industriesText} near ${input.location.label.split(",")[0]}`;
  const id = newId("srch");
  insertSearch({
    id,
    name,
    location: input.location,
    radiusMeters,
    unit: input.unit,
    industries: input.industries,
    depth: input.depth,
    maxBusinesses,
    status: "queued",
    createdAt: nowIso(),
  });
  lanes.search.push(() => runSearch(id));
  return getSearch(id);
}

export function cancelSearch(id: string): SearchRecord {
  const s = getSearch(id);
  if (s.status !== "queued" && s.status !== "running") throw new HttpError(409, "not_running", "This search is not running.");
  if (!cancel(id)) {
    // Queued but not started yet.
    patchSearch(id, { status: "cancelled", finished_at: nowIso() });
  }
  return getSearch(id);
}

function noteIssue(searchId: string, provider: string, message: string) {
  const s = getSearch(searchId);
  if (s.issues.some((i) => i.message === message.slice(0, 400))) return;
  addIssue(searchId, provider, message);
}

/** Collapse the same place mapped twice (e.g. a node and a building outline) into one record. */
export function dedupe(items: DiscoveredBusiness[]): DiscoveredBusiness[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const kept: DiscoveredBusiness[] = [];
  for (const b of items) {
    const dup = kept.find((k) => k.ref === b.ref || (norm(k.name) === norm(b.name) && haversineMeters(k.lat, k.lon, b.lat, b.lon) < 75));
    if (!dup) kept.push(b);
    else {
      dup.website ??= b.website;
      dup.phone ??= b.phone;
      dup.email ??= b.email;
      dup.address ??= b.address;
    }
  }
  return kept;
}

async function runSearch(id: string) {
  const search = getSearch(id);
  if (search.status === "cancelled") return;
  const controller = registerController(id);
  const signal = controller.signal;
  const settings = getConfig().research;
  const budget = new Budget(settings.maxLlmCallsPerSearch, settings.maxWebSearchCallsPerSearch);
  patchSearch(id, { status: "running", started_at: nowIso() });
  let stage: StageKey = "resolve_location";
  const enter = (k: StageKey) => {
    stage = k;
    setStage(id, k, "running");
  };
  const done = (k: StageKey, detail: string | null = null) => setStage(id, k, "completed", detail);
  const stages = new Set(search.stages.map((s) => s.key));

  try {
    // 1. Location
    enter("resolve_location");
    const loc = search.location;
    if (!loc.countryCode) {
      try {
        const r = await reverse(loc.lat, loc.lon, signal);
        run(`UPDATE searches SET location = ? WHERE id = ?`, [JSON.stringify({ ...loc, country: r.country, countryCode: r.countryCode, region: r.region }), id]);
      } catch (e) {
        if (isAbort(e)) throw e;
        noteIssue(id, "Nominatim", `Could not determine the country for the search center: ${(e as Error).message}`);
      }
    }
    done("resolve_location", getSearch(id).location.label);

    // 2. Discovery
    enter("discover");
    const loc2 = getSearch(id).location;
    const found = await discoverBusinesses({
      lat: loc2.lat,
      lon: loc2.lon,
      radiusMeters: search.radiusMeters,
      industries: search.industries,
      limit: search.maxBusinesses,
      country: loc2.country,
      countryCode: loc2.countryCode,
      signal,
    });
    patchSearch(id, { discovery_provider: found.provider });
    found.warnings.forEach((w) => noteIssue(id, "Discovery", w));
    setCounters(id, { discovered: found.businesses.length });
    done("discover", `${found.businesses.length} places from ${found.provider}`);

    // 3. Dedupe + persist (closest first, capped)
    enter("dedupe");
    const unique = dedupe(found.businesses)
      .map((b) => ({ b, d: haversineMeters(loc2.lat, loc2.lon, b.lat, b.lon) }))
      .filter((x) => x.d <= search.radiusMeters)
      .sort((a, b) => a.d - b.d);
    const capped = unique.slice(0, search.maxBusinesses);
    if (unique.length > capped.length) noteIssue(id, "Limits", `${unique.length - capped.length} additional businesses were found but not kept (limit: ${search.maxBusinesses} per search).`);
    const ids: string[] = [];
    tx(() => {
      for (const { b, d } of capped) {
        const { id: bid } = upsertDiscovered(b);
        ids.push(bid);
        run(`INSERT OR REPLACE INTO search_results (search_id, business_id, distance_m) VALUES (?,?,?)`, [id, bid, d]);
      }
    });
    const websitesFromListings = ids.filter((bid) => getBusiness(bid).website).length;
    setCounters(id, { unique: ids.length, websites: websitesFromListings });
    done("dedupe", `${found.businesses.length - unique.length} duplicates or out-of-radius results removed`);
    logActivity({ searchId: id, type: "search_discovered", message: `${ids.length} businesses discovered.` });

    // 4. Websites
    enter("identify_websites");
    if (search.depth === "fast") {
      done("identify_websites", "Websites from map listings only (Fast mode)");
    } else {
      const missing = ids.filter((bid) => !getBusiness(bid).website);
      await mapLimit(
        missing,
        4,
        async (bid) => {
          try {
            const r = await identifyWebsite(getBusiness(bid), budget, signal);
            r.warnings.forEach((w) => noteIssue(id, "Website lookup", w));
            if (r.found) bumpCounters(id, { websites: 1 });
          } catch (e) {
            if (isAbort(e)) throw e;
            noteIssue(id, "Website lookup", (e as Error).message);
          }
        },
        signal,
      );
      done("identify_websites", `${missing.length} businesses had no listed website`);
    }

    // 5. Contacts
    if (stages.has("enrich_contacts")) {
      enter("enrich_contacts");
      const withSite = ids.filter((bid) => getBusiness(bid).website);
      for (const bid of withSite) updateBusiness(bid, { research_status: "enrichment_pending" });
      const maxPages = search.depth === "deep" ? Math.max(settings.maxPagesPerCompany, 10) : settings.maxPagesPerCompany;
      await mapLimit(
        withSite,
        settings.crawlConcurrency,
        async (bid) => {
          try {
            const r = await enrichFromWebsite(bid, maxPages, signal);
            bumpCounters(id, { contacts: r.contactsAdded });
            if (r.pagesRetrieved === 0) {
              bumpCounters(id, { failed: 1 });
              updateBusiness(bid, { research_status: "failed" });
            }
          } catch (e) {
            if (isAbort(e)) throw e;
            bumpCounters(id, { failed: 1 });
            updateBusiness(bid, { research_status: "failed" });
            noteIssue(id, "Website crawler", (e as Error).message);
          }
        },
        signal,
      );
      done("enrich_contacts", `${withSite.length} websites inspected`);
    }

    // 6. Research
    if (stages.has("research")) {
      enter("research");
      const eligible = ids.filter((bid) => {
        const b = getBusiness(bid);
        return search.depth === "deep" ? b.researchStatus !== "failed" || !b.website : b.researchStatus === "enrichment_pending";
      });
      const skipped = ids.length - eligible.length;
      if (skipped) bumpCounters(id, { skipped });
      await mapLimit(
        eligible,
        3,
        async (bid) => {
          updateBusiness(bid, { research_status: "research_in_progress" });
          try {
            const r = await researchCompany(bid, search.depth, budget, signal);
            const status: ResearchStatus = r.warnings.length ? "completed_with_warnings" : "completed";
            updateBusiness(bid, { research_status: status, last_researched_at: nowIso() });
            bumpCounters(id, { researched: 1 });
            r.warnings.filter((w) => /limit|not configured/i.test(w)).forEach((w) => noteIssue(id, "Research", w));
          } catch (e) {
            if (isAbort(e)) throw e;
            updateBusiness(bid, { research_status: "failed" });
            bumpCounters(id, { failed: 1 });
            noteIssue(id, "Research", (e as Error).message);
          }
        },
        signal,
      );
      done("research", `${eligible.length} companies researched, ${skipped} skipped (no retrievable website)`);
    }

    // 7. Opportunities
    if (stages.has("analyze_opportunities")) {
      enter("analyze_opportunities");
      for (const bid of ids) {
        if (signal.aborted) break;
        analyzeBusiness(bid);
      }
      done("analyze_opportunities", "Scores computed with the workspace qualification criteria");
    }

    // 8. Finish
    enter("prepare_results");
    const final = getSearch(id);
    done("prepare_results");
    patchSearch(id, { status: final.issues.length ? "completed_with_warnings" : "completed", finished_at: nowIso(), current_stage: null });
    logActivity({ searchId: id, type: "search_completed", message: `Search “${final.name}” completed.` });
  } catch (e) {
    const cancelled = signal.aborted;
    setStage(id, stage, cancelled ? "skipped" : "failed", cancelled ? "Cancelled" : (e as Error).message);
    for (const s of getSearch(id).stages) if (s.status === "pending") setStage(id, s.key, "skipped", cancelled ? "Cancelled" : "Not run");
    // Businesses left mid-research go back to a truthful state.
    const stuck = all<{ business_id: string }>(
      `SELECT sr.business_id FROM search_results sr JOIN businesses b ON b.id = sr.business_id WHERE sr.search_id = ? AND b.research_status IN ('enrichment_pending','research_in_progress')`,
      [id],
    );
    for (const { business_id } of stuck) updateBusiness(business_id, { research_status: getBusiness(business_id).website ? "website_identified" : "discovered" });
    patchSearch(id, {
      status: cancelled ? "cancelled" : "failed",
      error: cancelled ? null : `${STAGE_LABELS[stage]} failed: ${(e as Error).message}`,
      finished_at: nowIso(),
    });
  } finally {
    releaseController(id);
  }
}

/** Businesses in a finished search whose research failed — candidates for retry. */
export function failedBusinessIds(id: string): string[] {
  const s = getSearch(id);
  if (s.status === "running" || s.status === "queued") throw new HttpError(409, "running", "Wait for the search to finish before retrying.");
  return all<{ business_id: string }>(
    `SELECT sr.business_id FROM search_results sr JOIN businesses b ON b.id = sr.business_id WHERE sr.search_id = ? AND b.research_status = 'failed'`,
    [id],
  ).map((r) => r.business_id);
}

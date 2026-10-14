import type { ResearchDepth } from "../../shared/types";
import { getBusiness, updateBusiness } from "../repo/businesses";
import { getJob, insertJob, listJobs, logActivity, patchJob } from "../repo/research";
import { getConfig } from "../repo/workspace";
import { Budget, enrichFromWebsite, identifyWebsite, researchCompany } from "../research/researcher";
import { HttpError, nowIso } from "../util";
import { analyzeBusiness } from "./analyze";
import { cancel, isAbort, lanes, registerController, releaseController } from "./runner";

/** Queue research for businesses. Skips businesses that already have an active job. */
export function queueResearch(businessIds: string[], depth: ResearchDepth, searchId: string | null = null): { queued: string[]; skipped: number } {
  const queued: string[] = [];
  const active = new Set(listJobs({ active: true, limit: 10_000 }).map((j) => j.businessId));
  for (const bid of businessIds) {
    getBusiness(bid);
    if (active.has(bid)) continue;
    const jobId = insertJob(bid, depth, searchId);
    updateBusiness(bid, { research_status: "enrichment_pending" });
    logActivity({ businessId: bid, type: "research_queued", message: `${depth === "deep" ? "Deep" : depth === "fast" ? "Fast" : "Standard"} research queued.` });
    lanes.research.push(() => runResearchJob(jobId));
    queued.push(jobId);
  }
  return { queued, skipped: businessIds.length - queued.length };
}

export function cancelResearch(jobId: string) {
  const job = getJob(jobId);
  if (job.status !== "queued" && job.status !== "running") throw new HttpError(409, "not_running", "This research job is not running.");
  if (!cancel(jobId)) {
    patchJob(jobId, { status: "cancelled", finished_at: nowIso() });
    const b = getBusiness(job.businessId);
    updateBusiness(b.id, { research_status: b.lastResearchedAt ? "completed" : b.website ? "website_identified" : "discovered" });
  }
  return getJob(jobId);
}

async function runResearchJob(jobId: string) {
  const job = getJob(jobId);
  if (job.status !== "queued") return;
  const controller = registerController(jobId);
  const signal = controller.signal;
  const settings = getConfig().research;
  // A single-company job gets a small dedicated budget.
  const budget = new Budget(2, 3);
  const bid = job.businessId;
  const warnings: string[] = [];
  patchJob(jobId, { status: "running", stage: "Identifying official website" });
  try {
    const w = await identifyWebsite(getBusiness(bid), budget, signal);
    warnings.push(...w.warnings);
    if (getBusiness(bid).website && job.depth !== "fast") {
      patchJob(jobId, { stage: "Inspecting website" });
      const r = await enrichFromWebsite(bid, job.depth === "deep" ? Math.max(settings.maxPagesPerCompany, 10) : settings.maxPagesPerCompany, signal);
      warnings.push(...r.warnings);
    }
    if (job.depth !== "fast") {
      patchJob(jobId, { stage: "Researching company" });
      updateBusiness(bid, { research_status: "research_in_progress" });
      const r = await researchCompany(bid, job.depth, budget, signal);
      warnings.push(...r.warnings);
    }
    patchJob(jobId, { stage: "Analyzing opportunity" });
    analyzeBusiness(bid);
    updateBusiness(bid, {
      research_status: job.depth === "fast" ? (getBusiness(bid).website ? "website_identified" : "discovered") : warnings.length ? "completed_with_warnings" : "completed",
      last_researched_at: job.depth === "fast" ? getBusiness(bid).lastResearchedAt : nowIso(),
    });
    patchJob(jobId, { status: "completed", stage: null, finished_at: nowIso(), error: warnings.length ? warnings.join(" ") : null });
  } catch (e) {
    const cancelled = signal.aborted || isAbort(e);
    const b = getBusiness(bid);
    updateBusiness(bid, { research_status: cancelled ? (b.lastResearchedAt ? "completed" : b.website ? "website_identified" : "discovered") : "failed" });
    patchJob(jobId, { status: cancelled ? "cancelled" : "failed", error: cancelled ? null : (e as Error).message, finished_at: nowIso() });
    if (!cancelled) logActivity({ businessId: bid, type: "research_failed", message: `Research failed: ${(e as Error).message}` });
  } finally {
    releaseController(jobId);
  }
}

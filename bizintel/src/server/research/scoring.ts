import { expandIndustries, industryGroupOf } from "../../shared/industries";
import type { Business, CompanyReport, Contact, Evidence, Opportunity, QualificationConfig, ScoreComponent } from "../../shared/types";

export interface ScoringInput {
  business: Business;
  contacts: Contact[];
  evidence: Evidence[];
  report: CompanyReport | null;
  pageText: string;
  config: QualificationConfig;
}

const sizeMatches = (estimate: string | null, targets: string[]) => {
  if (!estimate) return null;
  return targets.some((t) => estimate.replace(/,/g, "").includes(t.replace(/,/g, "")));
};

/** Deterministic, explainable qualification score. Weights and targets come from workspace configuration. */
export function scoreBusiness(input: ScoringInput): { score: number; components: ScoreComponent[]; needEvidence: Evidence[] } {
  const { business: b, contacts, evidence, report, config } = input;
  const components: ScoreComponent[] = [];
  let needEvidence: Evidence[] = [];

  for (const c of config.criteria.filter((c) => c.enabled && c.weight > 0)) {
    let value = 0;
    let rationale = "";
    switch (c.key) {
      case "industry_fit": {
        if (!config.targetIndustries.length) {
          value = 0.5;
          rationale = "No target industries configured — neutral.";
        } else {
          const leaves = new Set(expandIndustries(config.targetIndustries).map((l) => l.key));
          const groups = new Set(config.targetIndustries.map((k) => k.split(".")[0]));
          if (b.industry && leaves.has(b.industry)) {
            value = 1;
            rationale = "Industry is one of the configured targets.";
          } else if (b.industry && groups.has(industryGroupOf(b.industry)?.key ?? "")) {
            value = 0.5;
            rationale = "Adjacent to a target industry group.";
          } else rationale = b.industry ? "Industry is outside the configured targets." : "Industry could not be classified.";
        }
        break;
      }
      case "size_fit": {
        if (!config.targetSizes.length) {
          value = 0.5;
          rationale = "No target company sizes configured — neutral.";
        } else {
          const m = sizeMatches(b.sizeEstimate, config.targetSizes);
          value = m === null ? 0.25 : m ? 1 : 0;
          rationale = m === null ? "Company size unknown." : m ? `Size (${b.sizeEstimate}) matches a target band.` : `Size (${b.sizeEstimate}) is outside the target bands.`;
          if (m && b.sizeEvidenceClass !== "verified_fact") {
            value = 0.75;
            rationale += " Size is an estimate.";
          }
        }
        break;
      }
      case "geo_fit": {
        if (!config.targetCountries.length) {
          value = 0.5;
          rationale = "No target countries configured — neutral.";
        } else {
          value = b.countryCode && config.targetCountries.includes(b.countryCode) ? 1 : 0;
          rationale = value ? `Located in a target country (${b.countryCode}).` : `Not in a target country (${b.countryCode ?? "unknown"}).`;
        }
        break;
      }
      case "need_signals": {
        if (!config.needKeywords.length) {
          rationale = "No need keywords configured, so needs cannot be assessed.";
        } else {
          const kws = config.needKeywords.map((k) => k.toLowerCase());
          needEvidence = evidence.filter((e) => e.classification !== "hypothesis" && kws.some((k) => `${e.claim} ${e.excerpt ?? ""}`.toLowerCase().includes(k)));
          const pageHits = kws.filter((k) => input.pageText.toLowerCase().includes(k));
          const hits = new Set([...needEvidence.flatMap((e) => kws.filter((k) => `${e.claim} ${e.excerpt ?? ""}`.toLowerCase().includes(k))), ...pageHits]);
          value = Math.min(1, hits.size / Math.min(3, kws.length));
          rationale = hits.size
            ? `Sources mention: ${[...hits].join(", ")}. A mention indicates relevance, not a confirmed need.`
            : "No source text mentions the configured need keywords.";
        }
        break;
      }
      case "contactability": {
        const hasEmail = Boolean(b.email) || contacts.some((x) => x.email);
        const hasPhone = Boolean(b.phone) || contacts.some((x) => x.phone);
        value = (hasEmail ? 0.5 : 0) + (hasPhone ? 0.3 : 0) + (b.website ? 0.2 : 0);
        rationale = [hasEmail ? "public email" : "no public email", hasPhone ? "public phone" : "no public phone", b.website ? "website" : "no website"].join(", ");
        rationale = rationale[0].toUpperCase() + rationale.slice(1) + ".";
        break;
      }
      case "research_confidence": {
        value = !report ? 0 : report.confidence === "high" ? 1 : report.confidence === "medium" ? 0.6 : 0.3;
        rationale = report ? `Research confidence is ${report.confidence}.` : "Not yet researched.";
        break;
      }
    }
    components.push({ key: c.key, label: c.label, weight: c.weight, value, rationale });
  }
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const score = totalWeight ? Math.round((components.reduce((s, c) => s + c.weight * c.value, 0) / totalWeight) * 100) : 0;
  return { score, components, needEvidence };
}

export function buildOpportunity(input: ScoringInput, existing: Opportunity | null): Opportunity {
  const { score, components, needEvidence } = scoreBusiness(input);
  const { business: b, report, config } = input;
  const opp = report?.sections.find((s) => s.key === "opportunities");
  const gaps: string[] = [];
  if (!report) gaps.push("Company has not been researched yet.");
  report?.sections
    .find((s) => s.key === "missing_information")
    ?.body?.split("\n")
    .map((l) => l.replace(/^•\s*/, "").trim())
    .filter(Boolean)
    .forEach((g) => gaps.push(g));
  if (config.needKeywords.length && !needEvidence.length) gaps.push("No direct evidence of the configured needs.");

  const questions = [
    ...(b.sizeEstimate ? [] : ["How large is the team, and how is it organized?"]),
    ...config.needKeywords.slice(0, 3).map((k) => `How do you currently handle ${k}?`),
    "What are the main operational priorities for the next 12 months?",
  ].slice(0, 4);

  const hasContact = Boolean(b.email || b.phone || input.contacts.length);
  const qualified = score >= config.qualifiedThreshold;
  const nextAction = !report
    ? "Run research to gather evidence."
    : !hasContact
      ? "Find a public contact route before outreach."
      : qualified
        ? "Review the evidence, then prepare an outreach draft."
        : "Review manually or deprioritize.";

  const status = existing?.overriddenBy ? existing.qualificationStatus : qualified ? "qualified" : b.qualificationStatus === "disqualified" ? "disqualified" : "needs_review";

  return {
    businessId: b.id,
    businessName: b.name,
    score,
    components,
    summary: report?.sections.find((s) => s.key === "executive_summary")?.body ?? null,
    opportunity: opp?.body ?? null,
    evidenceIds: [...new Set([...needEvidence.map((e) => e.id), ...(opp?.evidenceIds ?? [])])],
    gaps,
    questions,
    confidence: report?.confidence ?? "low",
    nextAction,
    qualificationStatus: status,
    overriddenBy: existing?.overriddenBy ?? null,
    updatedAt: new Date().toISOString(),
  };
}

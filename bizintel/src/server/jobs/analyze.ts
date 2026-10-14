import { getBusiness, updateBusiness } from "../repo/businesses";
import { getOpportunity, getReport, listContacts, listEvidence, pageTexts, saveOpportunity } from "../repo/research";
import { getConfig } from "../repo/workspace";
import { buildOpportunity } from "../research/scoring";
import type { Opportunity } from "../../shared/types";

export function analyzeBusiness(businessId: string): Opportunity {
  const business = getBusiness(businessId);
  const opp = buildOpportunity(
    {
      business,
      contacts: listContacts(businessId),
      evidence: listEvidence(businessId),
      report: getReport(businessId),
      pageText: pageTexts(businessId)
        .map((p) => p.text)
        .join("\n")
        .slice(0, 200_000),
      config: getConfig().qualification,
    },
    getOpportunity(businessId),
  );
  saveOpportunity(opp);
  updateBusiness(businessId, { opportunity_score: opp.score, qualification_status: opp.qualificationStatus });
  return opp;
}

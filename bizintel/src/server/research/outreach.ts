import type { OutreachDraft } from "../../shared/types";
import { llmConfigured, llmJson, llmModelName } from "../providers/llm";
import { getBusiness } from "../repo/businesses";
import { insertDraft } from "../repo/outreach";
import { listContacts, listEvidence, logActivity } from "../repo/research";
import { getConfig } from "../repo/workspace";
import { HttpError } from "../util";

interface DraftReply {
  subject: string;
  body: string;
  follow_up: string;
  discovery_question: string;
  evidence_ids_used: string[];
}

const SYSTEM = `You write short, respectful first-touch B2B emails for a human to review and edit before sending.
Rules:
- Personalize ONLY with the numbered facts provided. Never state anything about the company that is not in those facts.
- Do not claim the company has a problem; at most, ask whether a topic is relevant to them.
- No invented statistics, customer names, or urgency. No flattery.
- 90–140 words for the body. Plain text. Include a placeholder [Your name] for the signature.
- List the ids of the facts you actually used in "evidence_ids_used".
Reply with one JSON object: {"subject","body","follow_up","discovery_question","evidence_ids_used"}.`;

export async function generateDraft(businessId: string, contactId: string | null, signal?: AbortSignal): Promise<OutreachDraft> {
  if (!llmConfigured()) throw new HttpError(409, "llm_not_configured", "Drafting requires a language model. Configure one under Data Sources, or start a blank draft.");
  const b = getBusiness(businessId);
  const cfg = getConfig().qualification;
  if (!cfg.offeringDescription.trim()) throw new HttpError(409, "offering_missing", "Describe your offering under Settings → Qualification before generating drafts.");
  const facts = listEvidence(businessId).filter((e) => e.classification === "verified_fact" || e.classification === "third_party");
  if (!facts.length) throw new HttpError(409, "no_evidence", "This company has no source-backed facts yet. Run research first so drafts can be personalized truthfully.");
  const contact = contactId ? listContacts(businessId).find((c) => c.id === contactId) : null;
  const factList = facts.slice(0, 15).map((f) => `[${f.id}] ${f.claim}`).join("\n");
  const reply = await llmJson<DraftReply>(
    SYSTEM,
    `Sender's offering: ${cfg.offeringDescription}
Recipient company: ${b.name} (${b.category ?? "business"}, ${b.city ?? b.country ?? ""})
Recipient: ${contact?.name ? `${contact.name}${contact.title ? `, ${contact.title}` : ""}` : "the team (no named contact)"}

Facts (only these may be used):
${factList}`,
    { signal, maxTokens: 900 },
  );
  if (typeof reply.subject !== "string" || typeof reply.body !== "string") throw new HttpError(502, "bad_model_reply", "The model returned an incomplete draft. Try regenerating.");
  const validIds = new Set(facts.map((f) => f.id));
  const draft = insertDraft({
    businessId,
    contactId: contact?.id ?? null,
    subject: reply.subject.trim(),
    body: reply.body.trim(),
    followUp: (reply.follow_up ?? "").trim(),
    discoveryQuestion: (reply.discovery_question ?? "").trim(),
    evidenceIds: (reply.evidence_ids_used ?? []).filter((id) => validIds.has(id)),
    model: llmModelName(),
  });
  logActivity({ businessId, type: "draft_generated", message: "Outreach draft generated." });
  return draft;
}

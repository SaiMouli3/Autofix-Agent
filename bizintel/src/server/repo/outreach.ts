import type { OutreachDraft } from "../../shared/types";
import { all, get, run } from "../db";
import { newId, notFound, nowIso, parseJson } from "../util";

interface DraftRow {
  id: string;
  business_id: string;
  contact_id: string | null;
  subject: string;
  body: string;
  follow_up: string;
  discovery_question: string;
  evidence_ids: string;
  model: string | null;
  created_at: string;
  updated_at: string;
}

const toDraft = (r: DraftRow): OutreachDraft => ({
  id: r.id,
  businessId: r.business_id,
  contactId: r.contact_id,
  subject: r.subject,
  body: r.body,
  followUp: r.follow_up,
  discoveryQuestion: r.discovery_question,
  evidenceIds: parseJson(r.evidence_ids, []),
  model: r.model,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function insertDraft(d: Omit<OutreachDraft, "id" | "createdAt" | "updatedAt">): OutreachDraft {
  const id = newId("drf");
  const now = nowIso();
  run(
    `INSERT INTO outreach_drafts (id, business_id, contact_id, subject, body, follow_up, discovery_question, evidence_ids, model, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, d.businessId, d.contactId, d.subject, d.body, d.followUp, d.discoveryQuestion, JSON.stringify(d.evidenceIds), d.model, now, now],
  );
  return getDraft(id);
}

export function getDraft(id: string): OutreachDraft {
  const r = get<DraftRow>(`SELECT * FROM outreach_drafts WHERE id = ?`, [id]);
  if (!r) throw notFound("Draft");
  return toDraft(r);
}

export function updateDraft(id: string, patch: Partial<Pick<OutreachDraft, "subject" | "body" | "followUp" | "discoveryQuestion" | "contactId">>): OutreachDraft {
  const d = getDraft(id);
  run(`UPDATE outreach_drafts SET subject=?, body=?, follow_up=?, discovery_question=?, contact_id=?, updated_at=? WHERE id=?`, [
    patch.subject ?? d.subject,
    patch.body ?? d.body,
    patch.followUp ?? d.followUp,
    patch.discoveryQuestion ?? d.discoveryQuestion,
    patch.contactId !== undefined ? patch.contactId : d.contactId,
    nowIso(),
    id,
  ]);
  return getDraft(id);
}

export function deleteDraft(id: string) {
  if (run(`DELETE FROM outreach_drafts WHERE id = ?`, [id]).changes === 0) throw notFound("Draft");
}

export const listDrafts = (businessId?: string) =>
  (businessId
    ? all<DraftRow>(`SELECT * FROM outreach_drafts WHERE business_id = ? ORDER BY updated_at DESC`, [businessId])
    : all<DraftRow & { name: string }>(`SELECT d.* FROM outreach_drafts d ORDER BY d.updated_at DESC LIMIT 200`)
  ).map(toDraft);

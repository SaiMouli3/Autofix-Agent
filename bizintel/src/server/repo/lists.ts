import type { SavedList } from "../../shared/types";
import { all, get, run, tx } from "../db";
import { HttpError, newId, notFound, nowIso } from "../util";

interface ListRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  count: number;
}

const toList = (r: ListRow): SavedList => ({ id: r.id, name: r.name, description: r.description, count: r.count, createdAt: r.created_at, updatedAt: r.updated_at });

const SELECT = `SELECT l.*, (SELECT COUNT(*) FROM list_members m WHERE m.list_id = l.id) AS count FROM lists l`;

export const listLists = () => all<ListRow>(`${SELECT} ORDER BY l.updated_at DESC`).map(toList);

export function getList(id: string): SavedList {
  const r = get<ListRow>(`${SELECT} WHERE l.id = ?`, [id]);
  if (!r) throw notFound("List");
  return toList(r);
}

export function createList(name: string, description: string | null): SavedList {
  if (get(`SELECT 1 FROM lists WHERE name = ? COLLATE NOCASE`, [name])) throw new HttpError(409, "duplicate_name", `A list named “${name}” already exists.`);
  const id = newId("lst");
  const now = nowIso();
  run(`INSERT INTO lists (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)`, [id, name, description, now, now]);
  return getList(id);
}

export function updateList(id: string, patch: { name?: string; description?: string | null }): SavedList {
  getList(id);
  if (patch.name && get(`SELECT 1 FROM lists WHERE name = ? COLLATE NOCASE AND id != ?`, [patch.name, id]))
    throw new HttpError(409, "duplicate_name", `A list named “${patch.name}” already exists.`);
  run(`UPDATE lists SET name = COALESCE(?, name), description = CASE WHEN ? THEN ? ELSE description END, updated_at = ? WHERE id = ?`, [
    patch.name ?? null,
    patch.description !== undefined ? 1 : 0,
    patch.description ?? null,
    nowIso(),
    id,
  ]);
  return getList(id);
}

export function deleteList(id: string) {
  getList(id);
  run(`DELETE FROM lists WHERE id = ?`, [id]);
}

/** Adds members, ignoring businesses already on the list. Returns how many were newly added. */
export function addMembers(id: string, businessIds: string[]): { added: number; alreadyPresent: number } {
  getList(id);
  let added = 0;
  tx(() => {
    for (const b of businessIds) added += Number(run(`INSERT OR IGNORE INTO list_members (list_id, business_id, added_at) VALUES (?,?,?)`, [id, b, nowIso()]).changes);
    run(`UPDATE lists SET updated_at = ? WHERE id = ?`, [nowIso(), id]);
  });
  return { added, alreadyPresent: businessIds.length - added };
}

export function removeMembers(id: string, businessIds: string[]): number {
  getList(id);
  let removed = 0;
  tx(() => {
    for (const b of businessIds) removed += Number(run(`DELETE FROM list_members WHERE list_id = ? AND business_id = ?`, [id, b]).changes);
    run(`UPDATE lists SET updated_at = ? WHERE id = ?`, [nowIso(), id]);
  });
  return removed;
}

export const listsForBusiness = (businessId: string) =>
  all<ListRow>(`${SELECT} JOIN list_members lm ON lm.list_id = l.id AND lm.business_id = ? ORDER BY l.name`, [businessId]).map(toList);

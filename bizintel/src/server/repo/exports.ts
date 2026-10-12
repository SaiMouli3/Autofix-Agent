import type { CreateExportInput, ExportRecord } from "../../shared/types";
import { all, get, run } from "../db";
import { newId, notFound, nowIso, parseJson } from "../util";

interface ExportRow {
  id: string;
  name: string;
  format: string;
  scope: string;
  columns: string;
  include: string;
  status: string;
  record_count: number | null;
  error: string | null;
  file_path: string | null;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

const toExport = (r: ExportRow): ExportRecord => ({
  id: r.id,
  name: r.name,
  format: r.format as ExportRecord["format"],
  scope: parseJson(r.scope, { kind: "all" }),
  columns: parseJson(r.columns, []),
  include: parseJson(r.include, []),
  status: r.status as ExportRecord["status"],
  recordCount: r.record_count,
  error: r.error,
  createdAt: r.created_at,
  completedAt: r.completed_at,
  expiresAt: r.expires_at,
});

export function insertExport(input: CreateExportInput & { name: string }): ExportRecord {
  const id = newId("exp");
  run(`INSERT INTO exports (id, name, format, scope, columns, include, status, created_at) VALUES (?,?,?,?,?,?, 'queued', ?)`, [
    id,
    input.name,
    input.format,
    JSON.stringify(input.scope),
    JSON.stringify(input.columns),
    JSON.stringify(input.include),
    nowIso(),
  ]);
  return getExport(id);
}

export function getExportRow(id: string): ExportRow {
  const r = get<ExportRow>(`SELECT * FROM exports WHERE id = ?`, [id]);
  if (!r) throw notFound("Export");
  return r;
}

export const getExport = (id: string) => toExport(getExportRow(id));
export const listExports = (limit = 100) => all<ExportRow>(`SELECT * FROM exports ORDER BY created_at DESC LIMIT ?`, [limit]).map(toExport);

export function patchExport(id: string, patch: Partial<Pick<ExportRow, "status" | "record_count" | "error" | "file_path" | "completed_at" | "expires_at">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  run(`UPDATE exports SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => patch[k] ?? null), id]);
}

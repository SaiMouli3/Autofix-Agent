import { stagesForDepth } from "../../shared/domain";
import type { ProviderIssue, SearchCounters, SearchRecord, SearchStage, StageKey, StageStatus } from "../../shared/types";
import { all, get, run } from "../db";
import { notFound, nowIso, parseJson } from "../util";

interface SearchRow {
  id: string;
  name: string;
  location: string;
  radius_m: number;
  unit: string;
  industries: string;
  depth: string;
  max_businesses: number;
  status: string;
  current_stage: string | null;
  stages: string;
  counters: string;
  issues: string;
  discovery_provider: string | null;
  error: string | null;
  saved: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export const EMPTY_COUNTERS: SearchCounters = { discovered: 0, unique: 0, websites: 0, contacts: 0, researched: 0, failed: 0, skipped: 0 };

function toSearch(r: SearchRow): SearchRecord {
  return {
    id: r.id,
    name: r.name,
    location: JSON.parse(r.location),
    radiusMeters: r.radius_m,
    unit: r.unit as SearchRecord["unit"],
    industries: parseJson(r.industries, []),
    depth: r.depth as SearchRecord["depth"],
    maxBusinesses: r.max_businesses,
    status: r.status as SearchRecord["status"],
    currentStage: r.current_stage as StageKey | null,
    stages: parseJson(r.stages, []),
    counters: { ...EMPTY_COUNTERS, ...parseJson(r.counters, {}) },
    issues: parseJson(r.issues, []),
    discoveryProvider: r.discovery_provider,
    error: r.error,
    saved: r.saved === 1,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

export function insertSearch(s: Omit<SearchRecord, "stages" | "counters" | "issues" | "currentStage" | "discoveryProvider" | "error" | "startedAt" | "finishedAt" | "saved">) {
  const stages: SearchStage[] = stagesForDepth(s.depth).map((key) => ({ key, status: "pending", startedAt: null, finishedAt: null, detail: null }));
  run(
    `INSERT INTO searches (id, name, location, radius_m, unit, industries, depth, max_businesses, status, stages, counters, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [s.id, s.name, JSON.stringify(s.location), s.radiusMeters, s.unit, JSON.stringify(s.industries), s.depth, s.maxBusinesses, s.status, JSON.stringify(stages), JSON.stringify(EMPTY_COUNTERS), s.createdAt],
  );
}

export function getSearch(id: string): SearchRecord {
  const row = get<SearchRow>(`SELECT * FROM searches WHERE id = ?`, [id]);
  if (!row) throw notFound("Search");
  return toSearch(row);
}

export function listSearches(limit = 50, offset = 0): { items: SearchRecord[]; total: number } {
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM searches`)?.n ?? 0;
  return { items: all<SearchRow>(`SELECT * FROM searches ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset]).map(toSearch), total };
}

export function patchSearch(id: string, patch: Partial<{ status: string; current_stage: string | null; error: string | null; started_at: string; finished_at: string; discovery_provider: string; saved: number; name: string }>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  run(`UPDATE searches SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => patch[k] ?? null), id]);
}

export function setStage(id: string, key: StageKey, status: StageStatus, detail: string | null = null) {
  const s = getSearch(id);
  const stages = s.stages.map((st) =>
    st.key !== key
      ? st
      : {
          ...st,
          status,
          detail: detail ?? st.detail,
          startedAt: status === "running" ? nowIso() : st.startedAt,
          finishedAt: status === "completed" || status === "failed" || status === "skipped" ? nowIso() : st.finishedAt,
        },
  );
  run(`UPDATE searches SET stages = ?, current_stage = ? WHERE id = ?`, [JSON.stringify(stages), status === "running" ? key : s.currentStage, id]);
}

export function bumpCounters(id: string, delta: Partial<SearchCounters>) {
  const s = getSearch(id);
  const next = { ...s.counters };
  for (const [k, v] of Object.entries(delta)) next[k as keyof SearchCounters] += v ?? 0;
  run(`UPDATE searches SET counters = ? WHERE id = ?`, [JSON.stringify(next), id]);
}

export function setCounters(id: string, values: Partial<SearchCounters>) {
  const s = getSearch(id);
  run(`UPDATE searches SET counters = ? WHERE id = ?`, [JSON.stringify({ ...s.counters, ...values }), id]);
}

export function addIssue(id: string, provider: string, message: string) {
  const s = getSearch(id);
  const issues: ProviderIssue[] = [...s.issues, { provider, message: message.slice(0, 400), at: nowIso() }].slice(-50);
  run(`UPDATE searches SET issues = ? WHERE id = ?`, [JSON.stringify(issues), id]);
}

export function deleteSearch(id: string) {
  getSearch(id);
  run(`DELETE FROM searches WHERE id = ?`, [id]);
}

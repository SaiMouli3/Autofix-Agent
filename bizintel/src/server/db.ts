import { createRequire } from "node:module";
import type { SupportedValueType as SQLInputValue } from "node:sqlite";
import { config } from "./config";

// Loaded via require so bundlers/test runners that don't know the built-in `node:sqlite` leave it alone.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export const db = new DatabaseSync(config.dbPath);

db.exec("PRAGMA busy_timeout = 5000;");
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS searches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  radius_m REAL NOT NULL,
  unit TEXT NOT NULL,
  industries TEXT NOT NULL,
  depth TEXT NOT NULL,
  max_businesses INTEGER NOT NULL,
  status TEXT NOT NULL,
  current_stage TEXT,
  stages TEXT NOT NULL,
  counters TEXT NOT NULL,
  issues TEXT NOT NULL DEFAULT '[]',
  discovery_provider TEXT,
  error TEXT,
  saved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  source_provider TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  industry TEXT,
  address TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  country_code TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  website TEXT,
  website_source TEXT,
  phone TEXT,
  phone_source TEXT,
  email TEXT,
  email_source TEXT,
  size_estimate TEXT,
  size_evidence_class TEXT,
  research_status TEXT NOT NULL DEFAULT 'discovered',
  opportunity_score REAL,
  qualification_status TEXT NOT NULL DEFAULT 'unreviewed',
  tags TEXT NOT NULL DEFAULT '[]',
  saved INTEGER NOT NULL DEFAULT 0,
  raw TEXT,
  last_researched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_provider, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_businesses_name ON businesses(name);
CREATE INDEX IF NOT EXISTS idx_businesses_industry ON businesses(industry);
CREATE INDEX IF NOT EXISTS idx_businesses_updated ON businesses(updated_at);

CREATE TABLE IF NOT EXISTS search_results (
  search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  distance_m REAL,
  PRIMARY KEY (search_id, business_id)
);
CREATE INDEX IF NOT EXISTS idx_search_results_business ON search_results(business_id);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT,
  title TEXT,
  type TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  location TEXT,
  source_url TEXT,
  source_label TEXT NOT NULL,
  verification TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  UNIQUE (business_id, email, phone)
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  retrieved_at TEXT,
  extracted_fields TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  text TEXT,
  UNIQUE (business_id, url)
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL DEFAULT 'model',
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  claim TEXT NOT NULL,
  classification TEXT NOT NULL,
  source_url TEXT,
  source_title TEXT,
  source_type TEXT NOT NULL,
  excerpt TEXT,
  published_at TEXT,
  retrieved_at TEXT,
  reviewed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_evidence_business ON evidence(business_id);

CREATE TABLE IF NOT EXISTS reports (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  search_id TEXT,
  depth TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS list_members (
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (list_id, business_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  business_id TEXT,
  search_id TEXT,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_business ON activity(business_id, created_at);

CREATE TABLE IF NOT EXISTS outreach_drafts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  contact_id TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  follow_up TEXT NOT NULL,
  discovery_question TEXT NOT NULL,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL,
  scope TEXT NOT NULL,
  columns TEXT NOT NULL,
  include TEXT NOT NULL,
  status TEXT NOT NULL,
  record_count INTEGER,
  error TEXT,
  file_path TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS provider_stats (
  provider TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_error TEXT,
  last_error_at TEXT,
  rate_limited_until TEXT
);
`);

export type { SQLInputValue };
type Params = Record<string, SQLInputValue> | SQLInputValue[];

function bind(params?: Params): SQLInputValue[] | [Record<string, SQLInputValue>] {
  if (!params) return [];
  return Array.isArray(params) ? params : [params];
}

export function all<T>(sql: string, params?: Params): T[] {
  return db.prepare(sql).all(...(bind(params) as SQLInputValue[])) as T[];
}

export function get<T>(sql: string, params?: Params): T | undefined {
  return db.prepare(sql).get(...(bind(params) as SQLInputValue[])) as T | undefined;
}

export function run(sql: string, params?: Params) {
  return db.prepare(sql).run(...(bind(params) as SQLInputValue[]));
}

export function tx<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Mark work left running by a previous process as interrupted, so the UI never shows phantom progress. */
export function recoverInterruptedWork() {
  const msg = "Interrupted: the server restarted while this job was running.";
  run(`UPDATE searches SET status='failed', error=?, finished_at=? WHERE status IN ('queued','running')`, [msg, new Date().toISOString()]);
  run(`UPDATE research_jobs SET status='failed', error=?, finished_at=? WHERE status IN ('queued','running')`, [msg, new Date().toISOString()]);
  run(`UPDATE businesses SET research_status='failed' WHERE research_status IN ('research_in_progress','enrichment_pending')`);
  run(`UPDATE exports SET status='failed', error=? WHERE status IN ('queued','running')`, [msg]);
}

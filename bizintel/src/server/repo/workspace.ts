import { DEFAULT_QUALIFICATION, DEFAULT_RESEARCH_SETTINGS } from "../../shared/domain";
import type { WorkspaceConfig } from "../../shared/types";
import { get, run } from "../db";

const KEY = "workspace_config";

export const DEFAULT_CONFIG: WorkspaceConfig = {
  branding: {
    productName: process.env.BIZINTEL_PRODUCT_NAME ?? "Atlas Intelligence",
    workspaceName: process.env.BIZINTEL_WORKSPACE_NAME ?? "Default workspace",
    logoUrl: null,
    theme: "system",
  },
  research: DEFAULT_RESEARCH_SETTINGS,
  qualification: DEFAULT_QUALIFICATION,
};

export function getConfig(): WorkspaceConfig {
  const row = get<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, [KEY]);
  if (!row) return DEFAULT_CONFIG;
  const stored = JSON.parse(row.value) as Partial<WorkspaceConfig>;
  return {
    branding: { ...DEFAULT_CONFIG.branding, ...stored.branding },
    research: { ...DEFAULT_CONFIG.research, ...stored.research },
    qualification: { ...DEFAULT_CONFIG.qualification, ...stored.qualification },
  };
}

export function saveConfig(next: WorkspaceConfig) {
  run(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [KEY, JSON.stringify(next)]);
}

const MODEL_KEY = "llm_model";

/** Model picked in Data Sources; falls back to LLM_MODEL from the environment. */
export function activeModel(): string | null {
  return get<{ value: string }>(`SELECT value FROM kv WHERE key = ?`, [MODEL_KEY])?.value ?? process.env.LLM_MODEL ?? null;
}

export function setActiveModel(model: string | null) {
  if (model) run(`INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [MODEL_KEY, model]);
  else run(`DELETE FROM kv WHERE key = ?`, [MODEL_KEY]);
}

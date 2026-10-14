import ExcelJS from "exceljs";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { domainOf, RESEARCH_STATUS_LABELS } from "../../shared/domain";
import { industryLabel } from "../../shared/industries";
import type { Business, BusinessQuery, CreateExportInput, ExportRecord, ExportScope } from "../../shared/types";
import { all } from "../db";
import { config } from "../config";
import { businessIdsFor, getBusiness } from "../repo/businesses";
import { getExportRow, insertExport, patchExport } from "../repo/exports";
import { getOpportunity, getReport, listContactsFor, listEvidence, listPages } from "../repo/research";
import { listDrafts } from "../repo/outreach";
import { HttpError, nowIso } from "../util";
import { lanes } from "./runner";

export const EXPORT_COLUMNS: { key: string; label: string; get: (b: Business) => string | number | null }[] = [
  { key: "name", label: "Business name", get: (b) => b.name },
  { key: "industry", label: "Industry", get: (b) => (b.industry ? industryLabel(b.industry) : null) },
  { key: "category", label: "Category", get: (b) => b.category },
  { key: "address", label: "Address", get: (b) => b.address },
  { key: "city", label: "City", get: (b) => b.city },
  { key: "region", label: "State / region", get: (b) => b.region },
  { key: "country", label: "Country", get: (b) => b.country ?? b.countryCode },
  { key: "lat", label: "Latitude", get: (b) => b.lat },
  { key: "lon", label: "Longitude", get: (b) => b.lon },
  { key: "website", label: "Website", get: (b) => b.website },
  { key: "website_source", label: "Website source", get: (b) => b.websiteSource },
  { key: "phone", label: "Phone", get: (b) => b.phone },
  { key: "phone_source", label: "Phone source", get: (b) => b.phoneSource },
  { key: "email", label: "Email", get: (b) => b.email },
  { key: "email_source", label: "Email source", get: (b) => b.emailSource },
  { key: "size", label: "Company size", get: (b) => b.sizeEstimate },
  { key: "research_status", label: "Research status", get: (b) => RESEARCH_STATUS_LABELS[b.researchStatus] },
  { key: "score", label: "Opportunity score", get: (b) => b.opportunityScore },
  { key: "qualification", label: "Qualification", get: (b) => b.qualificationStatus.replace("_", " ") },
  { key: "tags", label: "Tags", get: (b) => b.tags.join(", ") },
  { key: "last_researched", label: "Last researched", get: (b) => b.lastResearchedAt },
  { key: "source", label: "Listing source", get: (b) => `${b.sourceProvider}:${b.sourceRef}` },
];

const MAX_ROWS = 50_000;

function scopeToQuery(scope: ExportScope): BusinessQuery | string[] {
  switch (scope.kind) {
    case "all":
      return {};
    case "search":
      return { searchId: scope.searchId };
    case "list":
      return { listId: scope.listId };
    case "selected":
      return scope.businessIds;
    case "qualified":
      return { qualification: ["qualified"] };
    case "with_email":
      return { hasEmail: true };
    case "with_phone":
      return { hasPhone: true };
    case "researched":
      return { researchStatus: ["completed", "completed_with_warnings"] };
  }
}

export function createExport(input: CreateExportInput): ExportRecord {
  const cols = input.columns.filter((c) => EXPORT_COLUMNS.some((x) => x.key === c));
  if (!cols.length) throw new HttpError(400, "no_columns", "Select at least one column.");
  const name = input.name?.trim() || `Export ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const rec = insertExport({ ...input, columns: cols, name });
  lanes.export.push(() => runExport(rec.id));
  return rec;
}

/** CSV cell escaping, including protection against spreadsheet formula injection. */
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function runExport(id: string) {
  const row = getExportRow(id);
  patchExport(id, { status: "running" });
  const scope = JSON.parse(row.scope) as ExportScope;
  const columns = JSON.parse(row.columns) as string[];
  const include = new Set(JSON.parse(row.include) as string[]);
  const filePath = resolve(config.exportDir, `${id}.${row.format}`);
  try {
    const q = scopeToQuery(scope);
    const ids = (Array.isArray(q) ? q : businessIdsFor(q, MAX_ROWS)).slice(0, MAX_ROWS);
    const colDefs = columns.map((k) => EXPORT_COLUMNS.find((c) => c.key === k)!).filter(Boolean);
    const extra: { label: string; get: (b: Business) => string | number | null }[] = [];
    if (include.has("overview")) extra.push({ label: "Executive summary", get: (b) => getReport(b.id)?.sections.find((s) => s.key === "executive_summary")?.body ?? null });
    if (include.has("scores"))
      extra.push({
        label: "Score breakdown",
        get: (b) =>
          getOpportunity(b.id)
            ?.components.map((c) => `${c.label}: ${Math.round(c.value * 100)}% (weight ${c.weight})`)
            .join("; ") ?? null,
      });
    if (include.has("opportunities")) extra.push({ label: "Potential opportunity", get: (b) => getOpportunity(b.id)?.opportunity ?? null });
    if (include.has("website_research"))
      extra.push({
        label: "Pages retrieved",
        get: (b) =>
          listPages(b.id)
            .filter((p) => p.status === "retrieved")
            .map((p) => p.url)
            .join(" ") || null,
      });
    if (include.has("sources"))
      extra.push({
        label: "Source URLs",
        get: (b) => [...new Set(listEvidence(b.id).map((e) => e.sourceUrl).filter(Boolean))].join(" ") || null,
      });
    if (include.has("outreach")) extra.push({ label: "Latest outreach draft", get: (b) => {
      const d = listDrafts(b.id)[0];
      return d ? `${d.subject}\n\n${d.body}` : null;
    } });
    if (include.has("contacts") && row.format === "csv")
      extra.push({
        label: "All public contacts",
        get: (b) =>
          listContactsFor([b.id])
            .map((c) => [c.email, c.phone].filter(Boolean).join(" / ") + ` (${c.type}; ${c.sourceUrl ?? c.sourceLabel})`)
            .join(" | ") || null,
      });

    const headers = [...colDefs.map((c) => c.label), ...extra.map((e) => e.label)];
    const BATCH = 500;
    if (row.format === "csv") {
      const out = createWriteStream(filePath, { encoding: "utf8" });
      out.write("﻿" + headers.map(csvCell).join(",") + "\r\n");
      for (let i = 0; i < ids.length; i += BATCH) {
        for (const bid of ids.slice(i, i + BATCH)) {
          const b = getBusiness(bid);
          out.write([...colDefs.map((c) => c.get(b)), ...extra.map((e) => e.get(b))].map(csvCell).join(",") + "\r\n");
        }
        await new Promise((r) => setImmediate(r));
      }
      await new Promise<void>((res, rej) => out.end((err?: Error | null) => (err ? rej(err) : res())));
    } else {
      const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true });
      const ws = wb.addWorksheet("Businesses", { views: [{ state: "frozen", ySplit: 1 }] });
      ws.columns = headers.map((h) => ({ header: h, width: Math.min(60, Math.max(12, h.length + 4)) }));
      ws.getRow(1).font = { bold: true };
      for (let i = 0; i < ids.length; i += BATCH) {
        for (const bid of ids.slice(i, i + BATCH)) {
          const b = getBusiness(bid);
          ws.addRow([...colDefs.map((c) => c.get(b)), ...extra.map((e) => e.get(b))]).commit();
        }
        await new Promise((r) => setImmediate(r));
      }
      ws.commit();
      if (include.has("contacts")) {
        const cs = wb.addWorksheet("Contacts", { views: [{ state: "frozen", ySplit: 1 }] });
        cs.columns = ["Business", "Website", "Type", "Name", "Title", "Email", "Phone", "Source", "Verification", "Last checked"].map((h) => ({ header: h, width: 22 }));
        cs.getRow(1).font = { bold: true };
        for (let i = 0; i < ids.length; i += BATCH) {
          const chunk = ids.slice(i, i + BATCH);
          const names = new Map(all<{ id: string; name: string; website: string | null }>(`SELECT id, name, website FROM businesses WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk).map((r) => [r.id, r]));
          for (const c of listContactsFor(chunk)) {
            const b = names.get(c.businessId);
            cs.addRow([b?.name, domainOf(b?.website), c.type, c.name, c.title, c.email, c.phone, c.sourceUrl ?? c.sourceLabel, c.verification, c.lastCheckedAt]).commit();
          }
        }
        cs.commit();
      }
      await wb.commit();
    }
    const expires = new Date(Date.now() + config.exportTtlDays * 86_400_000).toISOString();
    patchExport(id, { status: "completed", record_count: ids.length, file_path: filePath, completed_at: nowIso(), expires_at: expires });
  } catch (e) {
    await rm(filePath, { force: true });
    patchExport(id, { status: "failed", error: (e as Error).message, completed_at: nowIso() });
  }
}

export async function purgeExpiredExports() {
  const expired = all<{ id: string; file_path: string | null }>(`SELECT id, file_path FROM exports WHERE expires_at IS NOT NULL AND expires_at < ? AND file_path IS NOT NULL`, [nowIso()]);
  for (const e of expired) {
    if (e.file_path) await rm(e.file_path, { force: true });
    patchExport(e.id, { file_path: null });
  }
}

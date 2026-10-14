import type { PageCategory } from "../../shared/types";
import { config } from "../config";
import { recordFailure, recordSuccess } from "../providers/registry";
import { CATEGORY_PRIORITY, classifyPage, extractLinks, extractTitle, sameSite } from "./extract";

export interface FetchedPage {
  url: string;
  finalUrl: string;
  category: PageCategory;
  status: "retrieved" | "failed" | "blocked" | "skipped";
  httpStatus: number | null;
  html: string | null;
  title: string | null;
  error: string | null;
  retrievedAt: string;
}

const MAX_BYTES = 1_500_000;

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

export async function fetchPage(url: string, category: PageCategory, signal?: AbortSignal): Promise<FetchedPage> {
  const retrievedAt = new Date().toISOString();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": config.userAgent, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      recordFailure("website_crawler", `HTTP ${res.status} for ${new URL(url).hostname}`);
      const blocked = res.status === 401 || res.status === 403 || res.status === 429;
      return { url, finalUrl: res.url || url, category, status: blocked ? "blocked" : "failed", httpStatus: res.status, html: null, title: null, error: `HTTP ${res.status}`, retrievedAt };
    }
    if (!/html|xml/i.test(type)) {
      return { url, finalUrl: res.url || url, category, status: "skipped", httpStatus: res.status, html: null, title: null, error: `Not an HTML page (${type || "unknown type"})`, retrievedAt };
    }
    const html = await readLimited(res);
    recordSuccess("website_crawler");
    return { url, finalUrl: res.url || url, category, status: "retrieved", httpStatus: res.status, html, title: extractTitle(html), error: null, retrievedAt };
  } catch (e) {
    if (signal?.aborted) throw e;
    const err = e as Error & { cause?: { code?: string } };
    const reason = err.name === "TimeoutError" ? "Timed out after 15s" : (err.cause?.code ?? err.message);
    recordFailure("website_crawler", reason);
    return { url, finalUrl: url, category, status: "failed", httpStatus: null, html: null, title: null, error: reason, retrievedAt };
  }
}

/** Minimal robots.txt check for the generic user-agent group and our own. */
export async function robotsAllows(origin: string, signal?: AbortSignal): Promise<(path: string) => boolean> {
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": config.userAgent }, signal: AbortSignal.any([AbortSignal.timeout(6000), ...(signal ? [signal] : [])]) });
    if (!res.ok) return () => true;
    const text = (await res.text()).slice(0, 100_000);
    const disallow: string[] = [];
    let applies = false;
    for (const line of text.split(/\r?\n/)) {
      const [k, ...rest] = line.split(":");
      const key = k.trim().toLowerCase();
      const value = rest.join(":").split("#")[0].trim();
      if (key === "user-agent") applies = value === "*" || config.userAgent.toLowerCase().startsWith(value.toLowerCase());
      else if (applies && key === "disallow" && value) disallow.push(value);
    }
    return (path: string) => !disallow.some((d) => path.startsWith(d));
  } catch (e) {
    if (signal?.aborted) throw e;
    return () => true;
  }
}

/** Choose which internal pages to visit after the home page, by category priority. */
export function planPages(homeHtml: string, homeUrl: string, maxPages: number): { url: string; category: PageCategory }[] {
  const seen = new Set<string>([homeUrl.replace(/\/$/, "")]);
  const candidates: { url: string; category: PageCategory }[] = [];
  const perCategory = new Map<PageCategory, number>();
  for (const link of extractLinks(homeHtml, homeUrl)) {
    if (!sameSite(link.url, homeUrl)) continue;
    if (/\.(pdf|jpe?g|png|gif|zip|docx?|xlsx?|mp4|webp|svg)(\?|$)/i.test(link.url)) continue;
    const key = link.url.replace(/\/$/, "").replace(/\?.*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    const category = classifyPage(link.url, link.text);
    if (category === "other" || category === "home") continue;
    const n = perCategory.get(category) ?? 0;
    if (n >= 1) continue;
    perCategory.set(category, n + 1);
    candidates.push({ url: key, category });
  }
  candidates.sort((a, b) => CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category]);
  return candidates.slice(0, Math.max(0, maxPages - 1));
}

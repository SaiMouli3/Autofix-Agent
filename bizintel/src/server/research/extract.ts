// Pure HTML/text extraction helpers. No network access here so they can be unit tested.
import type { ContactType, PageCategory } from "../../shared/types";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+|#39);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() || null : null;
}

export function extractMetaDescription(html: string): string | null {
  const m = /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html) ?? /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html);
  return m ? decodeEntities(m[1]).trim() || null : null;
}

/** Convert HTML into readable text, keeping block boundaries as newlines. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export interface LinkRef {
  url: string;
  text: string;
}

export function extractLinks(html: string, baseUrl: string): LinkRef[] {
  const out: LinkRef[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)(?:#[^"']*)?["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const url = new URL(decodeEntities(m[1]), baseUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      url.hash = "";
      out.push({ url: url.toString(), text: htmlToText(m[2]).slice(0, 80) });
    } catch {
      /* ignore malformed hrefs */
    }
  }
  return out;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;
const IGNORED_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|^(example|test|user|name|your|email)@|@(example|domain|sentry|wixpress|sentry-next)\.|u00[0-9a-f]{2}/i;

export function extractEmails(html: string): string[] {
  const found = new Set<string>();
  const mailto = /mailto:([^"'?\s>]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = mailto.exec(html))) found.add(decodeURIComponent(decodeEntities(m[1])).toLowerCase());
  const text = decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " "))
    .replace(/\s*[[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, ".");
  for (const e of text.match(EMAIL_RE) ?? []) found.add(e.toLowerCase());
  const valid = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}$/;
  const out = new Set<string>();
  for (const e of found) {
    const clean = e.replace(/\.$/, "");
    if (valid.test(clean) && !IGNORED_EMAIL.test(clean)) out.add(clean);
  }
  return [...out];
}

/** Phone numbers published via tel: links, plus formatted numbers in visible text. */
export function extractPhones(html: string): string[] {
  const found = new Map<string, string>();
  const add = (raw: string) => {
    const cleaned = raw.replace(/[^\d+()\-.\s]/g, "").replace(/\s+/g, " ").trim();
    const digits = cleaned.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return;
    if (/^(\d)\1+$/.test(digits)) return;
    if (!found.has(digits.slice(-9))) found.set(digits.slice(-9), cleaned);
  };
  const tel = /href\s*=\s*["']tel:([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = tel.exec(html))) add(decodeURIComponent(m[1]));
  const text = htmlToText(html);
  // Require explicit phone formatting (separators or a leading +) to avoid matching IDs and prices.
  const re = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]\d{3,4}\b/g;
  for (const p of text.match(re) ?? []) add(p);
  return [...found.values()];
}

export function contactTypeFor(email: string): ContactType {
  const local = email.split("@")[0];
  if (/^(sales|bizdev|business|partners?|commercial|quotes?|orders?)\b/.test(local)) return "sales";
  if (/^(support|help|service|customerservice|care)\b/.test(local)) return "support";
  if (/^(info|hello|contact|office|enquir|inquir|admin|mail|team|general|reception)/.test(local)) return "general";
  if (/^(hr|jobs|careers|recruit|press|media|marketing|billing|accounts?|finance|legal|privacy)/.test(local)) return "department";
  return "person";
}

const CATEGORY_PATTERNS: [PageCategory, RegExp][] = [
  ["contact", /contact|kontakt|get-in-touch|reach-us|contacto/],
  ["about", /about|who-we-are|our-story|company|ueber-uns|uber-uns|qui-sommes/],
  ["services", /service|solutions|what-we-do|capabilit|expertise|practice-areas/],
  ["products", /product|shop|catalog|menu|pricing|store/],
  ["team", /team|people|leadership|staff|management|our-doctors|attorneys|board/],
  ["locations", /location|branches|offices|find-us|directions|stores/],
  ["careers", /career|jobs|join-us|hiring|vacanc|work-with-us/],
  ["case_studies", /case-stud|portfolio|projects|clients|testimonials|success-stor/],
  ["news", /news|press|blog|media|announcement|insights|updates/],
];

export function classifyPage(url: string, linkText = ""): PageCategory {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return "other";
  }
  if (path === "/" || path === "" || /^\/(index\.\w+|home)?\/?$/.test(path)) return "home";
  const hay = `${path} ${linkText.toLowerCase().replace(/\s+/g, "-")}`;
  for (const [cat, re] of CATEGORY_PATTERNS) if (re.test(hay)) return cat;
  return "other";
}

/** Priority used to choose which internal pages to crawl first. Lower is more important. */
export const CATEGORY_PRIORITY: Record<PageCategory, number> = {
  home: 0,
  contact: 1,
  about: 2,
  services: 3,
  products: 4,
  team: 5,
  locations: 6,
  case_studies: 7,
  news: 8,
  careers: 9,
  other: 20,
};

export interface OrgJsonLd {
  name?: string;
  description?: string;
  telephone?: string;
  email?: string;
  numberOfEmployees?: string;
  foundingDate?: string;
  areaServed?: string;
  sameAs?: string[];
}

/** Read schema.org Organization / LocalBusiness data published by the site itself. */
export function extractJsonLd(html: string): OrgJsonLd | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const nodes: Record<string, unknown>[] = [];
  const collect = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      nodes.push(o);
      if (o["@graph"]) collect(o["@graph"]);
    }
  };
  while ((m = re.exec(html))) {
    try {
      collect(JSON.parse(m[1].trim()));
    } catch {
      /* ignore invalid JSON-LD */
    }
  }
  const isOrg = (t: unknown) => {
    const types = Array.isArray(t) ? t : [t];
    return types.some((x) => typeof x === "string" && /Organization|LocalBusiness|Corporation|Store|Restaurant|ProfessionalService|MedicalBusiness|Dentist|LegalService|Hotel/i.test(x));
  };
  const org = nodes.find((n) => isOrg(n["@type"]));
  if (!org) return null;
  const str = (v: unknown): string | undefined => {
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.value === "number" || typeof o.value === "string") return String(o.value);
      if (o.minValue != null || o.maxValue != null) return [o.minValue, o.maxValue].filter((x) => x != null).join("–");
      if (typeof o.name === "string") return o.name;
    }
    return undefined;
  };
  return {
    name: str(org.name),
    description: str(org.description),
    telephone: str(org.telephone),
    email: str(org.email)?.replace(/^mailto:/i, ""),
    numberOfEmployees: str(org.numberOfEmployees),
    foundingDate: str(org.foundingDate),
    areaServed: Array.isArray(org.areaServed) ? org.areaServed.map(str).filter(Boolean).join(", ") : str(org.areaServed),
    sameAs: Array.isArray(org.sameAs) ? (org.sameAs.filter((s) => typeof s === "string") as string[]) : undefined,
  };
}

/** Find a short passage of text around the first occurrence of `needle`, for evidence excerpts. */
export function excerptAround(text: string, needle: string, radius = 140): string | null {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return null;
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + needle.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/** True if `excerpt` (whitespace-normalized) actually appears in `text`. Used to reject fabricated quotes. */
export function excerptIsGrounded(text: string, excerpt: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[“”"'’‘]/g, "").replace(/\s+/g, " ").replace(/…/g, "").trim();
  const e = norm(excerpt);
  if (e.length < 12) return false;
  return norm(text).includes(e);
}

export function sameSite(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, "");
    const hb = new URL(b).hostname.replace(/^www\./, "");
    return ha === hb;
  } catch {
    return false;
  }
}

import { describe, expect, it } from "vitest";
import { buildOverpassQuery, fromOsmTags } from "../src/server/providers/discovery";
import { expandIndustries } from "../src/shared/industries";
import { defaultUnitFor, haversineMeters, toMeters } from "../src/shared/domain";
import { csvCell } from "../src/server/jobs/exportJob";
import { dedupe } from "../src/server/jobs/searchJob";
import { matchOfficialSite } from "../src/server/research/researcher";
import { scoreBusiness } from "../src/server/research/scoring";
import { DEFAULT_QUALIFICATION } from "../src/shared/domain";
import type { Business } from "../src/shared/types";

describe("geo", () => {
  it("converts units and picks locale defaults", () => {
    expect(toMeters(1, "mi")).toBeCloseTo(1609.344);
    expect(defaultUnitFor("US")).toBe("mi");
    expect(defaultUnitFor("DE")).toBe("km");
  });
  it("computes great-circle distance", () => {
    expect(haversineMeters(51.5074, -0.1278, 48.8566, 2.3522) / 1000).toBeCloseTo(343.5, 0);
  });
});

describe("discovery", () => {
  it("expands groups into leaves", () => {
    expect(expandIndustries(["food"]).map((l) => l.key)).toContain("food.cafe");
    expect(expandIndustries([]).length).toBeGreaterThan(40);
  });
  it("builds a radius query grouped by tag key", () => {
    const q = buildOverpassQuery(expandIndustries(["food.cafe", "professional.legal"]), 30.2, -97.7, 1000, 10);
    expect(q).toContain('nwr["amenity"~"^(cafe)$"]["name"](around:1000,30.200000,-97.700000)');
    expect(q).toContain('nwr["office"~"^(lawyer|notary)$"]');
  });
  it("maps OSM tags without inventing missing values", () => {
    const b = fromOsmTags("node/1", 1, 2, { name: "Bean", amenity: "cafe", website: "bean.example" }, { country: "X", countryCode: "XX" })!;
    expect(b.website).toBe("https://bean.example/");
    expect(b.phone).toBeNull();
    expect(b.email).toBeNull();
    expect(b.industry).toBe("food.cafe");
  });
  it("collapses a node and building outline of the same place", () => {
    const base = fromOsmTags("node/1", 30, -97, { name: "Acme Law", office: "lawyer" }, { country: null, countryCode: null })!;
    const way = { ...base, ref: "way/2", lat: 30.0002, phone: "+1 555 0100" };
    const out = dedupe([base, way]);
    expect(out).toHaveLength(1);
    expect(out[0].phone).toBe("+1 555 0100");
  });
});

describe("official website matching", () => {
  it("requires a distinctive name token in the domain", () => {
    expect(matchOfficialSite("Paul Parsons Immigration Law", [{ url: "https://ailalawyer.com/x", title: "" }])).toBeNull();
    expect(matchOfficialSite("Franklin Barbecue", [{ url: "https://www.yelp.com/biz/franklin", title: "" }, { url: "https://franklinbbq.com/menu", title: "" }])?.url).toBe("https://franklinbbq.com/");
  });
});

describe("csv", () => {
  it("escapes quotes and neutralizes formulas", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
  });
});

describe("scoring", () => {
  const biz = (p: Partial<Business> = {}): Business => ({
    id: "b", name: "X", category: null, industry: "food.cafe", address: null, city: null, region: null, country: null, countryCode: "US", lat: 0, lon: 0,
    website: "https://x.com", websiteSource: null, phone: "+1", phoneSource: null, email: null, emailSource: null, sizeEstimate: null, sizeEvidenceClass: null,
    researchStatus: "completed", opportunityScore: null, qualificationStatus: "unreviewed", sourceProvider: "osm", sourceRef: "node/1", tags: [], saved: false,
    lastResearchedAt: null, createdAt: "", updatedAt: "", ...p,
  });
  it("explains every component and normalizes to 0–100", () => {
    const r = scoreBusiness({ business: biz(), contacts: [], evidence: [], report: null, pageText: "", config: { ...DEFAULT_QUALIFICATION, targetIndustries: ["food"], targetCountries: ["US"] } });
    expect(r.components).toHaveLength(6);
    expect(r.components.every((c) => c.rationale.length > 0)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.components.find((c) => c.key === "industry_fit")!.value).toBe(1);
  });
  it("does not count hypotheses as need evidence", () => {
    const ev = [{ id: "e", businessId: "b", section: "opportunities", claim: "They need online booking", classification: "hypothesis", sourceUrl: null, sourceTitle: null, sourceType: "model_inference", excerpt: null, publishedAt: null, retrievedAt: null, reviewed: false } as const];
    const r = scoreBusiness({ business: biz(), contacts: [], evidence: [...ev], report: null, pageText: "", config: { ...DEFAULT_QUALIFICATION, needKeywords: ["online booking"] } });
    expect(r.components.find((c) => c.key === "need_signals")!.value).toBe(0);
  });
});

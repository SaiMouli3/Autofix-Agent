import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Provider health is recorded in SQLite; keep it out of the dev database.
process.env.BIZINTEL_DATA_DIR = mkdtempSync(join(tmpdir(), "bizintel-test-"));
const { autocomplete, fromOsmPlaces } = await import("../src/server/providers/geocode");
const { config } = await import("../src/server/config");

const bengaluru = {
  osm_type: "relation", osm_id: 1, lat: "13.0342", lon: "77.5572", display_name: "560054, Bengaluru, Karnataka, India",
  addresstype: "postcode", boundingbox: ["13.02", "13.04", "77.54", "77.57"] as [string, string, string, string],
  address: { country: "India", country_code: "in", state: "Karnataka" },
};

function mockFetch(routes: (url: string) => Response) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    if (url.includes("photon")) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return routes(url);
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  config.locationiqApiKey = null;
});

describe("location autocomplete fallback", () => {
  it("maps Nominatim/LocationIQ places to suggestions", () => {
    const [s] = fromOsmPlaces([bengaluru]);
    expect(s).toMatchObject({ lat: 13.0342, lon: 77.5572, countryCode: "IN", region: "Karnataka", kind: "postcode", bbox: [13.02, 13.04, 77.54, 77.57] });
  });

  it("uses Nominatim when Photon refuses connections and no LocationIQ key is set", async () => {
    const calls = mockFetch(() => Response.json([bengaluru]));
    const items = await autocomplete("560054 a");
    expect(items[0].label).toContain("Bengaluru");
    expect(calls.some((u) => u.includes("nominatim") && u.includes("/search?"))).toBe(true);
  });

  it("prefers LocationIQ when a key is set, and treats its 404 as no results", async () => {
    config.locationiqApiKey = "test-key";
    const calls = mockFetch(() => Response.json({ error: "Unable to geocode" }, { status: 404 }));
    expect(await autocomplete("zzzz nowhere")).toEqual([]);
    expect(calls.some((u) => u.includes("api.locationiq.com/v1/autocomplete"))).toBe(true);
    expect(calls.some((u) => u.includes("nominatim"))).toBe(false);
  });

  it("does not fall back when asked to test Photon alone", async () => {
    mockFetch(() => Response.json([bengaluru]));
    await expect(autocomplete("London x", undefined, { fallback: false })).rejects.toThrow(/ECONNREFUSED/);
  });
});

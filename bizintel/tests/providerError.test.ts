import { describe, expect, it } from "vitest";
import { ProviderError } from "../src/server/providers/http";

describe("ProviderError", () => {
  it("is named so the API error handler answers 502 with the provider message, not a generic 500", () => {
    const e = new ProviderError("photon", "photon: HTTP 403", 403);
    expect(e.name).toBe("ProviderError");
    expect(e.status).toBe(403);
  });
});

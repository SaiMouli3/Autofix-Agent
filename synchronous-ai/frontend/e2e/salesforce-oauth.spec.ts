/**
 * Browser E2E for one-click OAuth sign-in, against the REAL platform backend (scripts/e2e.sh).
 *
 * The vendor is a TEST DOUBLE started below: a local server shaped like Salesforce's OAuth and REST
 * endpoints (consent page, PKCE S256 verification, instance_url, no expires_in, refresh-token
 * rotation). A real Salesforce org needs a human login and an External Client App, which CI
 * cannot provide. Everything on the platform side — UI, API, token storage, gateway — is real.
 */
import { expect, test } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";

const ADMIN = { email: "e2e-admin@acme-e2e.com", password: "E2e-Secret-Pass!9" };
const CLIENT = { id: "3MVG9-e2e-client", secret: "e2e-client-secret" };

type Vendor = { url: string; server: Server; codes: Map<string, any>; access: Set<string>; refresh: Set<string>; issued: string[] };

function startVendor(): Promise<Vendor> {
  const v = { codes: new Map(), access: new Set<string>(), refresh: new Set<string>(), issued: [] as string[] } as Vendor;
  const json = (res: any, code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  v.server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", v.url);
    if (req.method === "GET" && u.pathname === "/services/oauth2/authorize") {
      const p = Object.fromEntries(u.searchParams);
      if (p.client_id !== CLIENT.id || p.code_challenge_method !== "S256") return json(res, 400, { error: "invalid_request" });
      // A consent screen, as a real provider shows after login.
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><title>Allow access?</title><h1>Allow Synchronous Consulting AI to access your org?</h1>
        <p>Scopes: ${p.scope}</p><form method="post" action="/services/oauth2/consent">
        ${Object.entries(p).map(([k, val]) => `<input type="hidden" name="${k}" value="${String(val).replace(/"/g, "&quot;")}">`).join("")}
        <button type="submit">Allow</button></form>`);
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const f = Object.fromEntries(new URLSearchParams(raw));
      if (req.method === "POST" && u.pathname === "/services/oauth2/consent") {
        const code = "code-" + randomBytes(6).toString("hex");
        v.codes.set(code, { challenge: f.code_challenge, redirect_uri: f.redirect_uri });
        res.writeHead(302, { location: `${f.redirect_uri}?code=${code}&state=${encodeURIComponent(f.state)}` });
        return res.end();
      }
      if (req.method === "POST" && u.pathname === "/services/oauth2/token") {
        if (f.client_id !== CLIENT.id || f.client_secret !== CLIENT.secret) return json(res, 400, { error: "invalid_client" });
        if (f.grant_type === "authorization_code") {
          const c = v.codes.get(f.code);
          v.codes.delete(f.code);
          const digest = createHash("sha256").update(f.code_verifier ?? "").digest("base64url");
          if (!c || digest !== c.challenge || c.redirect_uri !== f.redirect_uri) return json(res, 400, { error: "invalid_grant" });
        } else if (f.grant_type === "refresh_token") {
          if (!v.refresh.delete(f.refresh_token)) return json(res, 400, { error: "invalid_grant" });
        } else return json(res, 400, { error: "unsupported_grant_type" });
        const at = "at-" + randomBytes(10).toString("hex"), rt = "rt-" + randomBytes(10).toString("hex");
        v.access.add(at); v.refresh.add(rt); v.issued.push(at, rt);
        return json(res, 200, { access_token: at, refresh_token: rt, scope: "api refresh_token", token_type: "Bearer", instance_url: v.url });
      }
      if (u.pathname === "/services/oauth2/revoke") return json(res, 200, {});
      if (u.pathname.startsWith("/services/data/")) {
        const token = (req.headers.authorization ?? "").replace("Bearer ", "");
        if (!v.access.has(token)) return json(res, 401, [{ errorCode: "INVALID_SESSION_ID" }]);
        if (u.pathname.endsWith("/query")) return json(res, 200, { totalSize: 1, done: true, records: [{ Id: "001", Name: "Acme" }] });
        return json(res, 200, { DailyApiRequests: { Max: 15000, Remaining: 14999 } });
      }
      json(res, 404, { error: "not_found" });
    });
  });
  return new Promise((resolve) => v.server.listen(0, "127.0.0.1", () => {
    v.url = `http://127.0.0.1:${(v.server.address() as AddressInfo).port}`;
    resolve(v);
  }));
}

let vendor: Vendor;
test.beforeAll(async () => { vendor = await startVendor(); });
test.afterAll(async () => { vendor?.server.close(); });

test("connect Salesforce with one-click OAuth sign-in", async ({ page }) => {
  // Sign in (or create the organization when this spec runs on its own).
  const status = await (await page.request.get("/api/auth/status")).json();
  const auth = status.needs_setup
    ? await page.request.post("/api/auth/setup", { data: { org_name: "Acme E2E", name: "Erin Admin", ...ADMIN } })
    : await page.request.post("/api/auth/login", { data: ADMIN });
  expect(auth.ok()).toBeTruthy();
  const csrf = (await page.context().cookies()).find((c) => c.name === "sca_csrf")?.value ?? "";

  // The connector gallery shows the callback URL to register in the External Client App.
  await page.goto("/integrations");
  await page.getByRole("button", { name: "Browse connectors" }).first().click();
  await page.getByRole("button", { name: /^Salesforce\s+Salesforce\s+HTTP API/ }).click();
  await expect(page.getByText(/\/api\/oauth\/callback$/).first()).toBeVisible();
  await page.getByRole("button", { name: "Add as proposed" }).click();
  await expect(page.getByRole("complementary", { name: "Salesforce details" })).toBeVisible();
  const created = (await (await page.request.get("/api/integrations")).json()).find((i: any) => i.name === "Salesforce");
  expect(created.oauth.connected).toBe(false);

  // Re-point the real connector definition at the local test double (hosts only; operations unchanged).
  const cfg = JSON.parse(JSON.stringify(created.config).split("https://login.salesforce.com").join(vendor.url));
  expect((await page.request.put(`/api/integrations/${created.id}`, { data: { config: cfg }, headers: { "x-csrf-token": csrf } })).ok()).toBeTruthy();

  // Enter the client credentials in the UI and connect.
  await page.goto(`/integrations?id=${created.id}`);
  const panel = page.getByRole("region", { name: "Sign-in" });
  await expect(panel.getByText("Not signed in")).toBeVisible();
  await panel.getByLabel("Consumer key (client ID)").fill(CLIENT.id);
  await panel.getByLabel("Consumer secret").fill(CLIENT.secret);
  await panel.getByRole("button", { name: "Save client" }).click();
  await expect(page.getByText("Client credentials stored encrypted")).toBeVisible();
  await panel.getByRole("button", { name: "Connect Salesforce" }).click();

  // The browser leaves the platform for the provider's consent screen…
  await expect(page.getByRole("heading", { name: /Allow Synchronous Consulting AI/ })).toBeVisible();
  expect(page.url()).toContain(`${vendor.url}/services/oauth2/authorize`);
  await page.getByRole("button", { name: "Allow" }).click();

  // …and returns signed in.
  await expect(page).toHaveURL(new RegExp(`/integrations\\?id=${created.id}`));
  await expect(page.getByText(/^Connected\. The platform now holds an encrypted/)).toBeVisible();
  await expect(panel.getByText("Signed in")).toBeVisible();
  await expect(panel.getByText(vendor.url, { exact: true })).toBeVisible(); // instance_url adopted as the API host

  // Activate and run a live test through the gateway with the stored token.
  await page.getByRole("button", { name: "Approve & activate" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText("Integration approved and activated")).toBeVisible();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/HTTP 200 from/).first()).toBeVisible();

  // Tokens and the client secret never reach the browser: not in the page, not in any API response.
  const html = await page.content();
  const api = await (await page.request.get(`/api/integrations/${created.id}`)).text();
  for (const secret of [...vendor.issued, CLIENT.secret]) {
    expect(html).not.toContain(secret);
    expect(api).not.toContain(secret);
  }

  // Disconnect revokes and forgets the tokens; the integration is disabled.
  await panel.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
  await expect(panel.getByText("Not signed in")).toBeVisible();
  const after = await (await page.request.get(`/api/integrations/${created.id}`)).json();
  expect(after.oauth.connected).toBe(false);
  expect(after.status).toBe("disabled");
});

/**
 * Browser E2E for one-click GitHub sign-in, against the REAL platform backend (scripts/e2e.sh).
 *
 * An administrator registers the organization's GitHub OAuth App once (Settings → Sign-in apps);
 * then clicking GitHub in the connector gallery goes straight to GitHub's authorization page.
 * GitHub's page itself is replaced by a stub (page.route) because CI has no GitHub account to log
 * in with; the token exchange that follows is covered by the backend test against a GitHub test
 * double (tests/test_oauth.py::test_github_one_click_sign_in_with_org_app).
 */
import { expect, test } from "@playwright/test";

const ADMIN = { email: "e2e-admin@acme-e2e.com", password: "E2e-Secret-Pass!9" };
const APP = { id: "Ov23liE2eClient01", secret: "e2e-github-app-secret" };

test("GitHub connects with one click after the org sign-in app is set up", async ({ page }) => {
  const status = await (await page.request.get("/api/auth/status")).json();
  const auth = status.needs_setup
    ? await page.request.post("/api/auth/setup", { data: { org_name: "Acme E2E", name: "Erin Admin", ...ADMIN } })
    : await page.request.post("/api/auth/login", { data: ADMIN });
  expect(auth.ok()).toBeTruthy();

  // 1. One-time setup by an administrator.
  await page.goto("/settings?tab=signin");
  const gh = page.getByRole("region", { name: "GitHub sign-in app" });
  await gh.getByRole("button", { name: /Set up|Replace/ }).click();
  await expect(gh.getByText(/\/api\/oauth\/callback$/)).toBeVisible();
  await gh.getByLabel("Client ID").fill(APP.id);
  await gh.getByLabel("Client secret").fill(APP.secret);
  await gh.getByRole("button", { name: "Save GitHub sign-in app" }).click();
  await expect(gh.getByText("Ready")).toBeVisible();

  // 2. Anyone: Browse connectors → GitHub → Connect GitHub goes straight to GitHub's sign-in page.
  let authorize: URL | null = null;
  await page.route("https://github.com/login/oauth/authorize**", (route) => {
    authorize = new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: "<title>GitHub (test stub)</title><h1>Sign in to GitHub</h1>" });
  });
  await page.goto("/integrations");
  await page.getByRole("button", { name: "Browse connectors" }).first().click();
  await page.getByRole("button", { name: "GitHub by GitHub", exact: true }).first().click();
  await expect(page.getByText(/no\s+token or client ID to copy/)).toBeVisible();
  await page.getByRole("button", { name: "Connect GitHub" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to GitHub" })).toBeVisible();

  expect(authorize).not.toBeNull();
  const q = authorize!.searchParams;
  expect(q.get("client_id")).toBe(APP.id);
  expect(q.get("scope")).toBe("repo read:user");
  expect(q.get("redirect_uri")).toMatch(/\/api\/oauth\/callback$/);
  expect(q.get("code_challenge_method")).toBe("S256");
  expect(q.get("state")!.length).toBeGreaterThanOrEqual(32);

  // The app secret never reaches the browser.
  const apps = await (await page.request.get("/api/integrations/sign-in-apps")).text();
  expect(apps).not.toContain(APP.secret);
  expect(authorize!.toString()).not.toContain(APP.secret);
});

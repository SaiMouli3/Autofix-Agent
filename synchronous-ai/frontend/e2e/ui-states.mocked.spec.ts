/**
 * MOCKED UI-STATE TESTS — these do NOT talk to a backend.
 *
 * Every /api request is answered by the fixtures below (shapes copied from real backend
 * responses) and the built bundle in ../dist is served from disk. They exist to exercise UI
 * states that are hard to produce on demand against a live system: empty data, server
 * errors, permission-limited roles, confirmation dialogs, keyboard and mobile navigation.
 * The real end-to-end flow lives in platform.spec.ts.
 */
import { expect, Page, Route, test } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const TYPES: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".html": "text/html", ".png": "image/png" };

const ADMIN_PERMS = ["agents:read", "agents:write", "approvals:decide", "approvals:read", "artifacts:read", "audit:read", "integrations:read", "integrations:write",
  "knowledge:read", "knowledge:write", "providers:read", "providers:test", "providers:write", "schedules:read", "schedules:write", "settings:write",
  "tasks:cancel", "tasks:create", "tasks:read", "teams:read", "teams:write", "usage:read", "users:write"];
const VIEWER_PERMS = ["agents:read", "approvals:read", "artifacts:read", "integrations:read", "knowledge:read", "providers:read", "schedules:read", "tasks:read", "teams:read", "usage:read"];

const me = (role: "org_admin" | "viewer") => ({
  user: { id: "u1", email: "mock@example.com", name: "Morgan Mock", must_change_password: false },
  org: { id: "o1", name: "Mock Org", slug: "mock-org", settings: { require_distinct_approver: false } },
  role, role_label: role === "viewer" ? "Viewer" : "Organization Administrator",
  permissions: role === "viewer" ? VIEWER_PERMS : ADMIN_PERMS, csrf_token: "mock-csrf", env: "test", runtime: "local",
});

const EMPTY_OVERVIEW = {
  agents: { total: 0, active: 0 }, tasks: { running: 0, queued: 0, waiting_for_approval: 0, completed: 0, failed: 0, cancelled: 0 }, pending_approvals: 0,
  usage_30d: { prompt_tokens: 0, completion_tokens: 0, estimated_cost_usd: 0, records: 0, llm_requests: 0, records_without_pricing: 0, cost_note: "" },
  recent_activity: [], recent_artifacts: [], integration_errors: [], providers: [],
  system: { database: true, runtime: "local", docker_available: null, uptime_s: 60, worker_id: "mock", max_workers: 4, active_workers: 0,
    dispatcher_alive: true, watchdog_alive: true, parked_for_approval: 0 },
};

const PENDING_APPROVAL = {
  id: "ap1", task_id: "t1", task_title: "Clean the build directory", agent_id: "a1", agent_name: "Ops Bot", kind: "tool_action",
  summary: "Run rm -rf ./build", status: "pending", requested_by: "someone-else",
  details: { actions: [{ tool: "terminal", summary: "Run rm -rf ./build", args: { command: "rm -rf ./build" }, risk: "HIGH" }], policy: "always" },
  requested_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString(),
};

type Handler = (route: Route, url: URL) => Promise<void> | void;
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockApp(page: Page, opts: { role?: "org_admin" | "viewer"; overrides?: Record<string, Handler> } = {}) {
  const role = opts.role ?? "org_admin";
  // The real backend sets this readable cookie at sign-in; the UI echoes it in x-csrf-token.
  await page.context().addCookies([{ name: "sca_csrf", value: "mock-csrf", url: "http://sca.mock" }]);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.startsWith("/api/")) {
      for (const [prefix, h] of Object.entries(opts.overrides ?? {})) if (path === prefix || path.startsWith(prefix + "/")) return h(route, url);
      if (path === "/api/stream") return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": mock\n\n" });
      if (path === "/api/auth/status") return json(route, { needs_setup: false, bootstrap_token_required: false, env: "test" });
      if (path === "/api/auth/me") return json(route, me(role));
      if (path === "/api/overview") return json(route, EMPTY_OVERVIEW);
      if (path === "/api/teams" || path === "/api/providers" || path === "/api/integrations") return json(route, []);
      if (["/api/agents", "/api/tasks", "/api/approvals", "/api/sessions"].includes(path)) return json(route, { items: [], total: 0 });
      return json(route, { detail: "not found" }, 404);
    }
    let file = join(DIST, path);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
  });
}

test.describe("mocked UI states", () => {
  test.use({ baseURL: "http://sca.mock" });

  test("empty workspace shows guidance instead of blank panels", async ({ page }) => {
    await mockApp(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("No agents are working")).toBeVisible();
    await expect(page.getByText("No agents yet.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create your first agent" })).toBeVisible();
  });

  test("server error shows a retryable error state", async ({ page }) => {
    let fail = true;
    await mockApp(page, { overrides: { "/api/approvals": (r, url) => (fail && url.searchParams.get("page_size") === "20" ? json(r, { detail: "database unavailable" }, 500) : json(r, { items: [], total: 0 })) } });
    await page.goto("/approvals");
    await expect(page.getByText("Couldn't load approval requests.")).toBeVisible({ timeout: 15_000 });
    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Nothing is waiting for approval")).toBeVisible();
  });

  test("an expired session redirects to sign-in", async ({ page }) => {
    await mockApp(page, { overrides: { "/api/auth/me": (r) => json(r, { detail: "not authenticated" }, 401) } });
    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/login\?next=%2Ftasks/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("viewer role sees no write controls and cannot decide approvals", async ({ page }) => {
    await mockApp(page, { role: "viewer", overrides: { "/api/approvals": (r) => json(r, { items: [PENDING_APPROVAL], total: 1 }) } });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create agent" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Create agent" })).toHaveCount(0);
    await page.goto("/approvals");
    await expect(page.getByText("Your role can review requests but not decide them.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  });

  test("a 403 from the API renders a permission state, not a crash", async ({ page }) => {
    await mockApp(page, { overrides: { "/api/schedules": (r) => json(r, { detail: "forbidden" }, 403) } });
    await page.goto("/workflows");
    await expect(page.getByText("You don't have access")).toBeVisible();
  });

  test("approving a high-risk action requires explicit confirmation", async ({ page }) => {
    const decisions: any[] = [];
    await mockApp(page, { overrides: { "/api/approvals": async (r, url) => {
      if (r.request().method() === "POST") {
        decisions.push({ path: url.pathname, body: r.request().postDataJSON(), csrf: r.request().headers()["x-csrf-token"] });
        return json(r, { ...PENDING_APPROVAL, status: "approved" });
      }
      return json(r, { items: decisions.length ? [] : [PENDING_APPROVAL], total: decisions.length ? 0 : 1 });
    } } });
    await page.goto("/approvals");
    const card = page.getByRole("article", { name: "Approval request from Ops Bot" });
    await expect(card.getByText("rm -rf ./build").first()).toBeVisible();
    await expect(card.getByText("High", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("dialog", { name: "Approve this action?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(decisions).toHaveLength(0); // cancelling never reaches the backend

    await card.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("dialog", { name: "Approve this action?" }).getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => decisions.length).toBe(1);
    expect(decisions[0]).toMatchObject({ path: "/api/approvals/ap1/decide", body: { decision: "approved" }, csrf: "mock-csrf" });
    await expect(page.getByText("Nothing is waiting for approval")).toBeVisible();
  });

  test("dialogs trap focus, close on Escape and restore focus", async ({ page }) => {
    await mockApp(page, { overrides: { "/api/approvals": (r) => json(r, { items: [PENDING_APPROVAL], total: 1 }) } });
    await page.goto("/approvals");
    const approve = page.getByRole("button", { name: "Approve" });
    await approve.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(approve).toBeFocused();
  });

  test("Ctrl+K focuses global search", async ({ page }) => {
    await mockApp(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByLabel("Search agents and tasks")).toBeFocused();
  });

  test("mobile layout uses a navigation drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApp(page);
    await page.goto("/");
    const nav = page.getByRole("complementary", { name: "Primary navigation" });
    await expect(nav).toBeHidden();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(nav).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await nav.getByRole("link", { name: "Tasks" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(nav).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

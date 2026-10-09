/**
 * End-to-end acceptance flow against a running instance with a REAL model provider.
 * Start the stack with scripts/e2e.sh (fresh database), which exports EXP_LABS_API_KEY.
 */
import { expect, Page, request, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const KEY = process.env.EXP_LABS_API_KEY ?? "";
const MODEL = process.env.SCA_TEST_MODEL ?? "claude-haiku-5.5";
const ADMIN = { email: "e2e-admin@acme-e2e.com", password: "E2e-Secret-Pass!9" };
const VIEWER = { email: "e2e-viewer@acme-e2e.com", password: "Viewer-Pass-1234!" };

test.describe.configure({ mode: "serial" });

const fieldSelect = (page: Page, label: string) => page.locator("label.field").filter({ hasText: new RegExp(`^${label}`) }).locator("select").first();

async function csrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === "sca_csrf")?.value ?? "";
}

async function apiPost(page: Page, path: string, body: unknown) {
  return page.request.post(path, { data: body, headers: { "x-csrf-token": await csrf(page) } });
}

async function waitTask(page: Page, id: string, until = ["completed", "failed", "cancelled", "timed_out"]) {
  for (let i = 0; i < 300; i++) {
    const t = await (await page.request.get(`/api/tasks/${id}`)).json();
    if (until.includes(t.status)) return t;
    await page.waitForTimeout(2000);
  }
  throw new Error(`task ${id} did not finish`);
}

test("full multi-agent acceptance flow", async ({ page, baseURL }) => {
  test.skip(!KEY, "EXP_LABS_API_KEY is required for the real-provider E2E flow");

  // 1. Sign in (first run: organization setup).
  await page.goto("/login");
  await page.getByLabel("Organization name").fill("Acme E2E");
  await page.getByLabel("Your name").fill("Erin Admin");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByRole("heading", { name: /Good to see you, Erin/ })).toBeVisible();

  // 3a. Configure the model provider through Settings and run a real connection test.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Add provider" }).click();
  await page.getByLabel("API key").fill(KEY);
  await page.getByLabel("Default model").fill(MODEL);
  await page.getByRole("button", { name: "Save provider" }).click();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Connection verified")).toBeVisible({ timeout: 90_000 });

  // 2-4. Create an agent with the wizard: identity (template), model, tools.
  const createAgent = async (name: string, template: string, tools: string[]) => {
    await page.goto("/agents/new");
    await page.getByRole("button", { name: new RegExp(template) }).click();
    await page.getByLabel("Agent name").fill(name);
    await page.getByRole("button", { name: "Continue" }).click(); // -> role
    await page.getByRole("button", { name: "Continue" }).click(); // -> model
    await fieldSelect(page, "Model").selectOption(MODEL);
    await page.getByRole("button", { name: "Continue" }).click(); // -> tools
    for (const t of ["Terminal", "File operations", "Task planner", "Content search", "File finder", "Company knowledge search"]) {
      const card = page.getByRole("checkbox", { name: new RegExp(`^.{0,2}${t}`) });
      const want = tools.includes(t);
      if ((await card.count()) && (await card.getAttribute("aria-checked")) !== String(want)) await card.click();
    }
    await page.getByRole("button", { name: "Continue" }).click(); // -> knowledge
    await page.getByRole("button", { name: "Continue" }).click(); // -> policies
    await page.getByLabel("Approval requirement").selectOption("never");
    await page.getByRole("button", { name: "Continue" }).click(); // -> review
    await page.getByRole("button", { name: "Create agent" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    return page.url().split("/agents/")[1].split("/")[0];
  };
  const coderId = await createAgent("E2E Coder", "Software Engineering Agent", ["Terminal", "File operations"]);

  // 5. Configuration persists (reload and read it back from the server).
  await page.reload();
  await page.getByRole("tab", { name: /Tools & settings/ }).click();
  await page.getByRole("button", { name: "Model", exact: true }).click();
  await expect(fieldSelect(page, "Model")).toHaveValue(MODEL);
  const persisted = await (await page.request.get(`/api/agents/${coderId}`)).json();
  expect(persisted.config.tools.sort()).toEqual(["file_editor", "terminal"]);

  // 6-9. Submit a task in the chat UI, watch live events, verify the saved result.
  await page.getByRole("tab", { name: /Chat & tasks/ }).click();
  await page.getByLabel("Task instructions").fill("Create squares.py that prints the squares of 1..5 on one line separated by spaces, run it with python3 and report the exact output.");
  await page.getByRole("button", { name: "Start task" }).click();
  await expect(page.getByText("Task queued")).toBeVisible();
  const first = (await (await page.request.get(`/api/tasks?agent_id=${coderId}`)).json()).items[0];
  await page.goto(`/tasks/${first.id}`);
  await expect(page.locator(".tl-item").filter({ hasText: /terminal|file_editor/ }).first()).toBeVisible({ timeout: 180_000 });
  const done = await waitTask(page, first.id);
  expect(done.status).toBe("completed");
  await page.reload();
  await page.getByRole("tab", { name: /Result/ }).click();
  await expect(page.getByText(/1 4 9 16 25/).first()).toBeVisible();

  // 10-12. A second agent; both execute separate tasks concurrently; histories stay accessible.
  const writerId = await createAgent("E2E Writer", "Research Agent", ["File operations"]);
  const [ta, tb] = await Promise.all([
    apiPost(page, `/api/agents/${coderId}/tasks`, { instructions: "Write hello.txt containing 'hello from coder' and confirm." }).then((r) => r.json()),
    apiPost(page, `/api/agents/${writerId}/tasks`, { instructions: "Write memo.md with one sentence about teamwork and confirm." }).then((r) => r.json()),
  ]);
  const [ra, rb] = await Promise.all([waitTask(page, ta.id), waitTask(page, tb.id)]);
  expect(ra.status).toBe("completed");
  expect(rb.status).toBe("completed");
  expect(ra.started_at < rb.finished_at && rb.started_at < ra.finished_at).toBeTruthy();
  for (const id of [coderId, writerId]) {
    await page.goto(`/agents/${id}/history`);
    await expect(page.locator("table.table tbody tr").first()).toBeVisible();
  }

  // 13. Least privilege: a viewer cannot create agents, run tasks or escape the workspace.
  const add = await apiPost(page, "/api/users", { email: VIEWER.email, name: "Vic Viewer", role: "viewer", password: VIEWER.password });
  expect(add.status()).toBe(201);
  const viewer = await request.newContext({ baseURL });
  expect((await viewer.post("/api/auth/login", { data: VIEWER })).status()).toBe(200);
  const vcsrf = (await viewer.storageState()).cookies.find((c) => c.name === "sca_csrf")?.value ?? "";
  expect((await viewer.post(`/api/agents/${coderId}/tasks`, { data: { instructions: "x" }, headers: { "x-csrf-token": vcsrf } })).status()).toBe(403);
  expect((await viewer.post("/api/agents", { data: { name: "nope", config: {} }, headers: { "x-csrf-token": vcsrf } })).status()).toBe(403);
  expect([403, 404]).toContain((await viewer.get(`/api/sessions/${done.session_id}/file?path=../../../../secret.key`)).status());
  const anon = await request.newContext({ baseURL });
  expect((await anon.get(`/api/tasks/${first.id}`)).status()).toBe(401);

  // 14. Credentials never reach the browser bundle, API responses or logs.
  const dist = fileURLToPath(new URL("../dist/assets", import.meta.url));
  for (const f of readdirSync(dist)) expect(readFileSync(join(dist, f), "utf8")).not.toContain(KEY);
  for (const path of ["/api/providers", "/api/overview", `/api/tasks/${first.id}/events`, "/api/audit?page_size=500"]) {
    expect(await (await page.request.get(path)).text()).not.toContain(KEY);
  }
  if (process.env.SCA_E2E_LOG) expect(readFileSync(process.env.SCA_E2E_LOG, "utf8")).not.toContain(KEY);
});

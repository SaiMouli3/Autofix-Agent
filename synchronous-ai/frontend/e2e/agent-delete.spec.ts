/**
 * Browser E2E for deleting an agent, against the REAL platform backend (scripts/e2e.sh).
 * The provider record points at an unroutable endpoint; no model call is made.
 */
import { expect, test } from "@playwright/test";

const ADMIN = { email: "e2e-admin@acme-e2e.com", password: "E2e-Secret-Pass!9" };

test("delete an agent from its workspace menu", async ({ page }) => {
  const status = await (await page.request.get("/api/auth/status")).json();
  const auth = status.needs_setup
    ? await page.request.post("/api/auth/setup", { data: { org_name: "Acme E2E", name: "Erin Admin", ...ADMIN } })
    : await page.request.post("/api/auth/login", { data: ADMIN });
  expect(auth.ok()).toBeTruthy();
  const headers = { "x-csrf-token": (await page.context().cookies()).find((c) => c.name === "sca_csrf")?.value ?? "" };

  const prov = await page.request.post("/api/providers", { headers, data: {
    name: `Offline ${Date.now()}`, kind: "openai_compatible", base_url: "https://example.com/v1",
    default_model: "test-model", api_key: "sk-test-0123456789abcdef" } });
  expect(prov.ok()).toBeTruthy();
  const name = `Delete Me ${Date.now() % 100000}`;
  const created = await page.request.post("/api/agents", { headers, data: {
    name, category: "Test", config: { role: "tester", model: { provider_id: (await prov.json()).id, model: "test-model" }, tools: ["file_editor"] } } });
  expect(created.ok()).toBeTruthy();
  const agent = await created.json();

  await page.goto(`/agents/${agent.id}`);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete agent" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(`Delete ${name} permanently?`)).toBeVisible();
  const confirmBtn = dialog.getByRole("button", { name: "Delete agent" });
  await expect(confirmBtn).toBeDisabled(); // the name must be typed first
  await dialog.getByRole("textbox").fill(name);
  await confirmBtn.click();

  await expect(page).toHaveURL(/\/agents$/);
  await expect(page.getByText(`${name} deleted`)).toBeVisible();
  expect((await page.request.get(`/api/agents/${agent.id}`)).status()).toBe(404);
});

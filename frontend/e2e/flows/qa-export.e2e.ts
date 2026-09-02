/**
 * E2E coverage for the Quality Assessment Excel export.
 *
 * Mirrors `extraction-export.e2e.ts`'s UI suite against the QA surface: the
 * backend export path is kind-agnostic and already covered there, so what this
 * proves is the part that was missing — that the button is reachable from the
 * QA article table, that the same dialog opens, and that the output-shape
 * choice reaches the request.
 *
 * The API surface is NOT re-tested here: it is one endpoint, and
 * `extraction-export.e2e.ts` already drives it with a QA-capable payload.
 *
 * Required env (see `frontend/e2e/_fixtures/env.ts`):
 *   * E2E_USER_EMAIL + E2E_USER_PASSWORD — login creds
 *   * E2E_PROJECT_ID — a project with at least one enabled QA tool
 */

import { Locator, Page, expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

/**
 * Log in, open the Quality Assessment tab, and return the export toolbar
 * button. The cold first load resolves the project's enabled QA tools before
 * the table — and this button — renders, which on the ephemeral CI stack can
 * exceed Playwright's default actionability timeout.
 */
async function openQaExportButton(
  page: Page,
  env: ReturnType<typeof loadE2EEnv>,
): Promise<Locator> {
  await loginViaUi(page);
  await page.goto(
    `${env.frontendUrl}/projects/${env.projectId}?tab=quality&qaTab=assessment`,
  );
  const exportBtn = page.getByTestId("qa-export-button");
  await expect(exportBtn).toBeVisible({ timeout: 20000 });
  return exportBtn;
}

test.describe.configure({ mode: "serial" });

test.describe("Quality assessment export — UI flow", () => {
  test.beforeEach(() => {
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);
  });

  test("the QA article table carries the export button", async ({ page }) => {
    const env = loadE2EEnv();
    const exportBtn = await openQaExportButton(page, env);
    // Rendered through HITLArticleTable's `toolbarActions` slot — the same
    // placement the extraction table uses.
    await expect(exportBtn).toBeVisible();
  });

  test("the shared dialog opens with the complete workbook selected", async ({ page }) => {
    const env = loadE2EEnv();
    const exportBtn = await openQaExportButton(page, env);
    await exportBtn.click();

    await expect(page.getByText(/Export to Excel/i)).toBeVisible();
    await expect(page.getByLabel("Consensus")).toBeChecked();
    await expect(page.getByLabel(/Complete workbook/i)).toBeChecked();
    await expect(page.getByTestId("extraction-export-preview")).toBeVisible();
    // The deleted "Articles to export" radio never renders on either surface.
    await expect(page.getByLabel(/Selected only/i)).toHaveCount(0);
  });

  test("picking a shape sends it on the export request", async ({ page }) => {
    const env = loadE2EEnv();
    const exportBtn = await openQaExportButton(page, env);
    await exportBtn.click();
    await page.getByLabel(/Data dictionary only/i).check();

    const [request] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes("/extraction-export") && req.method() === "POST",
        { timeout: 20000 },
      ),
      page.getByTestId("extraction-export-submit").click(),
    ]);

    expect(request.postDataJSON()).toMatchObject({
      shape: "dictionary",
      article_scope: "current_list",
      mode: "consensus",
    });
  });

  test("Cancel closes the dialog without dispatching", async ({ page }) => {
    const env = loadE2EEnv();
    const exportBtn = await openQaExportButton(page, env);
    await exportBtn.click();
    await expect(page.getByText(/Export to Excel/i)).toBeVisible();
    await page.getByRole("button", { name: /Cancel/i }).click();
    await expect(page.getByText(/Export to Excel/i)).not.toBeVisible();
  });
});

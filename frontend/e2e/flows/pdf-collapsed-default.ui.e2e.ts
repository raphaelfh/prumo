import { expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

const REQUIRED = [
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "E2E_PROJECT_ID",
  "E2E_ARTICLE_ID",
];

test.describe.configure({ mode: "serial" });

test.describe("Extraction PDF panel — collapsed by default", () => {
  test("PDF panel is hidden on first load and toggles open via the header button", async ({
    page,
  }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(
      `${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`,
    );

    // Wait for the extraction page to render (any back button exposed by the layout).
    await expect(
      page.getByRole("button", { name: /^back$/i }).first(),
    ).toBeVisible({ timeout: 20000 });

    // The PDF toggle in HeaderPDFControls renders either "Show" (desktop)
    // or aria-label "Show PDF" (compact). With the new collapsed-by-default
    // behavior, that toggle must show the SHOW state on first load.
    const showButton = page
      .getByRole("button", { name: /^(show|show pdf)$/i })
      .first();
    await expect(showButton).toBeVisible({ timeout: 10000 });

    // Click to open the PDF panel.
    await showButton.click();

    // The toggle now shows HIDE state.
    const hideButton = page
      .getByRole("button", { name: /^(hide|hide pdf)$/i })
      .first();
    await expect(hideButton).toBeVisible({ timeout: 5000 });

    // Click hide to collapse again — toggle returns to SHOW.
    await hideButton.click();
    await expect(
      page.getByRole("button", { name: /^(show|show pdf)$/i }).first(),
    ).toBeVisible({ timeout: 5000 });
  });
});

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

    // The PDF panel toggle (RunHeader.PanelToggle) has aria-label="Toggle source panel"
    // and aria-pressed reflecting the open/closed state. On first load the panel
    // is collapsed so aria-pressed must be "false".
    const panelToggle = page
      .getByRole("button", { name: /toggle source panel/i })
      .first();
    await expect(panelToggle).toBeVisible({ timeout: 10000 });

    // Verify collapsed by default (aria-pressed="false").
    await expect(panelToggle).toHaveAttribute("aria-pressed", "false");

    // Click to open the PDF panel — aria-pressed flips to "true".
    await panelToggle.click();
    await expect(panelToggle).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });

    // Click again to collapse — returns to "false".
    await panelToggle.click();
    await expect(panelToggle).toHaveAttribute("aria-pressed", "false", { timeout: 5000 });
  });
});

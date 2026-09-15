import { expect, type Page, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

const REQUIRED = [
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "E2E_PROJECT_ID",
  "E2E_ARTICLE_ID",
];

/**
 * First-load state of the source (PDF) panel on the extraction screen.
 *
 * The editable review workspace docks the document viewer on the right by
 * default at desktop widths (review-table spec 2026-09-14, §4, §13, §15.1).
 * Below the desktop breakpoint (Tailwind lg, 1024px) the panes cannot keep
 * their readable widths, so the reader keeps its collapsed-by-default
 * contract (§13 "existing narrow-layout collapse behavior"). The fixture
 * article is an editable extraction run opened by its project owner.
 */
async function openExtraction(page: Page, viewport: { width: number; height: number }) {
  const missing = missingEnvKeys(REQUIRED);
  test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

  const env = loadE2EEnv();
  await page.setViewportSize(viewport);
  await loginViaUi(page);
  await page.goto(
    `${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`,
  );

  // Wait for the extraction page to render (any back button exposed by the layout).
  await expect(
    page.getByRole("button", { name: /^back$/i }).first(),
  ).toBeVisible({ timeout: 20000 });

  // RunHeader.PanelToggle: aria-pressed reflects the panel's open state.
  const panelToggle = page
    .getByRole("button", { name: /toggle source panel/i })
    .first();
  await expect(panelToggle).toBeVisible({ timeout: 10000 });
  return panelToggle;
}

test.describe.configure({ mode: "serial" });

test.describe("Extraction source panel — first-load default", () => {
  test("desktop review workspace docks the PDF panel open and the header button closes and reopens it", async ({
    page,
  }) => {
    const panelToggle = await openExtraction(page, { width: 1280, height: 800 });

    await expect(panelToggle).toHaveAttribute("aria-pressed", "true");

    await panelToggle.click();
    await expect(panelToggle).toHaveAttribute("aria-pressed", "false", { timeout: 5000 });

    await panelToggle.click();
    await expect(panelToggle).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });
  });

  test("below the desktop breakpoint the PDF panel stays collapsed on first load and the header button toggles it", async ({
    page,
  }) => {
    const panelToggle = await openExtraction(page, { width: 900, height: 1000 });

    await expect(panelToggle).toHaveAttribute("aria-pressed", "false");

    await panelToggle.click();
    await expect(panelToggle).toHaveAttribute("aria-pressed", "true", { timeout: 5000 });

    await panelToggle.click();
    await expect(panelToggle).toHaveAttribute("aria-pressed", "false", { timeout: 5000 });
  });
});

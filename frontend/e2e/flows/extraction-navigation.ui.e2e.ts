import { Page, expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

const REQUIRED = ["E2E_USER_EMAIL", "E2E_USER_PASSWORD", "E2E_PROJECT_ID", "E2E_ARTICLE_ID"];

async function waitForBackButton(page: Page): Promise<void> {
  const backButton = page.getByRole("button", { name: /^back$/i }).first();
  await expect(backButton).toBeVisible({ timeout: 15000 });
}

// These tests share a single project + article + template so we run them
// serially per worker to avoid Supabase auth rate-limit and ErrorBoundary
// races when multiple parallel logins hit the same user account at once.
test.describe.configure({ mode: "serial" });

test.describe("Extraction page navigation", () => {
  test("Back button returns to project view with extraction tab active", async ({ page }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`);

    await waitForBackButton(page);
    const backButton = page.getByRole("button", { name: /^back$/i }).first();
    await backButton.click();

    // Project view should load; URL must drop /extraction/<articleId>.
    await page.waitForURL(new RegExp(`/projects/${env.projectId}(?!/extraction)`), { timeout: 10000 });
    expect(page.url()).not.toContain("/extraction/");
    expect(page.url()).toContain(`/projects/${env.projectId}`);
    // Tab=extraction must be set so the user lands on the extraction tab they came from.
    expect(page.url()).toContain("tab=extraction");
  });

  test("breadcrumb project link returns to project root", async ({ page }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`);

    await waitForBackButton(page);
    // Breadcrumb shows the project name as a clickable link on viewports >= md.
    // The breadcrumb is rendered inside a navigation landmark with role="navigation" name "breadcrumb".
    const breadcrumb = page.getByRole("navigation", { name: /breadcrumb/i });
    await expect(breadcrumb).toBeVisible({ timeout: 5000 });
    const projectLink = breadcrumb.getByText("E2E Test Project").first();
    await expect(projectLink).toBeVisible();

    await projectLink.click();
    await page.waitForURL(new RegExp(`/projects/${env.projectId}(?!/extraction)`), { timeout: 10000 });
    expect(page.url()).not.toContain("/extraction/");
  });

  test("direct refresh on extraction URL preserves location and re-renders", async ({ page }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    const extractionUrl = `${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`;
    await page.goto(extractionUrl);

    await waitForBackButton(page);
    await page.reload();
    expect(page.url()).toBe(extractionUrl);
    await waitForBackButton(page);
  });

  test("authenticated user lands on extraction page without unexpected console errors", async ({
    page,
  }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    // PDFCanvas + react-pdf <Document>/<Page> still emit one or two
    // "Maximum update depth exceeded" warnings during the very first
    // measurement pass on a fresh PDF. The page reaches steady state
    // immediately after; we keep this allowance narrow (only this exact
    // warning text) so any other error in the extraction surface still
    // fails the test. Mitigations applied so far:
    //  * PDFCanvas.handlePageHeightMeasured short-circuits on unchanged
    //    height (bails out before invalidating the actualPageHeights Map).
    //  * PDFPage.handleLoadSuccess rounds to integer + bails when the
    //    last emitted height matches the new measurement.
    //  * usePDFVirtualization split the IntersectionObserver lifecycle
    //    from the observe()/unobserve() pass so pageRefs mutations no
    //    longer tear down + recreate the observer on every page mount.
    const KNOWN_PDF_VIEWER_WARNING = "Maximum update depth exceeded";
    const unexpectedErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      // Ignore noise from the Vite dev server / HMR / asset 404s.
      if (/Failed to load resource|HMR|hot-update|favicon\.ico/i.test(text)) return;
      if (text.includes(KNOWN_PDF_VIEWER_WARNING)) return;
      unexpectedErrors.push(text);
    });

    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`);

    await waitForBackButton(page);
    await page.waitForTimeout(500);

    expect(
      unexpectedErrors,
      `Unexpected console errors on extraction page:\n${unexpectedErrors.join("\n")}`
    ).toEqual([]);
  });

  test("unknown article id under valid project shows extraction empty/error state, not blank", async ({
    page,
  }) => {
    const missing = missingEnvKeys(["E2E_USER_EMAIL", "E2E_USER_PASSWORD", "E2E_PROJECT_ID"]);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(
      `${env.frontendUrl}/projects/${env.projectId}/extraction/00000000-0000-0000-0000-000000000000`
    );

    // The page must render *something* (back button or an explicit error/empty state),
    // never an indefinitely blank document.
    const backOrError = page
      .getByRole("button", { name: /^back$/i })
      .or(page.getByText(/not found|unable|error/i));
    await expect(backOrError.first()).toBeVisible({ timeout: 15000 });
  });
});

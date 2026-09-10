import { expect, test } from "@playwright/test";

import { ensureArticlePdfBytes } from "../_fixtures/article-pdf";
import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

const REQUIRED = [
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "E2E_PROJECT_ID",
  "E2E_ARTICLE_ID",
  "E2E_SUPABASE_URL",
  "E2E_SUPABASE_SERVICE_ROLE_KEY",
];

test.describe.configure({ mode: "serial" });

test.describe("Articles side panel — dock and document view", () => {
  test("docks the article panel and switches to the document view", async ({ page }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    await ensureArticlePdfBytes();
    await loginViaUi(page);

    const projectId = env.projectId!;
    await page.goto(`/projects/${projectId}?tab=articles`);

    // The panel starts collapsed: the table owns the full width.
    await expect(page.getByTestId("articles-shell-panel")).toHaveCount(0);

    // Target the fixture article by name rather than row position: the
    // shared fixture project holds several articles (QA suites add their
    // own), and only the "E2E Fixture Article" row has real PDF bytes
    // behind it (via ensureArticlePdfBytes above). The row's title cell is
    // the click target — ArticlesList wires onArticleClick there, not on
    // the whole `<tr>`; other cells, like the checkbox, stop propagation.
    const fixtureRow = page.getByRole("row", { name: /E2E Fixture Article/ });
    await fixtureRow.getByRole("cell", { name: "E2E Fixture Article", exact: true }).click();

    // Docked, NOT an overlay: the table is still visible beside it.
    await expect(page.getByTestId("articles-shell-panel")).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();

    await page.getByRole("button", { name: "Document" }).click();
    await expect(page).toHaveURL(/articleView=document/);
    await expect(page.locator("canvas").first()).toBeVisible();
  });
});

/**
 * HITL landing-page smoke + console-error guard.
 *
 * Exercises the project-level Data Extraction and Quality Assessment
 * landing pages across all three tabs (List/Assessment, Dashboard,
 * Configuration) with a console-error watcher attached. Anything that
 * surfaces as a ``console.error`` or a ``pageerror`` fails the test —
 * which is exactly what the missing test for the dropped
 * ``extraction_reviewer_states_current_decision_id_fkey`` PostgREST
 * embed (Dashboard tab regression) needed.
 *
 * The toast-error path is also asserted explicitly: Sonner renders
 * ``role="status"`` regions, and a regression there is just as bad as a
 * console error from the user's perspective. We accept the few benign
 * messages the dev server produces (HMR, favicon) via the watcher's
 * default allowlist.
 */

import { expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { watchConsoleErrors } from "../_fixtures/console-errors";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

const REQUIRED_BASE = ["E2E_USER_EMAIL", "E2E_USER_PASSWORD", "E2E_PROJECT_ID"];

// These tests share a project so we run them serially per worker to
// avoid Supabase auth rate-limit and shared-DB races.
test.describe.configure({ mode: "serial" });

async function expectNoErrorToast(page: import("@playwright/test").Page): Promise<void> {
  // Sonner attaches errors with ``data-type="error"``; assert none surface
  // before the watcher runs (a toast can flash and disappear, but the
  // associated console.error stays in the watcher's bucket).
  const errorToast = page.locator('[data-sonner-toast][data-type="error"]');
  await expect(errorToast).toHaveCount(0);
}

test.describe("Data Extraction landing", () => {
  test("List → Dashboard → Configuration tabs render without console errors", async ({
    page,
  }) => {
    const missing = missingEnvKeys(REQUIRED_BASE);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    const watcher = watchConsoleErrors(page);

    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}?tab=extraction`);

    // List tab is the default. Wait until either the article table or the
    // "configure template first" empty state is rendered before flipping
    // tabs — landing on a half-loaded shell makes the tab clicks racy.
    const listOrEmpty = page
      .getByRole("table")
      .or(page.getByText(/configure the template first/i));
    await expect(listOrEmpty.first()).toBeVisible({ timeout: 15000 });

    // Dashboard tab. This is the one where the broken
    // ``reviewer_decision:current_decision_id(decision)`` embed used to
    // toast "Error loading extraction statistics" — the regression.
    await page.getByRole("tab", { name: /dashboard/i }).click();
    await expect(page.getByText(/Articles/i).first()).toBeVisible({ timeout: 10000 });
    // Give loadExtractionStats time to resolve so any thrown error has
    // time to land in console.
    await page.waitForTimeout(700);
    await expectNoErrorToast(page);

    // Configuration tab. The manager role is required for this tab to
    // appear in the bar; if the seeded user is not a manager we just
    // skip the click (the watcher still asserts on List + Dashboard).
    const configurationTab = page.getByRole("tab", { name: /configuration/i });
    if (await configurationTab.count()) {
      await configurationTab.click();
      await page.waitForTimeout(500);
      await expectNoErrorToast(page);
    }

    watcher.assertNone();
  });
});

test.describe("Quality Assessment landing", () => {
  test("Assessment → Dashboard → Configuration tabs render without console errors", async ({
    page,
  }) => {
    const missing = missingEnvKeys(REQUIRED_BASE);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    const watcher = watchConsoleErrors(page);

    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}?tab=quality`);

    // Assessment tab is default. Either the active-template bar or the
    // "no QA tool enabled" hint shows up — both are valid landing states.
    const assessmentLanded = page
      .getByTestId("hitl-quality_assessment-active-template-bar")
      .or(page.getByTestId("hitl-quality_assessment-active-template-bar-empty"));
    await expect(assessmentLanded.first()).toBeVisible({ timeout: 15000 });
    await expectNoErrorToast(page);

    // Dashboard tab.
    await page
      .getByTestId("hitl-quality_assessment-tab-dashboard")
      .click();
    await page.waitForTimeout(700);
    await expectNoErrorToast(page);

    // Configuration tab (manager-only — same skip dance as extraction).
    const configurationTab = page.getByTestId(
      "hitl-quality_assessment-tab-configuration",
    );
    if (await configurationTab.count()) {
      await configurationTab.click();
      await expect(
        page.getByTestId("hitl-quality_assessment-configuration"),
      ).toBeVisible({ timeout: 10000 });
      await expectNoErrorToast(page);
    }

    watcher.assertNone();
  });
});

import { expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

/** Fixed catalogue id for CHARMS (matches `app/seed.py`). */

/**
 * Runs against E2E_IMPORT_PROJECT_ID — a dedicated, CHARMS-free project so
 * this test can import CHARMS fresh (the shared E2E_PROJECT_ID already has it).
 * The user must be a **manager** on that project so the Configuration tab and
 * import controls are available. Both are auto-provisioned by global-setup.
 */
test.describe("Extraction template import (global → project)", () => {
  test("imports CHARMS from configuration and shows success", async ({ page }) => {
    test.setTimeout(120_000);

    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);

    await page.goto(
      `${env.frontendUrl}/projects/${env.importProjectId}?tab=extraction&extractionTab=configuration`,
      { waitUntil: "domcontentloaded" },
    );

    // Which entry point renders depends on whether this project already has
    // an active template, and this suite is stateful across runs — so both
    // alternatives must stay. The per-catalogue-row button is gone; the
    // no-active-template screen now offers one generic Import card.
    const importFromCards = page.getByTestId("extraction-open-import");
    const importFromEditor = page.getByTestId("template-config-open-import").first();

    await expect(importFromCards.or(importFromEditor)).toBeVisible({ timeout: 60_000 });

    if ((await importFromCards.count()) > 0) {
      await importFromCards.click();
    } else {
      await importFromEditor.click();
    }

    await expect(page.getByTestId("import-template-dialog")).toBeVisible({ timeout: 15_000 });

    const submit = page.getByTestId("import-template-submit");
    if (await submit.isDisabled()) {
      // Scope to the option's name label. The framework Badge also renders the
      // exact text "CHARMS", and more than one catalogue template carries
      // framework="CHARMS" (e.g. "CHARMS + Multimodal"), so an unscoped
      // getByText would match across cards and could select the wrong one.
      await page
        .getByTestId("import-template-dialog")
        .locator("label")
        .filter({ hasText: /^CHARMS$/ })
        .first()
        .click();
    }

    const cloneResponse = page.waitForResponse(
      (res) =>
        res.url().includes("/templates/clone") &&
        res.request().method() === "POST" &&
        res.ok(),
      { timeout: 120_000 },
    );

    await submit.click();

    const res = await cloneResponse;
    const json = (await res.json()) as {
      ok?: boolean;
      data?: { entity_type_count?: number; field_count?: number };
    };
    expect(json.ok).toBe(true);
    expect(json.data?.entity_type_count).toBeGreaterThan(0);
    expect(json.data?.field_count).toBeGreaterThan(0);

    await expect(page.getByText(/imported successfully/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

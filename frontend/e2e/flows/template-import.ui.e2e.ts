import { expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

/** Fixed catalogue id for CHARMS (matches `app/seed.py`). */
const CHARMS_GLOBAL_TEMPLATE_ID = "000c0000-0000-0000-0000-000000000001";

/**
 * Requires E2E_USER_* and E2E_PROJECT_ID. The user must be a **manager** on
 * that project so the Configuration tab and import controls are available.
 */
test.describe("Extraction template import (global → project)", () => {
  test("imports CHARMS from configuration and shows success", async ({ page }) => {
    test.setTimeout(120_000);

    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);

    await page.goto(
      `${env.frontendUrl}/projects/${env.projectId}?extractionTab=configuration`,
      { waitUntil: "domcontentloaded" },
    );

    const importFromTable = page.getByTestId(
      `extraction-import-global-${CHARMS_GLOBAL_TEMPLATE_ID}`,
    );
    const importFromEditor = page.getByTestId("template-config-open-import").first();

    await expect(importFromTable.or(importFromEditor)).toBeVisible({ timeout: 60_000 });

    if ((await importFromTable.count()) > 0) {
      await importFromTable.click();
    } else {
      await importFromEditor.click();
    }

    await expect(page.getByTestId("import-template-dialog")).toBeVisible({ timeout: 15_000 });

    const submit = page.getByTestId("import-template-submit");
    if (await submit.isDisabled()) {
      await page
        .getByTestId("import-template-dialog")
        .getByText("CHARMS", { exact: true })
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

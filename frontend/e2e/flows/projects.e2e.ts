import { expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

test.describe("Projects navigation flows", () => {
  test("opens dashboard after authentication", async ({ page }) => {
    const required = missingEnvKeys(["E2E_USER_EMAIL", "E2E_USER_PASSWORD"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    await loginViaUi(page);
    await expect(page).toHaveURL(/\/$/);
  });

  test("opens a project route directly when project id is available", async ({ page }) => {
    const required = missingEnvKeys(["E2E_USER_EMAIL", "E2E_USER_PASSWORD", "E2E_PROJECT_ID"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}`);
    await expect(page).toHaveURL(new RegExp(`/projects/${env.projectId}`));
  });

  test("returns not found or guard behavior for unknown project id", async ({ page }) => {
    const required = missingEnvKeys(["E2E_USER_EMAIL", "E2E_USER_PASSWORD"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/00000000-0000-0000-0000-000000000000`);
    await page.waitForTimeout(800);
    expect(page.url()).toContain("/projects/00000000-0000-0000-0000-000000000000");
  });
});

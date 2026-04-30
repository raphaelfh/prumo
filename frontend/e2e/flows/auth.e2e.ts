import { expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

test.describe("Auth UI flows", () => {
  test("renders login page and keeps user on /auth with invalid credentials", async ({ page }) => {
    const env = loadE2EEnv();
    await page.goto(`${env.frontendUrl}/auth`);

    await page.fill("#login-email", "invalid-user@example.test");
    await page.fill("#login-password", "invalid-password");
    await page.locator("form button[type='submit']").click();

    const errorAlert = page.locator("form div.bg-red-50, form div.bg-red-950").first();
    await expect(errorAlert).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/auth");
  });

  test("logs in via UI and redirects to dashboard", async ({ page }) => {
    const required = missingEnvKeys(["E2E_USER_EMAIL", "E2E_USER_PASSWORD"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const token = await loginViaUi(page);
    expect(token.length).toBeGreaterThan(20);
    await expect(page).toHaveURL(/\/$/);
  });
});

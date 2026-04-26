import { test, expect } from "@playwright/test";

test("unified evaluation flow smoke marker", async ({ page }) => {
  await page.goto("about:blank");
  await expect(page).toHaveURL("about:blank");
});

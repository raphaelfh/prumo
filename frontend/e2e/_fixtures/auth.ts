import { Page, expect } from "@playwright/test";

import { loadE2EEnv } from "./env";

export async function loginViaUi(page: Page): Promise<string> {
  const env = loadE2EEnv();
  if (!env.userEmail || !env.userPassword) {
    throw new Error("Missing E2E_USER_EMAIL or E2E_USER_PASSWORD for UI login.");
  }

  await page.goto("/auth");
  await page.fill("#login-email", env.userEmail);
  await page.fill("#login-password", env.userPassword);
  await page.locator("form button[type='submit']").click();
  await page.waitForURL(/\/$/, { timeout: 30000 });

  const authToken = await extractSupabaseTokenFromLocalStorage(page);
  expect(authToken).toBeTruthy();
  return authToken!;
}

export async function resolveAuthToken(page?: Page): Promise<string> {
  const env = loadE2EEnv();
  if (env.authToken) {
    return env.authToken;
  }

  if (!page) {
    throw new Error("No E2E_AUTH_TOKEN provided and no page available for UI login fallback.");
  }

  const token = await loginViaUi(page);
  return token;
}

export async function extractSupabaseTokenFromLocalStorage(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const storageEntries = Object.entries(localStorage);
    for (const [key, value] of storageEntries) {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) {
        continue;
      }

      const parsed = JSON.parse(value) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        "currentSession" in parsed &&
        parsed.currentSession &&
        typeof parsed.currentSession === "object" &&
        "access_token" in parsed.currentSession &&
        typeof parsed.currentSession.access_token === "string"
      ) {
        return parsed.currentSession.access_token;
      }

      if (
        parsed &&
        typeof parsed === "object" &&
        "access_token" in parsed &&
        typeof parsed.access_token === "string"
      ) {
        return parsed.access_token;
      }
    }

    return null;
  });
}

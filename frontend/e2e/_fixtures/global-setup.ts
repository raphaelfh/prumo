import type { FullConfig } from "@playwright/test";

import { loadE2EEnv } from "./env";
import { clearRegistry } from "./registry";

async function waitForHealthcheck(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore transient startup errors.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for healthcheck: ${url}`);
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const env = loadE2EEnv();
  await waitForHealthcheck(`${env.apiUrl}/health`, 60_000);
  await waitForHealthcheck(env.frontendUrl, 60_000);
  // Reset the resource registry so we never accidentally inherit IDs from a
  // previous interrupted run.
  clearRegistry();
}

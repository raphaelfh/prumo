import type { FullConfig } from "@playwright/test";

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  // Intentionally no-op: resource cleanup is handled by per-test helpers
  // and external CI lifecycle (ephemeral database/services).
}

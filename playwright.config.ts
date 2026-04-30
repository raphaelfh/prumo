import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

// Lightweight .env loader so E2E_*, OPENAI_API_KEY, etc. defined at the project
// root flow into the Playwright runner without requiring an extra dependency.
// Each line `KEY=VALUE` is honored unless KEY is already set in process.env.
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(resolve(process.cwd(), ".env.e2e"));
loadDotEnv(resolve(process.cwd(), ".env"));

const baseURL = process.env.E2E_FRONTEND_URL || "http://127.0.0.1:8080";

export default defineConfig({
  testDir: "./frontend/e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./frontend/e2e/_fixtures/global-setup.ts",
  globalTeardown: "./frontend/e2e/_fixtures/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "local-api",
      testMatch: "**/flows/**/*.e2e.ts",
      testIgnore: [
        "**/*.ui.e2e.ts",
        "**/remote/**/*.e2e.ts",
        "**/flows/auth.e2e.ts",
        "**/flows/projects.e2e.ts",
        "**/flows/qa-*.e2e.ts",
        "**/flows/extraction-edit.ui.e2e.ts",
        "**/flows/extraction-reopen.ui.e2e.ts",
        "**/flows/hitl-run-lifecycle.api.e2e.ts",
        "**/flows/hitl-ai-proposal.api.e2e.ts",
        "**/flows/hitl-config.api.e2e.ts",
      ],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "local-ui",
      testMatch: ["**/flows/**/*.ui.e2e.ts", "**/flows/auth.e2e.ts", "**/flows/projects.e2e.ts"],
      testIgnore: [
        "**/flows/qa-*.ui.e2e.ts",
        "**/flows/extraction-edit.ui.e2e.ts",
        "**/flows/extraction-reopen.ui.e2e.ts",
      ],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // HITL-stateful tests share a single (project, article, template) triple
      // and hard-reset runs between cases. Running them in parallel — across
      // qa-flow / qa-reopen / qa-multi-reviewer / extraction-edit /
      // extraction-reopen — produces flakes where one test deletes another's
      // run mid-flight. Pin them to a single worker so they execute serially.
      name: "local-hitl",
      testMatch: [
        "**/flows/qa-*.e2e.ts",
        "**/flows/extraction-edit.ui.e2e.ts",
        "**/flows/extraction-reopen.ui.e2e.ts",
        "**/flows/hitl-run-lifecycle.api.e2e.ts",
        "**/flows/hitl-ai-proposal.api.e2e.ts",
        "**/flows/hitl-config.api.e2e.ts",
      ],
      fullyParallel: false,
      workers: 1,
      // Cold-start Vite occasionally serves a stale module on the first
      // navigation; one retry covers that without papering over real bugs.
      retries: 1,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "remote-smoke",
      testMatch: "**/remote/**/*.e2e.ts",
      retries: 2,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

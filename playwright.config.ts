import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_FRONTEND_URL || "http://127.0.0.1:8080";

export default defineConfig({
  testDir: "./frontend/e2e",
  testMatch: "**/*.e2e.ts",
  globalSetup: "./frontend/e2e/_fixtures/global-setup.ts",
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
      ],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "local-ui",
      testMatch: ["**/flows/**/*.ui.e2e.ts", "**/flows/auth.e2e.ts", "**/flows/projects.e2e.ts"],
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

import { expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

test.describe("Projects navigation flows", () => {
  test("lands on the hub inside the unified shell", async ({ page }) => {
    const required = missingEnvKeys(["E2E_USER_EMAIL", "E2E_USER_PASSWORD"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    await loginViaUi(page);
    await expect(page).toHaveURL(/\/$/);

    const shell = page.getByTestId("app-shell");
    await expect(shell).toBeVisible();
    // Precondition: the route match yielded no project id, so the workspace
    // state below is the state actually under test.
    await expect(shell).toHaveAttribute("data-project-id", "");
    await expect(shell.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Projects");
    await expect(shell.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  test("opens a project and returns to the hub through the switcher", async ({ page }) => {
    const required = missingEnvKeys(["E2E_USER_EMAIL", "E2E_USER_PASSWORD", "E2E_PROJECT_ID"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}`);
    await expect(page).toHaveURL(new RegExp(`/projects/${env.projectId}`));

    const shell = page.getByTestId("app-shell");
    await expect(shell).toHaveAttribute("data-project-id", env.projectId!);
    await expect(shell.getByRole("button", { name: "Articles" })).toBeVisible();

    // Scoped and name-independent. The trigger's accessible name is the avatar
    // letter plus the SEEDED project's name (`SidebarHeader.tsx:59-76`) — the
    // KbdBadge is aria-hidden and `aria-keyshortcuts` does not contribute to
    // the name, so a `/^G P|Project/` regex would never match its first
    // alternative and would match the second only by luck of the seed.
    // `aria-keyshortcuts="G P"` is unique in the app (`SidebarNavItem` emits
    // `G <letter>` for O,C,A,T,E,Q,R,H; `PanelToggleButton` emits Meta+B and
    // `\`), so no `.first()` is needed — a second match should fail loudly.
    await shell.locator('[aria-keyshortcuts="G P"]').click();
    await page.getByRole("menuitem", { name: "Back to projects" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("app-shell")).toHaveAttribute("data-project-id", "");
  });

  test("returns not found or guard behavior for unknown project id", async ({ page }) => {
    const required = missingEnvKeys(["E2E_USER_EMAIL", "E2E_USER_PASSWORD"]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/00000000-0000-0000-0000-000000000000`);
    const shell = page.getByTestId("app-shell");
    await expect(shell.getByText("Project not found")).toBeVisible({ timeout: 10000 });
    // The shell around it must answer too: the breadcrumb landmark names the
    // unresolvable id rather than shimmering forever with no accessible text.
    await expect(
      shell.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("Unknown project");
    expect(page.url()).toContain("/projects/00000000-0000-0000-0000-000000000000");
  });
});

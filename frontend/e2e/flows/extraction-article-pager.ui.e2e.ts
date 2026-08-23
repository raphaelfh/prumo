/**
 * Characterisation test: does a pending (un-debounced) edit survive a keyboard
 * article change?
 *
 * Article navigation is a route-PARAM change on the same route element, so the
 * `useAutoSaveProposals` unmount flush does not obviously fire. The sibling
 * `extraction-edit.ui.e2e.ts` deliberately waits out the 3s debounce; this one
 * deliberately does not.
 *
 * The J/K shortcut (`useRunShortcuts`) ignores keypresses while an editable
 * element has focus (see `hooks/runs/useRunShortcuts.ts`'s `isEditing` guard,
 * pinned by the unit test "ignores J/K while the user is typing in a field").
 * So the field is blurred (not waited on) right after typing, before the
 * pager key is pressed — otherwise the keystroke would just be typed into
 * the field and the pager would never navigate at all.
 *
 * Field discovery deliberately does NOT reuse `extraction-edit.ui.e2e.ts`'s
 * `form input[type='text']` fragment: the extraction form has no `<form>`
 * element (`FieldValueEditor.tsx`'s `<Input>` for a text field never sets a
 * `type` prop, so the DOM node carries no `type` attribute at all), so that
 * selector matches nothing here and would skip every run unconditionally.
 * Instead this scopes to the form panel's own
 * `[data-scroll-container="extraction-form"]` wrapper (already used by
 * `extraction-navigation.ui.e2e.ts`) and queries by ARIA role, which is
 * robust to the missing `type` attribute.
 *
 * Direction is picked at runtime, not hardcoded to "next": the pager's
 * article list is sorted `created_at DESC` (`extractionDataService.ts`), and
 * `ensure-fixtures.ts` inserts `F.ARTICLE_ID` (what `E2E_ARTICLE_ID` resolves
 * to) strictly before the four QA articles via sequential awaited calls, so
 * it holds the oldest `created_at` of the group and lands LAST in that
 * DESC-sorted list on the standard fixture. That makes "Next article"
 * permanently disabled and only "Previous article" live. The test exercises
 * whichever direction the pager actually enables (preferring next) and
 * presses the matching key, so it is not structurally starved by fixture
 * insertion order — it only skips when BOTH directions are disabled, which
 * genuinely means a single-article worklist.
 */

import { expect, test } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { ARTICLE_NEXT_KEY, ARTICLE_PREV_KEY } from "../../lib/runs/shortcuts";

const REQUIRED = ["E2E_USER_EMAIL", "E2E_USER_PASSWORD", "E2E_PROJECT_ID", "E2E_ARTICLE_ID"];

test.describe.configure({ mode: "serial" });

test.describe("Extraction article pager", () => {
  test("a keyboard article change does not lose a pending edit", async ({ page }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`);

    // The pager renders null on a single-article project — that is a valid
    // fixture state, not a failure.
    const nextButton = page.getByRole("button", { name: /next article/i });
    const prevButton = page.getByRole("button", { name: /previous article/i });
    await expect(page.getByRole("button", { name: /^back$/i }).first()).toBeVisible({ timeout: 15000 });
    const pagerCount = await nextButton.count();
    test.skip(pagerCount === 0, "Project has a single article — no pager to exercise");

    // Prefer "next", but fall back to "previous": on the standard fixture
    // E2E_ARTICLE_ID is the oldest article of the group (see file header),
    // so it sorts LAST and only "previous" is actually enabled. Only skip
    // when neither direction can move — that is the genuine single-article
    // case, already covered by the pagerCount check above as a fixture
    // regression guard but re-checked explicitly here.
    const nextEnabled = !(await nextButton.isDisabled());
    const prevEnabled = !(await prevButton.isDisabled());
    test.skip(!nextEnabled && !prevEnabled, "Both pager directions disabled — single-article worklist");
    const key = (nextEnabled ? ARTICLE_NEXT_KEY : ARTICLE_PREV_KEY).toLowerCase();

    const formPanel = page.locator('[data-scroll-container="extraction-form"]');
    const textFields = formPanel.getByRole("textbox");
    const fieldCount = await textFields.count();
    test.skip(fieldCount === 0, "No free-text field on the page to probe with");

    const probe = `pager-probe-${Date.now()}`;
    const field = textFields.first();
    await field.fill(probe);
    // Move focus off the field so the pager key is read as a shortcut rather
    // than typed into the input (the shortcut is disabled while editing).
    // This is not a wait — it does not give the autosave debounce any time.
    await field.blur();

    // Deliberately do NOT wait out the autosave debounce.
    const urlBefore = page.url();
    await page.keyboard.press(key);
    await expect.poll(() => page.url(), { timeout: 10000 }).not.toBe(urlBefore);
    expect(page.url()).toContain("/extraction/");

    // Back to the original article: the probe must still be there.
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`);
    await expect(page.getByRole("button", { name: /^back$/i }).first()).toBeVisible({ timeout: 15000 });
    await expect(formPanel.getByRole("textbox").first()).toHaveValue(probe, { timeout: 15000 });
  });

  test("the pager renders two buttons and an inert counter", async ({ page }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    await loginViaUi(page);
    await page.goto(`${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`);
    await expect(page.getByRole("button", { name: /^back$/i }).first()).toBeVisible({ timeout: 15000 });

    const pager = page.getByRole("navigation", { name: /article \d+ of \d+/i });
    test.skip((await pager.count()) === 0, "Project has a single article — no pager to exercise");
    await expect(pager.getByRole("button")).toHaveCount(2);
    await expect(pager).toContainText(/\d+\s*\/\s*\d+/);
  });
});

/**
 * Characterisation test: does a pending (un-debounced) edit survive a keyboard
 * article change?
 *
 * Article navigation is a route-PARAM change on the same route element, so
 * `useAutoSaveProposals`'s unmount flush never fires; the pending edit rides
 * on whichever fires first — the still-armed 600ms debounce, or the hook's
 * run-switch flush when the next article's session resolves and swaps
 * `activeRunId` in place. The sibling
 * `extraction-edit.ui.e2e.ts` deliberately waits out the 600ms debounce
 * (`useAutoSaveProposals`'s default `debounceMs`, unoverridden by either run
 * screen); this one deliberately does not — it waits for the flush POST the
 * article change itself triggers, then reloads and reads the value back.
 *
 * Waiting for that POST is not optional. An earlier version reloaded the
 * original article a few milliseconds after the keypress, which pre-empted
 * the in-app flush and exercised the `pagehide` keepalive path instead. A
 * keepalive fetch fired during unload is invisible to Playwright's network
 * tracing and races the unload itself, so the test could neither observe the
 * write nor wait for it, and failed whenever the unload won — and, whenever
 * the bootstrap reads had not yet landed, the `loading` gate described next
 * skipped the pagehide flush outright.
 *
 * The second case holds the next article's bootstrap read until the flush
 * POST has been observed, so its session is guaranteed to resolve first —
 * an event, not a timer, so a slow backend cannot quietly turn the case into
 * a duplicate of the first. That ordering used to drop the edit: the page
 * gated autosave on the bootstrap `loading` flag, which flips on every
 * article change, so the run-switch flush saw `enabled=false` and skipped
 * the write. It is a realistic ordering (PostgREST and the API are different
 * hosts in production), not a contrived one.
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
 * `--repeat-each` spreads the repeats of one test over parallel workers that
 * all write to this one fixture run, so each repeat probes its own field
 * (`repeatEachIndex`, modulo the textbox count); otherwise a sibling repeat's
 * flush lands between this one's flush and its read-back and the assertion
 * reads the sibling's probe. Repeats beyond the textbox count wrap onto a
 * shared field again — measure those with `--workers 1`; a failure that reads
 * another `pager-probe-*` value is that collision, not the product.
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
 *
 * The pager itself is also a load race, not just a fixture-order trap: the
 * ready-state render (and its Back button) can commit before the article
 * worklist array has actually landed in `useExtractionData` state, so
 * sampling the pager once — right after the Back button becomes visible —
 * can read a transient zero-button state and misreport a multi-article
 * project as "single article". `waitFor({ state: "visible" })` on the pager
 * `<nav>` polls through that window instead of sampling once; the `.catch`
 * swallows a genuine timeout (the real single-article case) so the test
 * skips instead of failing, and the skip check runs only after the wait has
 * had its full chance.
 */

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { ARTICLE_NEXT_KEY, ARTICLE_PREV_KEY } from "../../lib/runs/shortcuts";

const REQUIRED = ["E2E_USER_EMAIL", "E2E_USER_PASSWORD", "E2E_PROJECT_ID", "E2E_ARTICLE_ID"];

test.describe.configure({ mode: "serial" });

const FORM_PANEL = '[data-scroll-container="extraction-form"]';

/** Log in, open the fixture article, and wait for the pager to settle. */
async function openFixtureArticle(page: Page) {
  const missing = missingEnvKeys(REQUIRED);
  test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

  const env = loadE2EEnv();
  const articleUrl = `${env.frontendUrl}/projects/${env.projectId}/extraction/${env.articleId}`;
  await loginViaUi(page);
  await page.goto(articleUrl);

  // The Back button confirms the page reached SOME ready render (a fast,
  // clear failure if login or routing is broken) — it is deliberately NOT
  // used as a proxy for "the pager's data has resolved" (see file header).
  await expect(page.getByRole("button", { name: /^back$/i }).first()).toBeVisible({ timeout: 15000 });

  // The pager renders null on a single-article project — that is a valid
  // fixture state, not a failure. Poll for it instead of sampling once.
  const pager = page.getByRole("navigation", { name: /article \d+ of \d+/i });
  await pager.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  test.skip(
    (await pager.count()) === 0,
    "Project has a single article, or the page never reached its ready state (e.g. a misconfiguration) — no pager to exercise",
  );
  return { env, articleUrl, pager };
}

/** The `edit` decision POST that carries `probe`, once the backend accepts it. */
function flushOf(page: Page, probe: string) {
  return page.waitForResponse(
    (res) =>
      /\/api\/v1\/runs\/[^/]+\/decisions$/.test(res.url()) &&
      res.request().method() === "POST" &&
      res.ok() &&
      res.request().postDataJSON()?.value?.value === probe,
    { timeout: 15_000 },
  );
}

async function pendingEditSurvivesKeyboardArticleChange(
  page: Page,
  testInfo: TestInfo,
  opts: { holdNextArticleBootstrapUntilFlush?: boolean } = {},
) {
  const { env, articleUrl, pager } = await openFixtureArticle(page);

  // Prefer "next", but fall back to "previous": on the standard fixture
  // E2E_ARTICLE_ID is the oldest article of the group (see file header),
  // so it sorts LAST and only "previous" is actually enabled. Only skip
  // when neither direction can move — that is the genuine single-article
  // case, already covered by the pager check above as a fixture
  // regression guard but re-checked explicitly here.
  const nextButton = pager.getByRole("button", { name: /next article/i });
  const prevButton = pager.getByRole("button", { name: /previous article/i });
  const nextEnabled = !(await nextButton.isDisabled());
  const prevEnabled = !(await prevButton.isDisabled());
  test.skip(!nextEnabled && !prevEnabled, "Both pager directions disabled — single-article worklist");
  const key = (nextEnabled ? ARTICLE_NEXT_KEY : ARTICLE_PREV_KEY).toLowerCase();

  const formPanel = page.locator(FORM_PANEL);
  const textFields = formPanel.getByRole("textbox");
  const fieldCount = await textFields.count();
  test.skip(fieldCount === 0, "No free-text field on the page to probe with");
  const fieldIndex = testInfo.repeatEachIndex % fieldCount;

  const probe = `pager-probe-${Date.now()}`;
  // Deliberately do NOT wait out the autosave debounce: the article change
  // itself must flush the edit. Arm the listener first so the hold below can
  // key off it; the no-op catch keeps a timeout from double-reporting as an
  // unhandled rejection (the `await flushed` below still receives it).
  const flushed = flushOf(page, probe);
  void flushed.catch(() => undefined);

  if (opts.holdNextArticleBootstrapUntilFlush) {
    // Hold the NEXT article's `articles?select=*&id=eq.<id>` bootstrap read
    // (the original article's own reads pass through) until the flush POST
    // has been observed, so its session open resolves — and the run switches
    // — while the page still reports the bootstrap as loading. Keyed on the
    // flush, not a timer: if the flush never comes, the hold ends when the
    // waiter times out and the test fails at `await flushed` below.
    await page.route(
      (url) =>
        url.pathname === "/rest/v1/articles" &&
        url.searchParams.get("select") === "*" &&
        url.searchParams.get("id") !== `eq.${env.articleId}`,
      async (route) => {
        await flushed.catch(() => undefined);
        // The page may have navigated on by the time the hold ends.
        await route.continue().catch(() => undefined);
      },
    );
  }

  const field = textFields.nth(fieldIndex);
  await field.fill(probe);
  // Move focus off the field so the pager key is read as a shortcut rather
  // than typed into the input (the shortcut is disabled while editing).
  // This is not a wait — it does not give the autosave debounce any time.
  await field.blur();

  const urlBefore = page.url();
  await page.keyboard.press(key);
  await expect.poll(() => page.url(), { timeout: 10000 }).not.toBe(urlBefore);
  expect(page.url()).toContain("/extraction/");
  await flushed;

  // Back to the original article: the probe must still be there.
  await page.goto(articleUrl);
  await expect(page.getByRole("button", { name: /^back$/i }).first()).toBeVisible({ timeout: 15000 });
  await expect(formPanel.getByRole("textbox").nth(fieldIndex)).toHaveValue(probe, { timeout: 15000 });
}

test.describe("Extraction article pager", () => {
  test("a keyboard article change does not lose a pending edit", async ({ page }, testInfo) => {
    await pendingEditSurvivesKeyboardArticleChange(page, testInfo);
  });

  test("the flush survives the next article's session resolving before its bootstrap read", async ({ page }, testInfo) => {
    await pendingEditSurvivesKeyboardArticleChange(page, testInfo, { holdNextArticleBootstrapUntilFlush: true });
  });

  test("the pager renders two buttons and an inert counter", async ({ page }) => {
    const { pager } = await openFixtureArticle(page);
    await expect(pager.getByRole("button")).toHaveCount(2);
    await expect(pager).toContainText(/\d+\s*\/\s*\d+/);
  });
});

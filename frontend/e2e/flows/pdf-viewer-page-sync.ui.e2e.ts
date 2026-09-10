import { expect, test, type Locator, type Page } from "@playwright/test";

import { ensureArticlePdfBytes, fixtureArticlePdfKey, pdfBytes } from "../_fixtures/article-pdf";
import { loginViaUi } from "../_fixtures/auth";
import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";

const REQUIRED = [
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "E2E_PROJECT_ID",
  "E2E_ARTICLE_ID",
  "E2E_SUPABASE_URL",
  "E2E_SUPABASE_SERVICE_ROLE_KEY",
];

const PAGE_COUNT = 14;

/**
 * How long the scroller must stay still to count as settled — longer than any
 * page sync hold, so a check made after it cannot land while one is still up.
 */
const SCROLL_IDLE_MS = 700;

/**
 * The page ⇄ scroll sync of the shared PDF viewer, in a real browser: jsdom
 * has neither smooth scrolling nor IntersectionObserver, so the unit tests in
 * `frontend/pdf-viewer/__tests__/page-scroll-sync.test.tsx` can only model it.
 */
test.describe("PDF viewer — page and scroll stay in sync", () => {
  test("go to page lands on the requested page after a long jump", async ({ page }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const { body, pageInput } = await openLongDocument(page);

    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await waitForScrollIdle(body);
    // Seven A4 pages away: a smooth scroll that outlasts half a second.
    expect(await pageTopOffset(body, 7)).toBeLessThan(-5000);

    await pageInput.fill("7");
    await pageInput.press("Enter");
    await waitForScrollIdle(body);

    expect(Math.abs(await pageTopOffset(body, 7))).toBeLessThanOrEqual(1);
    await expect(pageInput).toHaveValue("7");
  });

  test("a manual scroll is not pulled back to the top of the page", async ({ page }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const { body, pageInput } = await openLongDocument(page);

    // Halfway down page 2: its top is off-screen and page 3's is still in the
    // lower half, so page 2 is unambiguously the current page.
    const scrollTop = await body.evaluate((el) => {
      const page2 = el.querySelector('[data-page-number="2"]')!.getBoundingClientRect();
      return el.scrollTop + page2.top - el.getBoundingClientRect().top + page2.height / 2;
    });
    await body.evaluate((el, top) => {
      el.scrollTop = top;
    }, scrollTop);

    await expect(pageInput).toHaveValue("2");
    await waitForScrollIdle(body);
    expect(Math.abs((await body.evaluate((el) => el.scrollTop)) - scrollTop)).toBeLessThanOrEqual(1);
  });
});

/**
 * Open the fixture article's document view on a 14-page A4 PDF.
 *
 * The stored object is a one-page stub, and a long jump needs a long document,
 * so pdf.js's GET of the signed URL is answered with generated pages. Minting
 * the signed URL (a POST to the same path) still reaches Storage, which is why
 * the stub must exist.
 */
async function openLongDocument(page: Page): Promise<{ body: Locator; pageInput: Locator }> {
  const env = loadE2EEnv();
  await ensureArticlePdfBytes();

  const signedPath = `/storage/v1/object/sign/articles/${fixtureArticlePdfKey(env.articleId!)}`;
  const longPdf = Buffer.from(pdfBytes({ pages: PAGE_COUNT, width: 595, height: 842 }));
  await page.route(
    (url) => url.pathname === signedPath,
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status: 200,
            contentType: "application/pdf",
            headers: { "access-control-allow-origin": "*" },
            body: longPdf,
          })
        : route.continue(),
  );

  await loginViaUi(page);
  await page.goto(
    `/projects/${env.projectId}?tab=articles&articleEditor=edit&articleId=${env.articleId}&articleView=document`,
  );

  const body = page.locator("[data-pdf-viewer-body]");
  await expect(page.getByRole("img", { name: /^PDF page \d+$/ })).toHaveCount(PAGE_COUNT, {
    timeout: 30_000,
  });
  // Each page takes its final height once its canvas is painted.
  await expect
    .poll(() => body.evaluate((el) => [...el.querySelectorAll("canvas")].every((c) => c.style.height !== "")))
    .toBe(true);
  await waitForScrollIdle(body);

  return { body, pageInput: page.getByRole("textbox", { name: "Current page" }) };
}

/** Resolve once the scroller has not moved for SCROLL_IDLE_MS. */
async function waitForScrollIdle(body: Locator): Promise<void> {
  await body.evaluate(
    (el, quietMs) =>
      new Promise<void>((resolve) => {
        let timer = setTimeout(finish, quietMs);
        function restart() {
          clearTimeout(timer);
          timer = setTimeout(finish, quietMs);
        }
        function finish() {
          el.removeEventListener("scroll", restart);
          resolve();
        }
        el.addEventListener("scroll", restart);
      }),
    SCROLL_IDLE_MS,
  );
}

/** Distance from the scroller's top edge to the top of `pageNumber` (negative = above it). */
function pageTopOffset(body: Locator, pageNumber: number): Promise<number> {
  return body.evaluate((el, n) => {
    const pageEl = el.querySelector(`[data-page-number="${n}"]`);
    if (!pageEl) throw new Error(`page ${n} is not rendered`);
    return pageEl.getBoundingClientRect().top - el.getBoundingClientRect().top;
  }, pageNumber);
}

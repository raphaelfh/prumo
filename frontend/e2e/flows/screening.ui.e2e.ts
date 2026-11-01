/**
 * Title/abstract screening end to end on the list-first workspace, on its own
 * project (SCREENING_PROJECT_ID): the owner lands on Settings (first run),
 * sets two reviewers per record, merges the exact-PMID duplicate pair on the
 * Duplicates sub-view (merge, undo, merge again) and enrolls the three remaining
 * records from the Title/abstract list;
 * reviewer B starts screening and includes all three records by keyboard (the
 * panel auto-advances); reviewer C decides by API (agreeing on Alpha and
 * Gamma, disagreeing on Beta); the owner opens the conflict view, rules Beta with
 * reviewer C's decision ("Reviewer B", the second decision in server order);
 * then the owner turns full text on (one reviewer) and sends the two
 * title/abstract includes there; reviewer B opens the first report with its
 * PDF and excludes it with a reason, rules the report without a PDF "not
 * retrieved"; the PRISMA tab counts the outcomes of both phases.
 *
 * Runs in `local-ui` (CI's "Frontend E2E (ephemeral stack)"). Serial: the
 * second test proves `resetScreeningProject` returns the project to a clean
 * state after the full flow, so a persisted database can run it again.
 */
import { expect, test, type Page } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUiAs } from "../_fixtures/auth";
import { login } from "../_fixtures/ensure-fixtures";
import { createTraceId, loadE2EEnv } from "../_fixtures/env";
import {
  FIXTURE_PASSWORD,
  OWNER_EMAIL,
  REVIEWER_B_EMAIL,
  REVIEWER_C_EMAIL,
  SCREENING_ARTICLES,
  SCREENING_PROJECT_ID,
} from "../_fixtures/fixture-ids";
import { resetScreeningProject } from "../_fixtures/screening";

const [ALPHA, BETA, GAMMA, ALPHA_DUPLICATE] = SCREENING_ARTICLES;
const SCREENING_URL = `/projects/${SCREENING_PROJECT_ID}?tab=screening`;
const DUPLICATES_URL = `${SCREENING_URL}&screeningTab=duplicates`;
const FULL_TEXT_URL = `${SCREENING_URL}&screeningTab=full_text`;
const SETTINGS_URL = `${SCREENING_URL}&screeningTab=settings`;
const PRISMA_URL = `/projects/${SCREENING_PROJECT_ID}?tab=prisma`;
const RECORD_TITLE = /^E2E Screening (Alpha|Beta|Gamma)$/;

interface RecordsResponse {
  rows: Array<{ article_id: string; assignment_id: string | null }>;
}

interface ConfigResponse {
  reviewer_count: number | null;
  enrolled: number;
  not_enrolled: number;
}

interface PrismaResponse {
  screened: number;
  other_removed: number;
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${loadE2EEnv().apiUrl}/api/v1${path}`, {
    headers: authHeaders(token, createTraceId("e2e-screening")),
  });
  const body = await parseEnvelope<T>(res);
  expect(res.status, JSON.stringify(body.error)).toBe(200);
  return body.data;
}

async function decideByApi(token: string, assignmentId: string, decision: "include" | "exclude") {
  const res = await fetch(`${loadE2EEnv().apiUrl}/api/v1/screening/assignments/${assignmentId}/decisions`, {
    method: "POST",
    headers: authHeaders(token, createTraceId("e2e-screening-decide")),
    body: JSON.stringify({ decision }),
  });
  expect(res.status, await res.clone().text()).toBe(200);
}

/** Wait for the next decision POST of the screening panel. */
function decisionSaved(page: Page) {
  return page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/screening\/assignments\/[^/]+\/decisions$/.test(r.url()),
  );
}

/** The title of the record open in the panel (its `h2`). */
async function openRecordTitle(page: Page): Promise<string> {
  const heading = page.getByRole("heading", { name: RECORD_TITLE });
  await expect(heading).toBeVisible();
  return (await heading.textContent()) ?? "";
}

/**
 * Press "1" (include) on the record in the panel and wait for the decision's
 * response. The buttons are enabled only once the assignment read settled,
 * which is also when the panel's decision-key listener is armed.
 */
async function includeOpenRecord(page: Page) {
  await expect(page.getByRole("button", { name: "Include", exact: true })).toBeEnabled();
  const saved = decisionSaved(page);
  await page.keyboard.press("1");
  expect((await saved).status()).toBe(200);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await resetScreeningProject();
});

test("screens, resolves a conflict and reads PRISMA", async ({ browser }) => {
  test.setTimeout(180_000);

  // 1. Owner: the first run lands on Settings; two reviewers per record; merge
  //    the duplicate pair (Alpha is the oldest, so the suggested keeper); then
  //    enroll the three remaining articles from the Title/abstract list.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await loginViaUiAs(owner, OWNER_EMAIL, FIXTURE_PASSWORD);
  await owner.goto(SCREENING_URL);
  await expect(owner).toHaveURL(/[?&]screeningTab=settings\b/);
  await owner.getByRole("radio", { name: "2 reviewers" }).check();
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await expect(owner.getByText("Screening is set up")).toBeVisible();

  await owner.goto(DUPLICATES_URL);
  await expect(owner.getByRole("tab", { name: "Open 1", exact: true })).toBeVisible();
  await expect(owner.getByText("PMID", { exact: true })).toBeVisible();
  const openPair = () => owner.getByRole("button", { name: ALPHA_DUPLICATE.title }).click();
  await openPair();
  await owner.getByRole("button", { name: "Merge, keep selected" }).click();
  await expect(owner.getByText("Merged", { exact: true })).toBeVisible();
  await expect(owner.getByRole("tab", { name: "Open 0", exact: true })).toBeVisible();
  await owner.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(owner.getByRole("tab", { name: "Open 1", exact: true })).toBeVisible();
  await openPair();
  await owner.getByRole("button", { name: "Merge, keep selected" }).click();
  await expect(owner.getByRole("tab", { name: "Open 0", exact: true })).toBeVisible();
  await expect(owner.getByRole("tab", { name: "Resolved 1", exact: true })).toBeVisible();

  await owner.getByRole("tab", { name: "Title/abstract" }).click();
  // No open pair is left, so no "Enroll anyway?" prompt interrupts.
  await owner.getByRole("button", { name: "Enroll all articles" }).click();
  await expect(owner.getByRole("tab", { name: "To screen 3", exact: true })).toBeVisible();
  await expect(owner.getByRole("tab", { name: "All 3", exact: true })).toBeVisible();

  // 2. Reviewer B: "Start screening" opens the first record; "1" includes it
  //    and the panel advances; two more times, nothing left.
  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await loginViaUiAs(reviewer, REVIEWER_B_EMAIL, FIXTURE_PASSWORD);
  await reviewer.goto(SCREENING_URL);
  await reviewer.getByRole("button", { name: "Start screening" }).click();
  const first = await openRecordTitle(reviewer);
  await includeOpenRecord(reviewer);
  const next = await openRecordTitle(reviewer);
  expect(next).not.toBe(first);
  await expect(reviewer.getByTestId("next-record-announcement")).toHaveText(`Next record: ${next}`);
  await includeOpenRecord(reviewer);
  await openRecordTitle(reviewer);
  await includeOpenRecord(reviewer);
  // The panel opened maximized over the list; closing it shows the progress strip.
  await reviewer.getByRole("button", { name: "Toggle the record panel" }).click();
  await expect(reviewer.getByText(/you: 0 left/)).toBeVisible();
  await reviewerContext.close();

  // 3. Reviewer C by API: agrees on Alpha and Gamma, disagrees on Beta.
  const reviewerCToken = await login(REVIEWER_C_EMAIL, FIXTURE_PASSWORD);
  const records = await apiGet<RecordsResponse>(
    `/projects/${SCREENING_PROJECT_ID}/screening/records?phase=title_abstract`,
    reviewerCToken,
  );
  const assignmentOf = (articleId: string) => {
    const row = records.rows.find((r) => r.article_id === articleId);
    expect(row?.assignment_id, `no assignment for ${articleId}`).toBeTruthy();
    return row!.assignment_id!;
  };
  await decideByApi(reviewerCToken, assignmentOf(ALPHA.id), "include");
  await decideByApi(reviewerCToken, assignmentOf(GAMMA.id), "include");
  await decideByApi(reviewerCToken, assignmentOf(BETA.id), "exclude");

  // 4. Owner: open the conflict view and Beta, rule with reviewer C's
  //    decision. Reviewers are lettered in server order: B decided first
  //    ("Reviewer A"), C second ("Reviewer B").
  await owner.reload();
  await owner.getByRole("tab", { name: "Reviewers disagree 1", exact: true }).click();
  await owner.getByRole("button", { name: BETA.title, exact: true }).click();
  const panel = owner.getByTestId("screening-shell-panel");
  await expect(panel.getByRole("heading", { name: BETA.title, exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Use Reviewer B's decision" }).click();
  await expect(owner.getByText("Conflict resolved")).toBeVisible();
  await expect(panel.getByText("Excluded", { exact: true })).toBeVisible();

  // 5. Owner: full text on with one reviewer; the strip offers the two
  //    title/abstract includes, "Send 2 to full text" enrolls them.
  await owner.goto(SETTINGS_URL);
  await owner.getByRole("radio", { name: "Title/abstract, then full text" }).check();
  await owner
    .getByRole("radiogroup", { name: "Reviewers per article — full text" })
    .getByRole("radio", { name: "1 reviewer" })
    .check();
  await owner.getByRole("button", { name: "Save", exact: true }).click();
  await expect(owner.getByText("Screening is set up")).toBeVisible();
  await owner.getByRole("tab", { name: "Title/abstract" }).click();
  await expect(owner.getByText("2 to full text →")).toBeVisible();
  await owner.getByRole("tab", { name: "Full text" }).click();
  await expect(owner).toHaveURL(/[?&]screeningTab=full_text\b/);
  await owner.getByRole("button", { name: "Send 2 to full text" }).first().click();
  await expect(owner.getByText("Sent 2 to full text")).toBeVisible();

  // 6. Reviewer B at full text: the first report opens maximized. The one
  //    with a PDF shows the viewer and is excluded with a reason by key "2";
  //    the one without says so and is ruled "not retrieved".
  const ftContext = await browser.newContext();
  const ftReviewer = await ftContext.newPage();
  await loginViaUiAs(ftReviewer, REVIEWER_B_EMAIL, FIXTURE_PASSWORD);
  await ftReviewer.goto(FULL_TEXT_URL);
  await ftReviewer.getByRole("button", { name: "Start screening" }).click();
  for (let report = 0; report < 2; report++) {
    const title = await openRecordTitle(ftReviewer);
    expect([ALPHA.title, GAMMA.title]).toContain(title);
    if (title === ALPHA.title) {
      await expect(ftReviewer.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
      await expect(ftReviewer.getByRole("button", { name: "Include", exact: true })).toBeEnabled();
      await ftReviewer.keyboard.press("2");
      const saved = decisionSaved(ftReviewer);
      await ftReviewer.getByRole("button", { name: "Wrong outcome" }).click();
      expect((await saved).status()).toBe(200);
    } else {
      await expect(ftReviewer.getByText("No PDF attached")).toBeVisible();
      const saved = decisionSaved(ftReviewer);
      await ftReviewer.getByRole("button", { name: "Report not retrieved" }).click();
      expect((await saved).status()).toBe(200);
    }
  }
  await ftContext.close();

  // 7. Owner: PRISMA counts the outcomes of both phases.
  await owner.goto(PRISMA_URL);
  await expect(owner.getByRole("heading", { name: "PRISMA counts" })).toBeVisible();
  // total = 4 articles, removed = 1 (the merged duplicate), enrolled = 3.
  for (const name of [
    "Manual 4", // every project article is manual-sourced, removed ones included
    "Records identified 4", // identified_total = sum of the source counts = total
    "Duplicates removed 1", // identified_total - total + removed = 4 - 4 + 1
    "Records screened 3", // enrolled records with an assignment
    "Records excluded 1", // Beta, ruled exclude
    "Reports sought for retrieval 2", // Alpha and Gamma, included by both
    "Reports not retrieved 1",
    "Reports excluded 1",
    "Reports included 0",
  ]) {
    await expect(owner.getByRole("row", { name, exact: true })).toBeVisible();
  }
  await ownerContext.close();
});

test("a reset after the full flow starts clean", async () => {
  await resetScreeningProject();
  const ownerToken = await login(OWNER_EMAIL, FIXTURE_PASSWORD);

  const config = await apiGet<ConfigResponse>(`/projects/${SCREENING_PROJECT_ID}/screening/config`, ownerToken);
  expect(config.reviewer_count).toBeNull();
  expect(config.enrolled).toBe(0);
  expect(config.not_enrolled).toBe(4); // total 4, none removed after the reset

  const prisma = await apiGet<PrismaResponse>(`/projects/${SCREENING_PROJECT_ID}/prisma`, ownerToken);
  expect(prisma.screened).toBe(0);
  expect(prisma.other_removed).toBe(4); // total - enrolled - removed = 4 - 0 - 0
});

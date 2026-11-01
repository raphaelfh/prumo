/**
 * Title/abstract screening end to end on the list-first workspace, on its own
 * project (SCREENING_PROJECT_ID): the owner lands on Settings (first run),
 * sets two reviewers per record, merges the exact-PMID duplicate pair on the
 * Duplicates sub-view (merge, undo, merge again) and enrolls the two remaining
 * records from the Title/abstract list;
 * reviewer B starts screening and includes both records by keyboard (the
 * panel auto-advances); reviewer C decides by API (agreeing on Alpha,
 * disagreeing on Beta); the owner opens the conflict view, rules Beta with
 * reviewer C's decision ("Reviewer B", the second decision in server order);
 * the PRISMA tab counts the outcomes.
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

const [ALPHA, BETA, ALPHA_DUPLICATE] = SCREENING_ARTICLES;
const SCREENING_URL = `/projects/${SCREENING_PROJECT_ID}?tab=screening`;
const DUPLICATES_URL = `${SCREENING_URL}&screeningTab=duplicates`;
const PRISMA_URL = `/projects/${SCREENING_PROJECT_ID}?tab=prisma`;
const RECORD_TITLE = /^E2E Screening (Alpha|Beta)$/;

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
  const saved = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/screening\/assignments\/[^/]+\/decisions$/.test(r.url()),
  );
  await page.keyboard.press("1");
  expect((await saved).status()).toBe(200);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await resetScreeningProject();
});

test("screens, resolves a conflict and reads PRISMA", async ({ browser }) => {
  test.setTimeout(120_000);

  // 1. Owner: the first run lands on Settings; two reviewers per record; merge
  //    the duplicate pair (Alpha is the oldest, so the suggested keeper); then
  //    enroll the two remaining articles from the Title/abstract list.
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
  await expect(owner.getByRole("tab", { name: "To screen 2", exact: true })).toBeVisible();
  await expect(owner.getByRole("tab", { name: "All 2", exact: true })).toBeVisible();

  // 2. Reviewer B: "Start screening" opens the first record; "1" includes it
  //    and the panel advances to the other one; "1" again, nothing left.
  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await loginViaUiAs(reviewer, REVIEWER_B_EMAIL, FIXTURE_PASSWORD);
  await reviewer.goto(SCREENING_URL);
  await reviewer.getByRole("button", { name: "Start screening" }).click();
  const first = await openRecordTitle(reviewer);
  await includeOpenRecord(reviewer);
  const second = first === ALPHA.title ? BETA.title : ALPHA.title;
  await expect(reviewer.getByRole("heading", { name: second, exact: true })).toBeVisible();
  await expect(reviewer.getByTestId("next-record-announcement")).toHaveText(`Next record: ${second}`);
  await includeOpenRecord(reviewer);
  // The panel opened maximized over the list; closing it shows the progress strip.
  await reviewer.getByRole("button", { name: "Toggle the record panel" }).click();
  await expect(reviewer.getByText(/you: 0 left/)).toBeVisible();
  await reviewerContext.close();

  // 3. Reviewer C by API: agrees on Alpha, disagrees on Beta.
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

  // 5. Owner: PRISMA counts the outcomes.
  await owner.goto(PRISMA_URL);
  await expect(owner.getByRole("heading", { name: "PRISMA counts" })).toBeVisible();
  // total = 3 articles, removed = 1 (the merged duplicate), enrolled = 2.
  for (const name of [
    "Manual 3", // every project article is manual-sourced, removed ones included
    "Records identified 3", // identified_total = sum of the source counts = total
    "Duplicates removed 1", // identified_total - total + removed = 3 - 3 + 1
    "Records screened 2", // enrolled records with an assignment
    "Records excluded 1", // Beta, ruled exclude
    "Sought for retrieval 1", // Alpha, included by both
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
  expect(config.not_enrolled).toBe(3); // total 3, none removed after the reset

  const prisma = await apiGet<PrismaResponse>(`/projects/${SCREENING_PROJECT_ID}/prisma`, ownerToken);
  expect(prisma.screened).toBe(0);
  expect(prisma.other_removed).toBe(3); // total - enrolled - removed = 3 - 0 - 0
});

/**
 * Title/abstract screening end to end, on its own project
 * (SCREENING_PROJECT_ID): the owner sets two reviewers per record and
 * enrolls; reviewer B screens both records by keyboard; reviewer C decides by
 * API (agreeing on Alpha, disagreeing on Beta); the owner arbitrates the
 * conflict with C's decision; the PRISMA tab counts the outcomes.
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
  REVIEWER_C_NAME,
  SCREENING_ARTICLES,
  SCREENING_PROJECT_ID,
} from "../_fixtures/fixture-ids";
import { resetScreeningProject } from "../_fixtures/screening";

const [ALPHA, BETA] = SCREENING_ARTICLES;
const SCREENING_URL = `/projects/${SCREENING_PROJECT_ID}?tab=screening`;
const PRISMA_URL = `/projects/${SCREENING_PROJECT_ID}?tab=prisma`;

interface QueueResponse {
  items: Array<{ assignment_id: string; article: { id: string; title: string } }>;
}

interface ConfigResponse {
  reviewer_count: number | null;
  enrolled: number;
  not_enrolled: number;
}

interface PrismaResponse {
  screened: number;
  imported_not_enrolled: number;
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

/**
 * Press "1" (include) on the record on screen and wait for the decision's
 * response. Decisions are final: there is no change step afterwards. The
 * buttons are enabled only once the previous decision settled, which also
 * releases the queue's one-decision-at-a-time guard.
 */
async function includeCurrentRecord(page: Page) {
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

  // 1. Owner: two reviewers per record, then enroll both articles.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await loginViaUiAs(owner, OWNER_EMAIL, FIXTURE_PASSWORD);
  await owner.goto(SCREENING_URL);
  await owner.getByRole("radio", { name: "2 reviewers" }).check();
  await owner.getByRole("button", { name: "Save" }).click();
  await owner.getByRole("button", { name: "Enroll all articles" }).click();
  await expect(owner.getByText("2 enrolled", { exact: true })).toBeVisible();

  // 2. Reviewer B: include both records from the keyboard.
  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await loginViaUiAs(reviewer, REVIEWER_B_EMAIL, FIXTURE_PASSWORD);
  await reviewer.goto(SCREENING_URL);
  await expect(reviewer.getByRole("heading", { name: /^E2E Screening (Alpha|Beta)$/ })).toBeVisible();
  await includeCurrentRecord(reviewer);
  await expect(reviewer.getByRole("heading", { name: /^E2E Screening (Alpha|Beta)$/ })).toBeVisible();
  await includeCurrentRecord(reviewer);
  await expect(reviewer.getByRole("heading", { name: "Waiting on other reviewers" })).toBeVisible();
  await reviewerContext.close();

  // 3. Reviewer C by API: agrees on Alpha, disagrees on Beta.
  const reviewerCToken = await login(REVIEWER_C_EMAIL, FIXTURE_PASSWORD);
  const queue = await apiGet<QueueResponse>(`/projects/${SCREENING_PROJECT_ID}/screening/queue`, reviewerCToken);
  expect(queue.items).toHaveLength(2);
  const assignmentOf = (articleId: string) => {
    const item = queue.items.find((i) => i.article.id === articleId);
    expect(item, `no queue item for ${articleId}`).toBeDefined();
    return item!.assignment_id;
  };
  await decideByApi(reviewerCToken, assignmentOf(ALPHA.id), "include");
  await decideByApi(reviewerCToken, assignmentOf(BETA.id), "exclude");

  // 4. Owner: rule on the conflict with reviewer C's decision.
  await owner.reload();
  await owner.getByRole("tab", { name: "Conflicts (1)" }).click();
  const card = owner.getByRole("listitem").filter({ has: owner.getByRole("button", { name: BETA.title }) });
  await card.getByRole("button", { name: `Use ${REVIEWER_C_NAME}'s decision` }).click();
  await expect(owner.getByRole("heading", { name: "No conflicts to resolve" })).toBeVisible();

  // 5. Owner: PRISMA counts the outcomes.
  await owner.goto(PRISMA_URL);
  await expect(owner.getByRole("heading", { name: "PRISMA counts" })).toBeVisible();
  for (const name of [
    "Manual 2",
    "Records identified 2",
    "Duplicates removed 0",
    "Records screened 2",
    "Records excluded 1",
    "Sought for retrieval 1",
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
  expect(config.not_enrolled).toBe(2);

  const prisma = await apiGet<PrismaResponse>(`/projects/${SCREENING_PROJECT_ID}/prisma`, ownerToken);
  expect(prisma.screened).toBe(0);
  expect(prisma.imported_not_enrolled).toBe(2);
});

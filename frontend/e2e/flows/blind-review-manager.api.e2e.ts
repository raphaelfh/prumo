/**
 * Manager blind-review + per-kind reveal (API E2E).
 *
 * Proves the server-side blinding contract that backs the shared compare view:
 *  - A manager is blind by default: GET /runs/{id}/view returns only their OWN
 *    reviewer decisions, not peers'.
 *  - Flipping the per-kind `managers_see_reviewers` setting on (via
 *    PUT /projects/{id}/manager-review-visibility) reveals peer decisions LIVE.
 *  - Per-kind independence: turning EXTRACTION visibility on does NOT unblind a
 *    quality_assessment run.
 *  - A reviewer is ALWAYS blind, regardless of the manager setting (the hard
 *    reviewer↔reviewer boundary).
 *
 * Roles come from the shared fixture seed (`ensure-fixtures.ts`): the logged-in
 * E2E user (owner) is a project `manager`; `E2E_RATE_LIMIT_TOKEN` is a
 * `reviewer`. We assert on `decisionsByCoord` shape via distinct reviewer ids
 * rather than hard-coding user ids: blind ⇒ exactly the caller's own row;
 * revealed ⇒ the caller's row plus the peer's.
 *
 * Serial because the setting is project-level shared state; each test
 * normalizes both kinds to false before exercising its case.
 */

import { expect, test } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, resolveAuthToken } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { QA_BLIND_REVIEW_ARTICLE_ID } from "../_fixtures/fixture-ids";
import { prepareCleanQaRun } from "../_fixtures/hitl";
import type { ReviewKind } from "../../lib/comparison/permissions";

interface ReviewerDecision {
  id: string;
  reviewer_id: string;
  instance_id: string;
  field_id: string;
  decision: string;
  value: { value: unknown } | null;
}

interface RunViewResponse {
  run: { id: string; stage: string };
  decisions: ReviewerDecision[];
}

const REQUIRED = [
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "E2E_PROJECT_ID",
  "E2E_ARTICLE_ID",
  "E2E_QA_GLOBAL_TEMPLATE_ID",
  "E2E_RATE_LIMIT_TOKEN",
];

type Kind = ReviewKind;

test.describe.configure({ mode: "serial" });

test.describe("Manager blind-review + per-kind reveal", () => {
  // — helpers (closure-free; take everything they need) —

  async function setVisibility(
    ctx: { request: import("@playwright/test").APIRequestContext; apiUrl: string; token: string; projectId: string; traceId: string },
    kind: Kind,
    value: boolean,
  ): Promise<void> {
    const res = await ctx.request.put(
      `${ctx.apiUrl}/api/v1/projects/${ctx.projectId}/manager-review-visibility`,
      {
        headers: authHeaders(ctx.token, ctx.traceId),
        data: { kind, managers_see_reviewers: value },
        timeout: 15000,
      },
    );
    expect(res.ok(), `PUT manager-review-visibility ${kind}=${value}`).toBeTruthy();
  }

  async function recordDecision(
    ctx: { request: import("@playwright/test").APIRequestContext; apiUrl: string; traceId: string },
    token: string,
    runId: string,
    instanceId: string,
    fieldId: string,
    value: string,
  ): Promise<void> {
    const res = await ctx.request.post(
      `${ctx.apiUrl}/api/v1/runs/${runId}/decisions`,
      {
        headers: authHeaders(token, ctx.traceId),
        data: {
          instance_id: instanceId,
          field_id: fieldId,
          decision: "edit",
          value: { value },
        },
        timeout: 15000,
      },
    );
    expect(res.ok(), `record decision (${value})`).toBeTruthy();
  }

  async function viewDecisionsForCoord(
    ctx: { request: import("@playwright/test").APIRequestContext; apiUrl: string; traceId: string },
    token: string,
    runId: string,
    instanceId: string,
    fieldId: string,
  ): Promise<ReviewerDecision[]> {
    const res = await ctx.request.get(`${ctx.apiUrl}/api/v1/runs/${runId}/view`, {
      headers: authHeaders(token, ctx.traceId),
      timeout: 15000,
    });
    expect(res.ok(), "GET /runs/{id}/view").toBeTruthy();
    const view = (await parseEnvelope<RunViewResponse>(res)).data;
    return view.decisions.filter(
      (d) => d.instance_id === instanceId && d.field_id === fieldId,
    );
  }

  test("manager is blind by default and the per-kind toggle reveals peers live", async ({
    page,
    request,
  }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    const reviewerToken = process.env.E2E_RATE_LIMIT_TOKEN!;
    const qaTemplateId = process.env.E2E_QA_GLOBAL_TEMPLATE_ID!;
    await loginViaUi(page);
    const managerToken = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-blind-manager-reveal");
    const base = { request, apiUrl: env.apiUrl, traceId };
    const mgr = { ...base, token: managerToken, projectId: env.projectId! };

    const { runId, firstInstanceId, firstField } = await prepareCleanQaRun({
      request,
      apiUrl: env.apiUrl,
      token: managerToken,
      projectId: env.projectId!,
      articleId: QA_BLIND_REVIEW_ARTICLE_ID,
      qaTemplateId,
      traceId,
    });

    // Manager records their own value; a reviewer records a divergent one.
    await recordDecision(base, managerToken, runId, firstInstanceId, firstField.id, "Y");
    await recordDecision(base, reviewerToken, runId, firstInstanceId, firstField.id, "N");

    // Baseline: both kinds blind.
    await setVisibility(mgr, "extraction", false);
    await setVisibility(mgr, "quality_assessment", false);

    // Blind: the manager sees only their own decision on the coord.
    const blind = await viewDecisionsForCoord(base, managerToken, runId, firstInstanceId, firstField.id);
    const blindReviewers = new Set(blind.map((d) => d.reviewer_id));
    expect(blindReviewers.size, "blind manager sees exactly one reviewer (self)").toBe(1);
    expect(
      blind.some((d) => (d.value?.value ?? null) === "N"),
      "peer's 'N' must NOT leak to a blind manager",
    ).toBe(false);

    // Reveal QA → the peer decision appears LIVE (no run re-creation).
    await setVisibility(mgr, "quality_assessment", true);
    const revealed = await viewDecisionsForCoord(base, managerToken, runId, firstInstanceId, firstField.id);
    const revealedReviewers = new Set(revealed.map((d) => d.reviewer_id));
    expect(revealedReviewers.size, "revealed manager sees both reviewers").toBe(2);
    expect(
      revealed.some((d) => (d.value?.value ?? null) === "N"),
      "peer's 'N' is visible after reveal",
    ).toBe(true);
    // The blind set is a strict subset of the revealed set.
    for (const r of blindReviewers) expect(revealedReviewers.has(r)).toBe(true);

    // Cleanup: back to blind.
    await setVisibility(mgr, "quality_assessment", false);
  });

  test("extraction visibility is independent — it does not unblind a QA run", async ({
    page,
    request,
  }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    const reviewerToken = process.env.E2E_RATE_LIMIT_TOKEN!;
    const qaTemplateId = process.env.E2E_QA_GLOBAL_TEMPLATE_ID!;
    await loginViaUi(page);
    const managerToken = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-blind-per-kind");
    const base = { request, apiUrl: env.apiUrl, traceId };
    const mgr = { ...base, token: managerToken, projectId: env.projectId! };

    const { runId, firstInstanceId, firstField } = await prepareCleanQaRun({
      request,
      apiUrl: env.apiUrl,
      token: managerToken,
      projectId: env.projectId!,
      articleId: QA_BLIND_REVIEW_ARTICLE_ID,
      qaTemplateId,
      traceId,
    });
    await recordDecision(base, managerToken, runId, firstInstanceId, firstField.id, "Y");
    await recordDecision(base, reviewerToken, runId, firstInstanceId, firstField.id, "N");

    // Normalize, then turn ONLY extraction on — the QA run must stay blind.
    await setVisibility(mgr, "quality_assessment", false);
    await setVisibility(mgr, "extraction", true);

    const stillBlind = await viewDecisionsForCoord(base, managerToken, runId, firstInstanceId, firstField.id);
    expect(
      new Set(stillBlind.map((d) => d.reviewer_id)).size,
      "QA run stays blind when only extraction visibility is on",
    ).toBe(1);
    expect(stillBlind.some((d) => (d.value?.value ?? null) === "N")).toBe(false);

    // Flipping the matching kind (QA) is what reveals it — confirms the gate
    // keys on the run's kind, not any visibility flag.
    await setVisibility(mgr, "quality_assessment", true);
    const nowRevealed = await viewDecisionsForCoord(base, managerToken, runId, firstInstanceId, firstField.id);
    expect(new Set(nowRevealed.map((d) => d.reviewer_id)).size).toBe(2);

    // Cleanup: both back to blind.
    await setVisibility(mgr, "extraction", false);
    await setVisibility(mgr, "quality_assessment", false);
  });

  test("a reviewer is always blind, even when the manager reveal is on", async ({
    page,
    request,
  }) => {
    const missing = missingEnvKeys(REQUIRED);
    test.skip(missing.length > 0, `Missing required env: ${missing.join(", ")}`);

    const env = loadE2EEnv();
    const reviewerToken = process.env.E2E_RATE_LIMIT_TOKEN!;
    const qaTemplateId = process.env.E2E_QA_GLOBAL_TEMPLATE_ID!;
    await loginViaUi(page);
    const managerToken = await resolveAuthToken(page);
    const traceId = createTraceId("e2e-blind-reviewer-hard");
    const base = { request, apiUrl: env.apiUrl, traceId };
    const mgr = { ...base, token: managerToken, projectId: env.projectId! };

    const { runId, firstInstanceId, firstField } = await prepareCleanQaRun({
      request,
      apiUrl: env.apiUrl,
      token: managerToken,
      projectId: env.projectId!,
      articleId: QA_BLIND_REVIEW_ARTICLE_ID,
      qaTemplateId,
      traceId,
    });
    await recordDecision(base, managerToken, runId, firstInstanceId, firstField.id, "Y");
    await recordDecision(base, reviewerToken, runId, firstInstanceId, firstField.id, "N");

    // Manager turns QA reveal ON — this must NOT affect the reviewer.
    await setVisibility(mgr, "quality_assessment", true);

    const reviewerView = await viewDecisionsForCoord(base, reviewerToken, runId, firstInstanceId, firstField.id);
    expect(
      new Set(reviewerView.map((d) => d.reviewer_id)).size,
      "reviewer sees only their own decision regardless of the manager setting",
    ).toBe(1);
    expect(
      reviewerView.some((d) => (d.value?.value ?? null) === "Y"),
      "the manager's 'Y' must NOT leak to a reviewer",
    ).toBe(false);
    expect(reviewerView.some((d) => (d.value?.value ?? null) === "N")).toBe(true);

    // Cleanup.
    await setVisibility(mgr, "quality_assessment", false);
  });
});

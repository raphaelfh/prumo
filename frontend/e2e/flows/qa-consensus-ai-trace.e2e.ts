/**
 * Consensus AI trace round trip (spec 2026-07-04, D0→D8).
 *
 * Scenario A (extraction): a reviewer adopts AI suggestions in the UI
 * (including the same-value adoption the [value, link] autosave fingerprint
 * fixed), the decisions persist with `proposal_record_id`, and the consensus
 * compare table renders the per-reviewer AI trace — read-only popover,
 * "Adopted by {name}" attribution, "Run by {name}" group headers (the ran-by
 * scrub's arbitrator auto-reveal carve-out, end-to-end), the honest "Manual"
 * chip, and no dead compare affordances (D6). The arbitrator adopts the
 * reviewer's value and the resolved summary attributes it.
 *
 * Scenario B (QA decisions parity, D8): QA form writes go to /decisions
 * (ZERO human /proposals writes), rehydrate through current_values, the
 * advance materializes decisions the compare table + select_existing can
 * use, and the single-user export job completes.
 *
 * File name rides the `local-hitl` project's `qa-*.e2e.ts` glob: single
 * worker, serial — both scenarios hard-reset runs on the dedicated
 * TRACE_ARTICLE_ID and must never run in parallel with themselves or the
 * other QA suites. NEVER point this at prod: it mutates fixture state.
 */

import { expect, test, type Page } from "@playwright/test";

import { authHeaders, parseEnvelope } from "../_fixtures/api";
import { loginViaUi, loginViaUiAs } from "../_fixtures/auth";
import { createTraceId, loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import {
  FIXTURE_PASSWORD,
  OWNER_NAME,
  REVIEWER_B_EMAIL,
  REVIEWER_B_NAME,
  TRACE_ARTICLE_ID,
} from "../_fixtures/fixture-ids";
import { prepareCleanQaRun } from "../_fixtures/hitl";
import {
  adminDelete,
  adminSelect,
  adminUpdate,
  resolveActiveExtractionTemplateId,
  seedProposals,
} from "../_fixtures/supabase-admin";

interface RunViewResponse {
  run: { id: string; stage: string };
  decisions: Array<{
    id: string;
    instance_id: string;
    field_id: string;
    reviewer_id: string;
    decision: string;
    proposal_record_id: string | null;
    value: { value: unknown } | null;
    created_at: string;
  }>;
  consensus_decisions: Array<{ instance_id: string; field_id: string }>;
}

interface Coord {
  instanceId: string;
  fieldId: string;
  label: string;
  sectionLabel: string;
}

const A_TYPED_COORD2 = "Multicenter registry data";
const AI_COORD1 = "Retrospective cohort";
const B_DIVERGENT_COORD1 = "Prospective cohort";
const A_TYPED_COORD3 = "Manually recorded detail";

test.describe.configure({ mode: "serial" });

/** Newest decision for a coord in a /view payload (append-only trail). */
function newestDecision(
  view: RunViewResponse,
  coord: Coord,
): RunViewResponse["decisions"][number] | undefined {
  return view.decisions
    .filter(
      (d) => d.instance_id === coord.instanceId && d.field_id === coord.fieldId,
    )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Open the section accordion containing the coord if its row is hidden.
 *  The accordion header button reads "{label} {done}/{total} {pct}%" — the
 *  nav rail renders a similar "{label} {done}/{total}" button, so anchor on
 *  the trailing percent to hit the header, and only click when collapsed. */
async function ensureFieldVisible(page: Page, coord: Coord): Promise<void> {
  const row = fieldRow(page, coord);
  if (await row.isVisible().catch(() => false)) return;
  const header = page
    .getByRole("button", {
      name: new RegExp(`^${escapeRegex(coord.sectionLabel)} \\d+/\\d+ \\d+%`),
    })
    .first();
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
  }
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.scrollIntoViewIfNeeded();
}

/** The text input for a coord — the placeholder is
 *  `Enter {label.toLowerCase()}` (fieldPlaceholderEnter) and the full label
 *  keeps it unique within the template. (The shadcn Input renders without an
 *  explicit type attribute, so input[type='text'] selectors match nothing.) */
function fieldInput(page: Page, coord: Coord) {
  return page.getByPlaceholder(`Enter ${coord.label.toLowerCase()}`, {
    exact: true,
  });
}

/** The FieldInput row for a coord — anchored on its input's placeholder. */
function fieldRow(page: Page, coord: Coord) {
  return page
    .locator("[data-field-row]")
    .filter({ has: fieldInput(page, coord) })
    .first();
}

/** One /view fetch, shared by every persistence poll in this suite. */
async function fetchView(
  request: import("@playwright/test").APIRequestContext,
  apiUrl: string,
  runId: string,
  token: string,
  traceId: string,
): Promise<RunViewResponse> {
  const res = await request.get(`${apiUrl}/api/v1/runs/${runId}/view`, {
    headers: authHeaders(token, traceId),
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await parseEnvelope<RunViewResponse>(res)).data;
}

test.describe("Consensus AI trace (D0→D8 round trip)", () => {
  test("Scenario A: extraction adoption → consensus trace", async ({
    page,
    browser,
    request,
  }) => {
    test.setTimeout(240_000);
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
      "E2E_AUTH_TOKEN",
      "E2E_USER_ID",
      "E2E_REVIEWER_C_TOKEN",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    const projectId = env.projectId!;
    const ownerToken = process.env.E2E_AUTH_TOKEN!;
    const ownerId = process.env.E2E_USER_ID!;
    const reviewerCToken = process.env.E2E_REVIEWER_C_TOKEN!;
    const traceId = createTraceId("e2e-consensus-ai-trace");

    // --- Provision: fresh extraction run in `extract` on the trace article.
    await adminDelete(
      "extraction_runs",
      `project_id=eq.${projectId}&article_id=eq.${TRACE_ARTICLE_ID}&kind=eq.extraction`,
    );
    const templateId = await resolveActiveExtractionTemplateId(projectId);
    const sessionRes = await request.post(`${env.apiUrl}/api/v1/hitl/sessions`, {
      headers: authHeaders(ownerToken, traceId),
      data: {
        kind: "extraction",
        project_id: projectId,
        article_id: TRACE_ARTICLE_ID,
        project_template_id: templateId,
      },
      timeout: 30_000,
    });
    expect(sessionRes.ok(), await sessionRes.text()).toBeTruthy();
    const session = (
      await parseEnvelope<{
        run_id: string;
        instances_by_entity_type: Record<string, string>;
      }>(sessionRes)
    ).data;
    const runId = session.run_id;

    const stageRes = await request.get(`${env.apiUrl}/api/v1/runs/${runId}`, {
      headers: authHeaders(ownerToken, traceId),
    });
    const stage = (await parseEnvelope<{ run: { stage: string } }>(stageRes))
      .data.run.stage;
    if (stage !== "extract") {
      const adv = await request.post(
        `${env.apiUrl}/api/v1/runs/${runId}/advance`,
        {
          headers: authHeaders(ownerToken, traceId),
          data: { target_stage: "extract" },
        },
      );
      expect(adv.ok(), await adv.text()).toBeTruthy();
    }

    // --- Discover three text-field coords (prefer one section for less
    // accordion juggling; fall back to spanning sections).
    //
    // Sourced from the RUN VIEW, not the live extraction_* tables. The form
    // renders from the run's frozen version snapshot, while the live tables
    // are shared mutable state: `extraction-multi-instance.e2e.ts` (a
    // different Playwright project, running concurrently) injects a
    // "Field Zoo" entity type into this same project template without
    // republishing its version. A live-table picker could therefore select a
    // field whose section the screen can never render — the test then waited
    // the full 240s for a "Field Zoo …%" accordion header that does not
    // exist. Reading the snapshot makes the picker agree with the DOM by
    // construction. Ordering is explicit for the same reason: neither
    // PostgREST nor the payload guarantees row order, and `.slice(0, 3)` on
    // an unordered set is a coin flip.
    const runViewRes = await request.get(`${env.apiUrl}/api/v1/runs/${runId}/view`, {
      headers: authHeaders(ownerToken, traceId),
    });
    expect(runViewRes.ok(), await runViewRes.text()).toBeTruthy();
    const runView = (
      await parseEnvelope<{
        entity_types: {
          id: string;
          label: string;
          sort_order: number;
          fields: { id: string; label: string; field_type: string; sort_order: number }[];
        }[];
      }>(runViewRes)
    ).data;

    const coords: Coord[] = runView.entity_types
      .filter((et) => session.instances_by_entity_type[et.id])
      .sort((a, b) => a.sort_order - b.sort_order)
      .flatMap((et) =>
        [...et.fields]
          .filter((f) => f.field_type === "text")
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((f) => ({
            instanceId: session.instances_by_entity_type[et.id],
            fieldId: f.id,
            label: f.label,
            sectionLabel: et.label,
          })),
      )
      .slice(0, 3);
    test.skip(coords.length < 3, "CHARMS clone exposes fewer than 3 text fields");
    const [coord1, coord2, coord3] = coords;

    // --- Seed AI proposals directly in the table + run provenance so the
    // popover's ran-by header has an identity to reveal (proposal rows alone
    // don't write results.provenance).
    await seedProposals([
      {
        runId,
        instanceId: coord1.instanceId,
        fieldId: coord1.fieldId,
        source: "ai",
        value: AI_COORD1,
        confidenceScore: 0.9,
        rationale: "e2e seeded",
      },
      {
        runId,
        instanceId: coord2.instanceId,
        fieldId: coord2.fieldId,
        source: "ai",
        value: A_TYPED_COORD2,
        confidenceScore: 0.9,
        rationale: "e2e seeded",
      },
    ]);
    await adminUpdate("extraction_runs", `id=eq.${runId}`, {
      results: { provenance: { model: "e2e-seed", ran_by_user_id: ownerId } },
    });

    // --- Reviewer A (E2E Reviewer Bela) drives the form in her own context.
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    const tokenA = await loginViaUiAs(pageA, REVIEWER_B_EMAIL, FIXTURE_PASSWORD);

    const viewAsA = () => fetchView(request, env.apiUrl, runId, tokenA, traceId);

    await pageA.goto(
      `${env.frontendUrl}/projects/${projectId}/extraction/${TRACE_ARTICLE_ID}`,
    );
    await expect(pageA.locator("[data-field-row]").first()).toBeVisible({
      timeout: 30_000,
    });

    // (2a) Type into coord2 FIRST and wait for the write to land — the
    // same-value adoption below must be a LINK-ONLY change on a clean value.
    await ensureFieldVisible(pageA, coord2);
    await fieldInput(pageA, coord2).fill(A_TYPED_COORD2);
    await expect
      .poll(
        async () => newestDecision(await viewAsA(), coord2)?.value?.value,
        { timeout: 20_000, intervals: [500, 1000] },
      )
      .toBe(A_TYPED_COORD2);

    // (2b) Accept the AI suggestion on coord2 — value byte-identical, the
    // regression the [value, link] fingerprint fixed. (The button reads
    // "Accept suggestion", or "Suggestion accepted" if a refetch already
    // mirrored the typed decision's server status; clicking fires either way.)
    const acceptOn = async (coord: Coord) => {
      await ensureFieldVisible(pageA, coord);
      await fieldRow(pageA, coord)
        .getByRole("button", { name: /accept suggestion|suggestion accepted/i })
        .first()
        .click();
    };
    await acceptOn(coord2);
    await acceptOn(coord1);

    // (2c) Fill coord3 manually — no AI proposal exists there.
    await ensureFieldVisible(pageA, coord3);
    await fieldInput(pageA, coord3).fill(A_TYPED_COORD3);

    // (3) Persistence: the adoptions carry the AI link; the manual coord
    // does not (D0 write path, server-validated).
    await expect
      .poll(
        async () => {
          const view = await viewAsA();
          return {
            c1: newestDecision(view, coord1)?.proposal_record_id != null,
            c2: newestDecision(view, coord2)?.proposal_record_id != null,
            c3: newestDecision(view, coord3)?.proposal_record_id ?? null,
            c3Value: newestDecision(view, coord3)?.value?.value ?? null,
          };
        },
        { timeout: 20_000, intervals: [500, 1000] },
      )
      .toEqual({ c1: true, c2: true, c3: null, c3Value: A_TYPED_COORD3 });
    await ctxA.close();

    // (4) Reviewer B (E2E Reviewer Cora) records a divergent value on coord1.
    const decisionB = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/decisions`,
      {
        headers: authHeaders(reviewerCToken, traceId),
        data: {
          instance_id: coord1.instanceId,
          field_id: coord1.fieldId,
          decision: "edit",
          value: { value: B_DIVERGENT_COORD1 },
        },
        timeout: 15_000,
      },
    );
    expect(decisionB.ok(), await decisionB.text()).toBeTruthy();

    // (5) Manager/arbitrator: start consensus and open the resolve table.
    const advConsensus = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/advance`,
      {
        headers: authHeaders(ownerToken, traceId),
        data: { target_stage: "consensus" },
      },
    );
    expect(advConsensus.ok(), await advConsensus.text()).toBeTruthy();

    await loginViaUi(page);
    await page.goto(
      `${env.frontendUrl}/projects/${projectId}/extraction/${TRACE_ARTICLE_ID}`,
    );
    await expect(page.getByTestId("run-reviewer-comparison")).toBeVisible({
      timeout: 30_000,
    });

    // Divergent rows need attention → coord1 visible under the default
    // filter; show ALL rows so coord2/coord3 assertions can run too.
    await page.getByTestId("consensus-filter-all").click();

    const row1 = page.getByTestId(
      `consensus-coord-${coord1.instanceId}::${coord1.fieldId}`,
    );
    const row2 = page.getByTestId(
      `consensus-coord-${coord2.instanceId}::${coord2.fieldId}`,
    );
    const row3 = page.getByTestId(
      `consensus-coord-${coord3.instanceId}::${coord3.fieldId}`,
    );

    // (i) coord1 renders both reviewer values; A's cell carries the trace.
    await expect(row1).toContainText(AI_COORD1);
    await expect(row1).toContainText(B_DIVERGENT_COORD1);
    const traceButton1 = row1.getByRole("button", {
      name: `AI used by ${REVIEWER_B_NAME}`,
    });
    await expect(traceButton1).toBeVisible();

    // (ii)+(iii) Both trace popovers (coord2 is the same-value adoption) are
    // READ-ONLY, attribute the adoption, and reveal the runner to the
    // arbitrator — the server-side ran-by scrub's auto-reveal carve-out,
    // end-to-end.
    for (const row of [row1, row2]) {
      await row
        .getByRole("button", { name: `AI used by ${REVIEWER_B_NAME}` })
        .click();
      await expect(page.getByText(`Adopted by ${REVIEWER_B_NAME}`)).toBeVisible();
      await expect(
        page.getByRole("button", { name: /use this version/i }),
      ).toHaveCount(0);
      await expect(page.getByText(`Run by ${OWNER_NAME}`)).toBeVisible();
      await page.keyboard.press("Escape");
    }

    // (iii.b) The per-field AI trace (spec 2026-07-09 D1) rides the field-label
    // row itself — column-independent and endorsement-neutral, the entry point a
    // NON-resolver/viewer also gets. It opens the SAME popover read-only and
    // carries the honest link-primary cross-mark. Present on AI coords (row1),
    // absent on the typed coord (row3).
    const fieldTrace1 = row1.getByRole("button", {
      name: "AI suggestions for this field",
    });
    await expect(fieldTrace1).toBeVisible();
    await fieldTrace1.click();
    await expect(page.getByText(`Adopted by ${REVIEWER_B_NAME}`)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /use this version/i }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // (iv) coord3 (typed, no AI proposal on the coord) shows the honest
    // Manual chip — and no per-field trace icon.
    await expect(row3.getByText("Manual", { exact: true })).toBeVisible();
    await expect(
      row3.getByRole("button", { name: "AI suggestions for this field" }),
    ).toHaveCount(0);

    // (v) Dead affordances stay dead in consensus (D6): no Compare toggle,
    // and the status popover offers no divergence jump.
    await expect(
      page.getByRole("button", { name: "Toggle comparison mode" }),
    ).toHaveCount(0);
    await page.getByTestId("run-stage-current").click();
    await expect(page.getByTestId("run-status-popover")).toBeVisible();
    await expect(
      page
        .getByTestId("run-status-popover")
        .getByRole("button", { name: /^view$/i }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // (6) Adopt A's coord1 value → the resolved summary attributes it.
    await row1
      .locator("td")
      .filter({ hasText: AI_COORD1 })
      .first()
      .getByRole("button", { name: /publish this reviewer/i })
      .click();
    await expect(row1.getByText(`from ${REVIEWER_B_NAME}`)).toBeVisible({
      timeout: 15_000,
    });
    // The consensus decision persisted (finalize itself is covered by the
    // dedicated finalize-gate suites — full CHARMS completeness is out of
    // scope for this trace flow).
    await expect
      .poll(async () => {
        const view = await fetchView(request, env.apiUrl, runId, ownerToken, traceId);
        return view.consensus_decisions.some(
          (c) =>
            c.instance_id === coord1.instanceId &&
            c.field_id === coord1.fieldId,
        );
      })
      .toBe(true);
  });

  test("Scenario B: QA decisions parity (D8)", async ({ page, request }) => {
    test.setTimeout(240_000);
    const required = missingEnvKeys([
      "E2E_USER_EMAIL",
      "E2E_USER_PASSWORD",
      "E2E_PROJECT_ID",
      "E2E_AUTH_TOKEN",
      "E2E_USER_ID",
      "E2E_QA_GLOBAL_TEMPLATE_ID",
      "E2E_RATE_LIMIT_TOKEN",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const env = loadE2EEnv();
    const projectId = env.projectId!;
    const ownerToken = process.env.E2E_AUTH_TOKEN!;
    const ownerId = process.env.E2E_USER_ID!;
    const reviewerBToken = process.env.E2E_RATE_LIMIT_TOKEN!;
    const qaTemplateId = process.env.E2E_QA_GLOBAL_TEMPLATE_ID!;
    const traceId = createTraceId("e2e-qa-parity");

    const fixture = await prepareCleanQaRun({
      request,
      apiUrl: env.apiUrl,
      token: ownerToken,
      projectId,
      articleId: TRACE_ARTICLE_ID,
      qaTemplateId,
      traceId,
    });
    const { runId } = fixture;

    // (1) Answer two signaling questions in the UI while recording every
    // run write: the form must POST /decisions and NEVER /proposals.
    const decisionPosts: string[] = [];
    const proposalPosts: string[] = [];
    page.on("request", (req) => {
      if (req.method() !== "POST") return;
      const url = req.url();
      if (/\/api\/v1\/runs\/[^/]+\/decisions$/.test(url)) decisionPosts.push(url);
      if (/\/api\/v1\/runs\/[^/]+\/proposals$/.test(url)) proposalPosts.push(url);
    });

    await loginViaUi(page);
    await page.goto(
      `${env.frontendUrl}/projects/${projectId}/articles/${TRACE_ARTICLE_ID}/quality-assessment/${fixture.projectTemplateId}`,
    );
    const combos = page.locator("[data-field-row] [role='combobox']");
    await expect(combos.first()).toBeVisible({ timeout: 30_000 });

    const pickedLabels: string[] = [];
    for (const index of [0, 1]) {
      await combos.nth(index).click();
      const option = page.locator("[role='option']").first();
      await expect(option).toBeVisible();
      pickedLabels.push((await option.innerText()).trim());
      await option.click();
    }

    // Both answers land as decisions.
    await expect
      .poll(
        async () => {
          const view = await fetchView(request, env.apiUrl, runId, ownerToken, traceId);
          return view.decisions.filter((d) => d.decision === "edit").length;
        },
        { timeout: 20_000, intervals: [500, 1000] },
      )
      .toBeGreaterThanOrEqual(2);
    expect(decisionPosts.length).toBeGreaterThanOrEqual(2);
    expect(proposalPosts).toEqual([]);

    // (2) Reload → both answers rehydrate (current_values read path).
    await page.reload();
    await expect(combos.first()).toBeVisible({ timeout: 30_000 });
    await expect(combos.nth(0)).toContainText(pickedLabels[0]);
    await expect(combos.nth(1)).toContainText(pickedLabels[1]);

    // (3) A second reviewer diverges on one answered coord (agreed rows are
    // non-actionable by design — select_existing needs a conflict) and
    // leaves a pre-D8-style human PROPOSAL on an untouched coord, so the
    // advance's one-shot materialization is exercised end-to-end.
    const viewNow = await fetchView(request, env.apiUrl, runId, ownerToken, traceId);
    const ownerDecisions = viewNow.decisions.filter(
      (d) => d.decision === "edit" && d.reviewer_id === ownerId,
    );
    expect(ownerDecisions.length).toBeGreaterThanOrEqual(2);
    const conflictCoord = ownerDecisions[0];
    const answered = new Set(
      ownerDecisions.map((d) => `${d.instance_id}::${d.field_id}`),
    );
    const qaFields = await adminSelect<{ id: string }>(
      "extraction_fields",
      `select=id&entity_type_id=eq.${fixture.firstEntityTypeId}`,
    );
    const untouchedField = qaFields.find(
      (f) => !answered.has(`${fixture.firstInstanceId}::${f.id}`),
    );
    expect(untouchedField, "PROBAST section has an unanswered field").toBeTruthy();

    const divergent = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/decisions`,
      {
        headers: authHeaders(reviewerBToken, traceId),
        data: {
          instance_id: conflictCoord.instance_id,
          field_id: conflictCoord.field_id,
          decision: "edit",
          value: { value: "e2e-divergent-answer" },
        },
        timeout: 15_000,
      },
    );
    expect(divergent.ok(), await divergent.text()).toBeTruthy();
    const reviewerBId = (
      await parseEnvelope<{ reviewer_id: string }>(divergent)
    ).data!.reviewer_id;

    // The human-proposal write path is closed for QA too: the route itself is
    // gone (ADR-0019), so an API client replaying the pre-D8 write gets a 404.
    const rejectedProposal = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/proposals`,
      {
        headers: authHeaders(reviewerBToken, traceId),
        data: {
          instance_id: fixture.firstInstanceId,
          field_id: untouchedField!.id,
          source: "human",
          proposed_value: { value: "PY-materialized" },
        },
        timeout: 15_000,
      },
    );
    expect(rejectedProposal.status()).toBe(404);

    // Pre-D8 mid-flight shape: a bare human proposal with no decision.
    // Legacy rows now exist only as stored data, so seed one the way it
    // actually exists in a pre-D8 database — directly in the table.
    await seedProposals([
      {
        runId,
        instanceId: fixture.firstInstanceId,
        fieldId: untouchedField!.id,
        source: "human",
        sourceUserId: reviewerBId,
        value: "PY-materialized",
      },
    ]);

    // (4) Advance to consensus → materialization converts the bare proposal
    // into Bela's edit decision; the compare table works against real rows
    // and "Use this value" (select_existing) succeeds on the conflict.
    const adv = await request.post(
      `${env.apiUrl}/api/v1/runs/${runId}/advance`,
      {
        headers: authHeaders(ownerToken, traceId),
        data: { target_stage: "consensus" },
      },
    );
    expect(adv.ok(), await adv.text()).toBeTruthy();

    const viewAfter = await fetchView(request, env.apiUrl, runId, ownerToken, traceId);
    const materialized = viewAfter.decisions.find(
      (d) =>
        d.instance_id === fixture.firstInstanceId &&
        d.field_id === untouchedField!.id &&
        d.reviewer_id !== ownerId,
    );
    expect(materialized, "advance materialized the bare human proposal").toBeTruthy();
    expect(materialized!.decision).toBe("edit");
    expect(materialized!.value).toEqual({ value: "PY-materialized" });
    expect(materialized!.proposal_record_id).toBeNull();

    await page.reload();
    await expect(page.getByTestId("run-reviewer-comparison")).toBeVisible({
      timeout: 30_000,
    });
    // The conflict row needs attention (default filter); adopt one side —
    // select_existing must succeed against a real decision row (no 4xx).
    const conflictRow = page.getByTestId(
      `consensus-coord-${conflictCoord.instance_id}::${conflictCoord.field_id}`,
    );
    await expect(conflictRow).toBeVisible();
    await conflictRow
      .getByRole("button", { name: /publish this reviewer/i })
      .first()
      .click();
    // The resolved row leaves the default "Needs attention" filter — assert
    // its attributed summary under "Resolved".
    await expect(page.getByTestId("consensus-filter-resolved")).toContainText(
      "1",
      { timeout: 15_000 },
    );
    await page.getByTestId("consensus-filter-resolved").click();
    await expect(
      conflictRow.getByText(new RegExp(`from (${OWNER_NAME}|${REVIEWER_B_NAME})`)),
    ).toBeVisible({ timeout: 15_000 });

    // (4) Single-user QA export succeeds — pre-D8 the value map was blank.
    // Small exports return the workbook inline (sync path); larger ones
    // return a job envelope to poll. Handle both.
    const exportRes = await request.post(
      `${env.apiUrl}/api/v1/projects/${projectId}/extraction-export`,
      {
        headers: authHeaders(ownerToken, traceId),
        data: {
          template_id: fixture.projectTemplateId,
          mode: "single_user",
          reviewer_id: ownerId,
          article_scope: "selected_only",
          article_ids: [TRACE_ARTICLE_ID],
          include_ai_metadata: false,
          anonymize_reviewer_names: false,
        },
        timeout: 60_000,
      },
    );
    expect(exportRes.ok(), await exportRes.text()).toBeTruthy();
    const contentType = exportRes.headers()["content-type"] ?? "";
    if (contentType.includes("spreadsheet")) {
      const buf = await exportRes.body();
      expect(buf.length).toBeGreaterThan(100);
      expect(buf.slice(0, 4).toString("hex")).toBe("504b0304"); // ZIP magic
    } else {
      const { job_id: jobId } = (
        await parseEnvelope<{ job_id: string }>(exportRes)
      ).data;
      await expect
        .poll(
          async () => {
            const res = await request.get(
              `${env.apiUrl}/api/v1/projects/${projectId}/extraction-export/status/${jobId}`,
              { headers: authHeaders(ownerToken, traceId) },
            );
            if (!res.ok()) return `http-${res.status()}`;
            const body = (
              await parseEnvelope<{
                status: string;
                download_url: string | null;
              }>(res)
            ).data;
            return body.status === "completed" && body.download_url
              ? "completed-with-url"
              : body.status;
          },
          { timeout: 60_000, intervals: [1000, 2000] },
        )
        .toBe("completed-with-url");
    }
    // Value-level non-blankness is pinned by the backend export integration
    // test (test_qa_single_user_export_not_blank_after_advance).
  });
});

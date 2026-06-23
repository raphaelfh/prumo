---
status: draft
last_reviewed: 2026-06-23
owner: '@raphaelfh'
---

# Consensus View Fixes — Phase A (frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the extraction consensus stage a usable, multi-reviewer-adequate reconciliation worklist (scrollable, divergent + needs-attention + agreed sections, role-derived counts, soft-warn finalize, editable resolutions), entirely in the frontend with no migration.

**Architecture:** Pure classification logic (`lib/runs/`) feeds a refactored `ConsensusPanel` rendered as the scrollable left resizable panel (mirroring the QA screen), with the PDF/markdown panel beside it. Reviewer counts come from project membership roles; the finalize action stays in the header but gains a soft warning.

**Tech Stack:** React 19 + TS strict, Vite, TanStack Query, Vitest + Testing Library, in-house i18n (`frontend/lib/copy`), shadcn/Radix.

**Spec:** `docs/superpowers/specs/2026-06-23-consensus-view-fixes-design.md` (Phase A = decisions D1′, D2′, D3′, D4, D5a). Phase B (F optional-rationale migration, G full-envelope compare) is a separate plan.

## Global Constraints

- Frontend tooling runs from the **repo root** (no `frontend/package.json`). Tests: `npm run test:run -- <pattern>` (never bare `npm test` — that is watch mode).
- **React Compiler** (`panicThreshold: 'all_errors'`): no `try/finally` or `throw` inside `try` in component/hook bodies. Put IO in `frontend/services/*` returning `ErrorResult<T>`. This plan adds no IO; keep handlers promise-chain style (`.then().catch()`).
- All user-facing text goes through `frontend/lib/copy/` — never hardcode strings in components.
- Components never call `fetch()` / `supabase.from(...)` directly; data via existing hooks/services.
- TanStack Query keys come from key factories (no raw arrays). This plan reuses existing hooks (`useProjectMembers`), adds none.
- English only for code, comments, copy keys.
- coordKey format is `` `${instanceId}::${fieldId}` `` everywhere (matches `useReviewerSummary`).
- Every interactive element keeps a visible focus state (`focus-visible:ring-*`).

---

## File Structure

- `frontend/lib/runs/reconciliation.ts` — **new.** Pure `classifyReconciliation()` → 4 coord buckets. One responsibility: turn reviewer-summary + template + published into reconciliation states.
- `frontend/lib/runs/reviewerExpectation.ts` — **new.** Pure `countExpectedReviewers()` (role-derived denominator).
- `frontend/lib/runs/finalizeWarning.ts` — **new.** Pure `computeFinalizeWarning()` (soft-gate decision).
- `frontend/components/runs/ConsensusPanel.tsx` — **modify.** Render reconciliation sections; remove `evaluate-all`; remove decision badge; resolved-state + Change; newest-decision-per-coord; required-gap (override-only) rows.
- `frontend/components/runs/header/Reviewers.tsx` — **modify.** Show "N of M" visibly.
- `frontend/pages/ExtractionFullScreen.tsx` — **modify.** ConsensusPanel into the left resizable panel; remove the strip; role-derived `required`; soft-warn in `handleApproveFinalize`.
- `frontend/components/project/settings/ConsensusConfigForm.tsx` — **modify.** Remove the "Reviewers per article" input.
- `frontend/lib/copy/consensus.ts` + `frontend/lib/copy/runs.ts` — **modify.** New/changed copy keys.
- Tests: `frontend/test/reconciliation.test.ts`, `frontend/test/reviewerExpectation.test.ts`, `frontend/test/finalizeWarning.test.ts` (new); `frontend/test/ConsensusPanel.test.tsx`, `frontend/components/runs/header/__tests__/Reviewers.test.tsx` (modify).

---

## Task 1: Reconciliation classification (pure logic)

**Files:**
- Create: `frontend/lib/runs/reconciliation.ts`
- Test: `frontend/test/reconciliation.test.ts`

**Interfaces:**
- Produces: `classifyReconciliation(params: ClassifyParams): ReconciliationBuckets` where
  `ClassifyParams = { divergentCoords: ReadonlySet<string>; decisionCountByCoord: ReadonlyMap<string, number>; participantCount: number; requiredCoords: readonly string[]; publishedCoords: ReadonlySet<string> }`
  and `ReconciliationBuckets = { conflicts: string[]; requiredGaps: string[]; singleFiller: string[]; agreements: string[] }`. All arrays hold coordKeys (`` `${instance}::${field}` ``).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/test/reconciliation.test.ts
import { describe, expect, it } from "vitest";
import { classifyReconciliation } from "@/lib/runs/reconciliation";

const params = (over: Partial<Parameters<typeof classifyReconciliation>[0]>) => ({
  divergentCoords: new Set<string>(),
  decisionCountByCoord: new Map<string, number>(),
  participantCount: 0,
  requiredCoords: [] as string[],
  publishedCoords: new Set<string>(),
  ...over,
});

describe("classifyReconciliation", () => {
  it("puts divergent coords in conflicts (precedence over everything)", () => {
    const r = classifyReconciliation(
      params({
        divergentCoords: new Set(["i::f1"]),
        decisionCountByCoord: new Map([["i::f1", 2]]),
        participantCount: 2,
        requiredCoords: ["i::f1"],
      }),
    );
    expect(r.conflicts).toEqual(["i::f1"]);
    expect(r.requiredGaps).toEqual([]);
    expect(r.singleFiller).toEqual([]);
    expect(r.agreements).toEqual([]);
  });

  it("flags an untouched, unpublished required coord as a required gap", () => {
    const r = classifyReconciliation(
      params({ requiredCoords: ["i::f2"], participantCount: 2 }),
    );
    expect(r.requiredGaps).toEqual(["i::f2"]);
  });

  it("does NOT flag a required coord that is already published", () => {
    const r = classifyReconciliation(
      params({ requiredCoords: ["i::f2"], publishedCoords: new Set(["i::f2"]) }),
    );
    expect(r.requiredGaps).toEqual([]);
  });

  it("flags single-filler: 2 participants but only 1 decision on the coord", () => {
    const r = classifyReconciliation(
      params({
        decisionCountByCoord: new Map([["i::f3", 1]]),
        participantCount: 2,
      }),
    );
    expect(r.singleFiller).toEqual(["i::f3"]);
    expect(r.agreements).toEqual([]);
  });

  it("treats a coord all participants filled (non-divergent) as agreement", () => {
    const r = classifyReconciliation(
      params({
        decisionCountByCoord: new Map([["i::f4", 2]]),
        participantCount: 2,
      }),
    );
    expect(r.agreements).toEqual(["i::f4"]);
    expect(r.singleFiller).toEqual([]);
  });

  it("solo reviewer (1 participant) is agreement, never single-filler", () => {
    const r = classifyReconciliation(
      params({
        decisionCountByCoord: new Map([["i::f5", 1]]),
        participantCount: 1,
      }),
    );
    expect(r.agreements).toEqual(["i::f5"]);
    expect(r.singleFiller).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- reconciliation.test`
Expected: FAIL — "Failed to resolve import '@/lib/runs/reconciliation'".

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/lib/runs/reconciliation.ts
/**
 * Classify each (instance, field) coord of a consensus run into one of four
 * reconciliation buckets, in strict precedence order so a coord lands in
 * exactly one: conflict > required-gap > single-filler > agreement.
 * Pure — no fetching. Inputs derive from useReviewerSummary + the run's
 * template (required coords) + published_states.
 */
export interface ClassifyParams {
  /** coordKeys with >=2 materially different reviewer values. */
  divergentCoords: ReadonlySet<string>;
  /** coordKey -> number of distinct reviewer decisions on that coord. */
  decisionCountByCoord: ReadonlyMap<string, number>;
  /** Distinct reviewers who submitted any decision on the run. */
  participantCount: number;
  /** Every required template coordKey (instance x field where is_required). */
  requiredCoords: readonly string[];
  /** coordKeys already carrying a published state. */
  publishedCoords: ReadonlySet<string>;
}

export interface ReconciliationBuckets {
  conflicts: string[];
  requiredGaps: string[];
  singleFiller: string[];
  agreements: string[];
}

export function classifyReconciliation(p: ClassifyParams): ReconciliationBuckets {
  const conflicts: string[] = [];
  const requiredGaps: string[] = [];
  const singleFiller: string[] = [];
  const agreements: string[] = [];

  // 1. Conflicts take precedence (resolved or not — the panel renders resolved
  //    ones with the resolved-state UI).
  for (const coord of p.divergentCoords) conflicts.push(coord);

  // 2. Required gap: a required coord with no reviewer decision and no published
  //    value. A required coord that IS touched falls through to step 3/4.
  for (const coord of p.requiredCoords) {
    if (p.divergentCoords.has(coord)) continue;
    if (!p.decisionCountByCoord.has(coord) && !p.publishedCoords.has(coord)) {
      requiredGaps.push(coord);
    }
  }

  // 3 + 4. Touched, non-conflict coords: single-filler vs agreement.
  for (const [coord, count] of p.decisionCountByCoord) {
    if (p.divergentCoords.has(coord)) continue;
    if (p.participantCount >= 2 && count < p.participantCount) {
      singleFiller.push(coord);
    } else {
      agreements.push(coord);
    }
  }

  return { conflicts, requiredGaps, singleFiller, agreements };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- reconciliation.test`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/runs/reconciliation.ts frontend/test/reconciliation.test.ts
git commit -m "feat(consensus): pure reconciliation-state classifier"
```

---

## Task 2: Role-derived expected reviewer count + header "N of M"

**Files:**
- Create: `frontend/lib/runs/reviewerExpectation.ts`
- Test: `frontend/test/reviewerExpectation.test.ts`
- Modify: `frontend/components/runs/header/Reviewers.tsx`
- Modify: `frontend/components/runs/header/__tests__/Reviewers.test.tsx`
- Modify: `frontend/lib/copy/runs.ts`

**Interfaces:**
- Consumes: `ProjectMemberSummary` from `@/hooks/hitl/useProjectMembers` (`{ user_id, role, ... }`, role ∈ `'manager'|'reviewer'|'viewer'|'consensus'`).
- Produces: `countExpectedReviewers(members: readonly ProjectMemberSummary[]): number`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/test/reviewerExpectation.test.ts
import { describe, expect, it } from "vitest";
import { countExpectedReviewers } from "@/lib/runs/reviewerExpectation";
import type { ProjectMemberSummary } from "@/hooks/hitl/useProjectMembers";

const m = (role: ProjectMemberSummary["role"]): ProjectMemberSummary => ({
  user_id: `u-${role}-${Math.round(role.length)}`,
  role,
  user_email: null,
  user_full_name: null,
  user_avatar_url: null,
});

describe("countExpectedReviewers", () => {
  it("counts reviewer and manager roles", () => {
    expect(countExpectedReviewers([m("reviewer"), m("manager"), m("reviewer")])).toBe(3);
  });
  it("excludes viewer and pure consensus roles", () => {
    expect(countExpectedReviewers([m("reviewer"), m("viewer"), m("consensus")])).toBe(1);
  });
  it("returns 0 for an empty roster", () => {
    expect(countExpectedReviewers([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- reviewerExpectation.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/lib/runs/reviewerExpectation.ts
import type { ProjectMemberSummary } from "@/hooks/hitl/useProjectMembers";

/**
 * Roles whose members are expected to extract — the denominator for the
 * "N of M reviewers" header. Viewers never extract; a pure consensus role only
 * arbitrates. Managers commonly extract, so they count.
 */
const EXPECTED_ROLES: ReadonlySet<string> = new Set(["reviewer", "manager"]);

export function countExpectedReviewers(
  members: readonly ProjectMemberSummary[],
): number {
  return members.filter((mbr) => EXPECTED_ROLES.has(mbr.role)).length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- reviewerExpectation.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the copy key for the visible "N of M" label**

In `frontend/lib/copy/runs.ts`, add to the `runs` object (near `reviewersReadyHint`):

```ts
    reviewersOfExpected: '{{count}} of {{required}} reviewers',
```

- [ ] **Step 6: Show "N of M" visibly in the header (failing test first)**

Add to `frontend/components/runs/header/__tests__/Reviewers.test.tsx` (follow the existing `renderReviewers`/context-provider helper in that file — it wraps `<Reviewers/>` in the header context; pass `reviewers={{ count: 1, required: 3, divergent: 0 }}` and `stage='consensus'`):

```ts
it("shows 'N of M reviewers' when required is known", () => {
  renderReviewers({
    stage: "consensus",
    reviewers: { count: 1, required: 3, divergent: 0 },
  });
  expect(screen.getByTestId("run-reviewers-count")).toHaveTextContent("1 of 3 reviewers");
});
```

Run: `npm run test:run -- Reviewers.test` → FAIL (no `run-reviewers-count` node).

- [ ] **Step 7: Render the visible label**

In `frontend/components/runs/header/Reviewers.tsx`, after the avatar stack `</div>` (the block ending at line 27) and before the `readyLabel` block, insert:

```tsx
      <span
        className="text-[11px] text-muted-foreground"
        data-testid="run-reviewers-count"
      >
        {t('runs', 'reviewersOfExpected')
          .replace('{{count}}', String(reviewers.count))
          .replace('{{required}}', String(reviewers.required))}
      </span>
```

- [ ] **Step 8: Run header tests**

Run: `npm run test:run -- Reviewers.test`
Expected: PASS (existing + new).

- [ ] **Step 9: Commit**

```bash
git add frontend/lib/runs/reviewerExpectation.ts frontend/test/reviewerExpectation.test.ts frontend/components/runs/header/Reviewers.tsx frontend/components/runs/header/__tests__/Reviewers.test.tsx frontend/lib/copy/runs.ts
git commit -m "feat(consensus): role-derived expected reviewer count + 'N of M' header"
```

---

## Task 3: Soft-warn finalize decision (pure logic)

**Files:**
- Create: `frontend/lib/runs/finalizeWarning.ts`
- Test: `frontend/test/finalizeWarning.test.ts`

**Interfaces:**
- Produces: `computeFinalizeWarning(p: { participantCount: number; expectedReviewerCount: number; singleFillerCount: number }): { shouldWarn: boolean; reasons: Array<'missing_reviewers' | 'single_filler'> }`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/test/finalizeWarning.test.ts
import { describe, expect, it } from "vitest";
import { computeFinalizeWarning } from "@/lib/runs/finalizeWarning";

describe("computeFinalizeWarning", () => {
  it("warns when fewer participants than expected", () => {
    const r = computeFinalizeWarning({ participantCount: 1, expectedReviewerCount: 2, singleFillerCount: 0 });
    expect(r.shouldWarn).toBe(true);
    expect(r.reasons).toEqual(["missing_reviewers"]);
  });
  it("warns when there are single-filler coords", () => {
    const r = computeFinalizeWarning({ participantCount: 2, expectedReviewerCount: 2, singleFillerCount: 3 });
    expect(r.shouldWarn).toBe(true);
    expect(r.reasons).toEqual(["single_filler"]);
  });
  it("warns for both, in stable order", () => {
    const r = computeFinalizeWarning({ participantCount: 1, expectedReviewerCount: 3, singleFillerCount: 2 });
    expect(r.reasons).toEqual(["missing_reviewers", "single_filler"]);
  });
  it("does not warn when complete and fully participated", () => {
    const r = computeFinalizeWarning({ participantCount: 2, expectedReviewerCount: 2, singleFillerCount: 0 });
    expect(r.shouldWarn).toBe(false);
    expect(r.reasons).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- finalizeWarning.test`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/lib/runs/finalizeWarning.ts
/**
 * Soft-gate decision for "Approve & finalize" in the consensus stage. Never
 * blocks (the backend still hard-blocks unresolved conflicts + required gaps);
 * this only decides whether to show a confirm dialog and why.
 */
export type FinalizeWarningReason = "missing_reviewers" | "single_filler";

export interface FinalizeWarning {
  shouldWarn: boolean;
  reasons: FinalizeWarningReason[];
}

export function computeFinalizeWarning(p: {
  participantCount: number;
  expectedReviewerCount: number;
  singleFillerCount: number;
}): FinalizeWarning {
  const reasons: FinalizeWarningReason[] = [];
  if (p.participantCount < p.expectedReviewerCount) reasons.push("missing_reviewers");
  if (p.singleFillerCount > 0) reasons.push("single_filler");
  return { shouldWarn: reasons.length > 0, reasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- finalizeWarning.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/runs/finalizeWarning.ts frontend/test/finalizeWarning.test.ts
git commit -m "feat(consensus): pure soft-warn-before-finalize decision"
```

---

## Task 4: ConsensusPanel — reconciliation sections, drop evaluate-all, drop decision badge

**Files:**
- Modify: `frontend/components/runs/ConsensusPanel.tsx`
- Modify: `frontend/lib/copy/consensus.ts`
- Modify: `frontend/test/ConsensusPanel.test.tsx`

**Interfaces:**
- Consumes: `classifyReconciliation` (Task 1); existing `ReviewerSummary`, `RunDetailResponse`.
- Changes props: **remove** `evaluateAllCoords`; **add** `requiredCoords: string[]` and `peersRevealed: boolean` (used in Task 5). Keep all existing callbacks.
- Produces: a `ConsensusPanel` that renders three sections (Conflicts, Needs attention, Agreements) and no longer renders `<Badge>{d.decision}</Badge>`.

- [ ] **Step 1: Add copy keys**

In `frontend/lib/copy/consensus.ts`, inside the `consensus` object (after `panelEvaluateAllTitle`), add:

```ts
    sectionConflictsTitle: 'Conflicts',
    sectionConflictsDesc: 'Reviewers gave different values. Resolve each.',
    sectionAttentionTitle: 'Needs attention',
    sectionAttentionDesc: 'Single-reviewer answers and unfilled required fields.',
    sectionAgreedTitle: 'Agreed',
    sectionAgreedHint: '{{count}} fields agreed — published automatically on finalize.',
    badgeRequiredGap: 'Required · not filled',
    badgeSingleFiller: 'Only one reviewer',
    nothingToReconcile: 'Nothing to reconcile. Use “Approve & finalize” in the header.',
```

- [ ] **Step 2: Write the failing tests**

Add to `frontend/test/ConsensusPanel.test.tsx`. The existing `makeFixtures()` builds a 2-reviewer divergent coord (`inst-1::field-1`, values "Yes"/"No"); reuse it. Render with the new props:

```ts
it("groups a divergence under the Conflicts section", () => {
  const { runDetail, summary } = makeFixtures();
  render(
    <ConsensusPanel
      runDetail={runDetail}
      summary={summary}
      requiredCoords={[]}
      peersRevealed={true}
      fieldLabelByCoord={{ "inst-1::field-1": "Section · Field 1" }}
      onSelectExisting={vi.fn()}
      onManualOverride={vi.fn()}
      onFinalize={vi.fn()}
      showFinalize={false}
    />,
  );
  expect(screen.getByTestId("consensus-section-conflicts")).toBeInTheDocument();
  expect(screen.getByText("Section · Field 1")).toBeInTheDocument();
});

it("does not render the internal decision verb as a badge", () => {
  const { runDetail, summary } = makeFixtures();
  render(
    <ConsensusPanel
      runDetail={runDetail}
      summary={summary}
      requiredCoords={[]}
      peersRevealed={true}
      onSelectExisting={vi.fn()}
      onManualOverride={vi.fn()}
      onFinalize={vi.fn()}
      showFinalize={false}
    />,
  );
  // "edit" was the decision-verb badge; reviewer values "Yes"/"No" remain.
  expect(screen.queryByText("edit")).not.toBeInTheDocument();
});

it("shows an agreed-count hint and a required-gap row", () => {
  // One agreed coord (both reviewers "Yes") + one untouched required coord.
  const decisions: ReviewerDecisionResponse[] = [
    decision({ id: "d1", reviewer_id: "user-a", instance_id: "i", field_id: "ag", value: { value: "Yes" } }),
    decision({ id: "d2", reviewer_id: "user-b", instance_id: "i", field_id: "ag", value: { value: "Yes" } }),
  ];
  const summary: ReviewerSummary = {
    reviewers: ["user-a", "user-b"],
    currentDecisions: new Map(),
    decisionsByCoord: new Map([["i::ag", decisions]]),
    divergentCoords: new Set(),
    requiredReviewerCount: 2,
    completionRatio: 1,
    filledCoords: new Set(["i::ag"]),
    touchedCoords: new Set(["i::ag"]),
  };
  const runDetail = { ...makeFixtures().runDetail, decisions, consensus_decisions: [], published_states: [] };
  render(
    <ConsensusPanel
      runDetail={runDetail}
      summary={summary}
      requiredCoords={["i::gap"]}
      peersRevealed={true}
      fieldLabelByCoord={{ "i::ag": "S · Agreed", "i::gap": "S · Required" }}
      onSelectExisting={vi.fn()}
      onManualOverride={vi.fn()}
      onFinalize={vi.fn()}
      showFinalize={false}
    />,
  );
  expect(screen.getByTestId("consensus-section-agreed")).toHaveTextContent("1 fields agreed");
  expect(screen.getByTestId("consensus-section-attention")).toHaveTextContent("S · Required");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:run -- ConsensusPanel.test`
Expected: FAIL (new props/sections not present).

- [ ] **Step 4: Refactor `ConsensusPanel` to render reconciliation sections**

In `frontend/components/runs/ConsensusPanel.tsx`:

(a) Update `ConsensusPanelProps`: remove `evaluateAllCoords?: string[];`; add `requiredCoords: string[];` and `peersRevealed: boolean;`.

(b) Replace the body computation (the `divergentList` / `evaluateAll` / `coordList` block, currently `ConsensusPanel.tsx:349-352`) with classification:

```tsx
  const publishedCoords = new Set(
    runDetail.published_states.map((p) => `${p.instance_id}::${p.field_id}`),
  );
  const decisionCountByCoord = new Map(
    [...summary.decisionsByCoord].map(([k, v]) => [k, v.length]),
  );
  const buckets = classifyReconciliation({
    divergentCoords: summary.divergentCoords,
    decisionCountByCoord,
    participantCount: summary.reviewers.length,
    requiredCoords,
    publishedCoords,
  });
  const nothing =
    buckets.conflicts.length === 0 &&
    buckets.requiredGaps.length === 0 &&
    buckets.singleFiller.length === 0;
```

(c) Replace the **entire** main `return (...)` (currently `ConsensusPanel.tsx:406-484`, including the old title/progress/finalize header AND the `coordList.map(...)` list) with: an optional finalize bar for QA, then three sections. Conflicts and single-filler reuse `CoordRow`; required gaps reuse `CoordRow` with `decisions={[]}` (override-only — Task 4 Step 4g). The agreed block is a count + expandable list.

**QA-finalize preservation (critical):** QA passes `showFinalize=true` and relies on the now-removed no-divergence fast-path for its finalize button. Preserve it with an in-panel finalize bar gated on `showFinalize`, enabled when no conflict is unresolved and no required gap remains. Extraction passes `showFinalize=false`, so it shows the "use the header" hint instead.

```tsx
  const conflictsResolved = buckets.conflicts.every((c) => resolvedByCoord.has(c));
  const canFinalize = conflictsResolved && buckets.requiredGaps.length === 0 && isComplete;

  return (
    <div className="space-y-4 p-4" data-testid="consensus-panel">
      {showFinalize ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t("consensus", "panelResolveTitle")}</h2>
          <Button
            size="sm"
            onClick={() => void onFinalize()}
            disabled={!canFinalize || isFinalizing}
            data-testid="consensus-finalize-button"
          >
            {isFinalizing ? t("consensus", "panelFinalizing") : t("consensus", "panelFinalize")}
          </Button>
        </div>
      ) : null}

      {nothing && !showFinalize ? (
        <p className="text-sm text-muted-foreground" data-testid="consensus-nothing">
          {t("consensus", "nothingToReconcile")}
        </p>
      ) : null}

      {buckets.conflicts.length > 0 ? (
        <section className="space-y-3" data-testid="consensus-section-conflicts">
          <SectionHeading
            title={t("consensus", "sectionConflictsTitle")}
            desc={t("consensus", "sectionConflictsDesc")}
            count={buckets.conflicts.length}
          />
          {buckets.conflicts.map((coordKey) =>
            renderRow(coordKey, "conflict"),
          )}
        </section>
      ) : null}

      {buckets.requiredGaps.length + buckets.singleFiller.length > 0 ? (
        <section className="space-y-3" data-testid="consensus-section-attention">
          <SectionHeading
            title={t("consensus", "sectionAttentionTitle")}
            desc={t("consensus", "sectionAttentionDesc")}
            count={buckets.requiredGaps.length + buckets.singleFiller.length}
          />
          {buckets.requiredGaps.map((coordKey) => renderRow(coordKey, "required_gap"))}
          {buckets.singleFiller.map((coordKey) => renderRow(coordKey, "single_filler"))}
        </section>
      ) : null}

      {buckets.agreements.length > 0 ? (
        <AgreedSummary
          coords={buckets.agreements}
          fieldLabelByCoord={fieldLabelByCoord}
        />
      ) : null}
    </div>
  );
```

(d) Add the `renderRow` helper inside `ConsensusPanel` (wraps the existing per-coord wiring already at `ConsensusPanel.tsx:449-480`, plus a `variant` for the attention badges and required-gap empty decisions):

```tsx
  const resolvedByCoord = (() => {
    const m = new Map<string, ConsensusDecisionResponse>();
    for (const c of runDetail.consensus_decisions) {
      const key = `${c.instance_id}::${c.field_id}`;
      const prev = m.get(key);
      if (!prev || prev.created_at < c.created_at) m.set(key, c); // newest wins
    }
    return m;
  })();

  const renderRow = (
    coordKey: string,
    variant: "conflict" | "single_filler" | "required_gap",
  ) => {
    const decisions = summary.decisionsByCoord.get(coordKey) ?? [];
    const [instanceId, fieldId] = coordKey.split("::");
    const fieldLabel = fieldLabelByCoord[coordKey] ?? coordKey;
    return (
      <CoordRow
        key={coordKey}
        coordKey={coordKey}
        fieldLabel={fieldLabel}
        variant={variant}
        decisions={decisions}
        reviewerLabelById={reviewerLabelById}
        avatarById={avatarById}
        resolved={resolvedByCoord.get(coordKey)}
        peersRevealed={peersRevealed}
        disabled={isResolving}
        onSelectExisting={async (decisionId) =>
          onSelectExisting({ instanceId, fieldId, decisionId })
        }
        onManualOverride={async (value, rationale) =>
          onManualOverride({ instanceId, fieldId, value, rationale })
        }
      />
    );
  };
```

(e) Add `SectionHeading` + `AgreedSummary` as small local components in the same file:

```tsx
function SectionHeading({ title, desc, count }: { title: string; desc: string; count: number }) {
  return (
    <div className="space-y-0.5">
      <h3 className="text-sm font-semibold">
        {title} <span className="text-muted-foreground">· {count}</span>
      </h3>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

function AgreedSummary({
  coords,
  fieldLabelByCoord,
}: {
  coords: string[];
  fieldLabelByCoord: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded border border-border/60 p-3" data-testid="consensus-section-agreed">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>
          {t("consensus", "sectionAgreedHint").replace("{{count}}", String(coords.length))}
        </span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {coords.map((c) => (
            <li key={c}>{fieldLabelByCoord[c] ?? c}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
```

(f) Remove the no-divergence fast-path block (`ConsensusPanel.tsx:364-404`): the `nothing` branch above + the header (Task 5 owns finalize) supersede it. Keep the `showFinalize` in-panel button only for QA (QA still passes `showFinalize` default true and `requiredCoords={[]}`); guard it as today.

(g) In `CoordRow`: **delete** the decision badge (`ConsensusPanel.tsx:214-216`, the `<Badge variant="secondary">{d.decision}</Badge>`). Add a `variant` prop and a `peersRevealed` prop to `CoordRowProps`; when `variant === 'required_gap'` and `decisions.length === 0`, render the override editor directly (open by default) instead of the "no decisions" empty grid, and show the `badgeRequiredGap` chip in the header; when `variant === 'single_filler'`, show the `badgeSingleFiller` chip.

- [ ] **Step 5: Update `ExtractionFullScreen` + `QualityAssessmentFullScreen` call sites to the new props (compile gate)**

In `frontend/pages/ExtractionFullScreen.tsx` ConsensusPanel usage (`:1179-1193`): remove `evaluateAllCoords={extractionAllCoords}`; add `requiredCoords={...}` (computed in Task 5) and `peersRevealed={runDetail.peers_revealed}`. In `frontend/pages/QualityAssessmentFullScreen.tsx` (`:703-716`): add `requiredCoords={[]}` and `peersRevealed={runDetail.peers_revealed}`. (Full ExtractionFullScreen rewrite lands in Task 5; here just satisfy the type.)

- [ ] **Step 6: Run tests**

Run: `npm run test:run -- ConsensusPanel.test`
Expected: PASS (existing override/resolve tests + new section tests). Fix any fixture prop gaps.

- [ ] **Step 7: Typecheck**

Run: `npm run lint` (or `npx tsc -p tsconfig.json --noEmit`)
Expected: no type errors (both call sites updated).

- [ ] **Step 8: Commit**

```bash
git add frontend/components/runs/ConsensusPanel.tsx frontend/lib/copy/consensus.ts frontend/test/ConsensusPanel.test.tsx frontend/pages/ExtractionFullScreen.tsx frontend/pages/QualityAssessmentFullScreen.tsx
git commit -m "feat(consensus): reconciliation sections, drop evaluate-all + decision badge"
```

---

## Task 5: Resolved-state visible + editable; provenance guarded by peers_revealed

**Files:**
- Modify: `frontend/components/runs/ConsensusPanel.tsx` (`CoordRow`)
- Modify: `frontend/lib/copy/consensus.ts`
- Modify: `frontend/test/ConsensusPanel.test.tsx`

**Interfaces:**
- Consumes: `resolved: ConsensusDecisionResponse | undefined`, `peersRevealed: boolean` (from Task 4).
- Produces: a resolved `CoordRow` that shows the published value + provenance + rationale + a "Change" button that reopens the editor.

- [ ] **Step 1: Add copy keys**

In `frontend/lib/copy/consensus.ts`:

```ts
    resolvedValueLabel: 'Published value',
    resolvedFromReviewer: 'from {{reviewer}}',
    resolvedCustom: 'custom value',
    resolvedRationaleLabel: 'Rationale',
    change: 'Change',
```

- [ ] **Step 2: Write the failing test**

```ts
it("shows the published custom value + rationale + a Change button when resolved", async () => {
  const { runDetail, summary } = makeFixtures(); // divergent inst-1::field-1
  const resolved = consensusDecision({
    instance_id: "inst-1",
    field_id: "field-1",
    mode: "manual_override",
    value: { value: "Reconciled" },
    rationale: "agreed offline",
  });
  render(
    <ConsensusPanel
      runDetail={{ ...runDetail, consensus_decisions: [resolved] }}
      summary={summary}
      requiredCoords={[]}
      peersRevealed={true}
      onSelectExisting={vi.fn()}
      onManualOverride={vi.fn()}
      onFinalize={vi.fn()}
      showFinalize={false}
    />,
  );
  expect(screen.getByText("Reconciled")).toBeInTheDocument();
  expect(screen.getByText("agreed offline")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:run -- ConsensusPanel.test`
Expected: FAIL — value/rationale/Change not rendered when resolved.

- [ ] **Step 4: Implement the resolved-state block in `CoordRow`**

In `CoordRow`, add `const [editing, setEditing] = useState(false);`. When `isResolved && !editing`, render a resolved summary instead of the action controls:

```tsx
      {isResolved && !editing ? (
        <div className="space-y-2 rounded border border-success/30 bg-success/5 p-3 text-sm" data-testid={`consensus-resolved-${coordKey}`}>
          <div className="text-xs font-medium text-muted-foreground">
            {t("consensus", "resolvedValueLabel")} ·{" "}
            {resolved!.mode === "manual_override"
              ? t("consensus", "resolvedCustom")
              : peersRevealed && resolvedReviewerName
                ? t("consensus", "resolvedFromReviewer").replace("{{reviewer}}", resolvedReviewerName)
                : t("consensus", "resolvedCustom")}
          </div>
          <pre className="whitespace-pre-wrap break-words text-xs">
            {JSON.stringify(unwrap(resolved!.value), null, 2)}
          </pre>
          {resolved!.rationale ? (
            <p className="text-xs text-muted-foreground">
              {t("consensus", "resolvedRationaleLabel")}: {resolved!.rationale}
            </p>
          ) : null}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)}>
            {t("consensus", "change")}
          </Button>
        </div>
      ) : (
        /* existing decision grid + override editor (the !isResolved branch),
           now gated on (!isResolved || editing). On submit/cancel call setEditing(false). */
      )}
```

`resolvedReviewerName` resolves the selected reviewer for `select_existing`:

```tsx
  const resolvedReviewerName =
    resolved?.mode === "select_existing"
      ? (() => {
          const d = decisions.find((x) => x.id === resolved.selected_decision_id);
          return d ? reviewerLabel(d.reviewer_id, reviewerLabelById) : null;
        })()
      : null;
```

Gate the existing decision-grid + override-editor JSX on `(!isResolved || editing)`, and in the override submit/cancel handlers add `setEditing(false)`.

- [ ] **Step 5: Run tests**

Run: `npm run test:run -- ConsensusPanel.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/runs/ConsensusPanel.tsx frontend/lib/copy/consensus.ts frontend/test/ConsensusPanel.test.tsx
git commit -m "feat(consensus): resolved value/rationale visible + editable (Change)"
```

---

## Task 6: ExtractionFullScreen — panel into the left scroll panel + required coords + soft-warn finalize

**Files:**
- Modify: `frontend/pages/ExtractionFullScreen.tsx`
- Modify: `frontend/lib/copy/consensus.ts` (warning copy)

**Interfaces:**
- Consumes: `classifyReconciliation` (Task 1), `countExpectedReviewers` (Task 2), `computeFinalizeWarning` (Task 3), `useProjectMembers`.

- [ ] **Step 1: Add warning copy**

In `frontend/lib/copy/consensus.ts`:

```ts
    finalizeWarnTitle: 'Finalize anyway?',
    finalizeWarnMissingReviewers: 'Only {{count}} of {{required}} expected reviewers submitted.',
    finalizeWarnSingleFiller: '{{count}} field(s) were filled by a single reviewer.',
```

- [ ] **Step 2: Compute required coords + expected count + buckets in the page**

Near the existing `fieldLabelByCoordMap` build (`ExtractionFullScreen.tsx:250-264`), also collect required coords:

```tsx
  const requiredCoords: string[] = [];
  for (const inst of instances) {
    const et = entityTypes.find((e) => e.id === inst.entity_type_id);
    for (const f of et?.fields ?? []) {
      if (f.is_required) requiredCoords.push(`${inst.id}::${f.id}`);
    }
  }
```

Add the members hook + expected count (with the floor so M is never below actual participants):

```tsx
  const members = useProjectMembers(projectId ?? '');
  const expectedReviewerCount = Math.max(
    reviewerSummary.reviewers.length,
    countExpectedReviewers(members.data ?? []),
  );
```

Compute single-filler count for the warning (reuse the classifier):

```tsx
  const reconciliation = classifyReconciliation({
    divergentCoords: reviewerSummary.divergentCoords,
    decisionCountByCoord: new Map(
      [...reviewerSummary.decisionsByCoord].map(([k, v]) => [k, v.length]),
    ),
    participantCount: reviewerSummary.reviewers.length,
    requiredCoords,
    publishedCoords: new Set(
      (runDetail?.published_states ?? []).map((p) => `${p.instance_id}::${p.field_id}`),
    ),
  });
```

- [ ] **Step 3: Soft-warn in `handleApproveFinalize`**

Replace the body of `handleApproveFinalize` (`ExtractionFullScreen.tsx:301-310`) so it checks the warning first (promise-chain style — no try/finally):

```tsx
  const handleApproveFinalize = async () => {
    if (!activeRunId) return;
    const warning = computeFinalizeWarning({
      participantCount: reviewerSummary.reviewers.length,
      expectedReviewerCount,
      singleFillerCount: reconciliation.singleFiller.length,
    });
    if (warning.shouldWarn) {
      const lines = warning.reasons.map((r) =>
        r === 'missing_reviewers'
          ? t('consensus', 'finalizeWarnMissingReviewers')
              .replace('{{count}}', String(reviewerSummary.reviewers.length))
              .replace('{{required}}', String(expectedReviewerCount))
          : t('consensus', 'finalizeWarnSingleFiller')
              .replace('{{count}}', String(reconciliation.singleFiller.length)),
      );
      const proceed = window.confirm(
        `${t('consensus', 'finalizeWarnTitle')}\n\n${lines.join('\n')}`,
      );
      if (!proceed) return;
    }
    const ok = await approveFinalize.mutateAsync().then(() => true).catch(() => false);
    if (!ok) return;
    await Promise.all([refetchRun(), refreshValues(), refreshFinalizedRun()]);
    toast.success(t('pages', 'extractionScreenFinalizeSuccess'));
  };
```

- [ ] **Step 4: Move ConsensusPanel into the left resizable panel; remove the strip**

Remove the consensus strip block (`ExtractionFullScreen.tsx:1177-1195`). Inside the left `ResizablePanel` (`:1207-1254`), render the panel when in consensus, else the form:

```tsx
          <ResizablePanel id="extraction-form" order={1} defaultSize={showPDF ? 50 : 100} minSize={30}>
            {inConsensusStage && runDetail ? (
              <div className="h-full min-h-0 overflow-y-auto" data-testid="extraction-consensus-area">
                <ConsensusPanel
                  runDetail={runDetail}
                  summary={reviewerSummary}
                  requiredCoords={requiredCoords}
                  peersRevealed={!!runDetail.peers_revealed}
                  fieldLabelByCoord={fieldLabelByCoord}
                  reviewerLabelById={reviewerProfiles.labelById}
                  avatarById={reviewerProfiles.avatarById}
                  onSelectExisting={handleSelectExisting}
                  onManualOverride={handleManualOverride}
                  onFinalize={handleApproveFinalize}
                  isComplete={isComplete}
                  isResolving={consensusMutation.isPending}
                  isFinalizing={advanceMutation.isPending || approveFinalize.isPending}
                  showFinalize={false}
                />
              </div>
            ) : (
              <ExtractionFormPanel viewMode={viewMode} showPDF={showPDF} formViewProps={{ /* unchanged */ }} compareViewProps={{ /* unchanged */ }} />
            )}
          </ResizablePanel>
```

Update the header `reviewers` prop (`:1107-1117`) so `required` is the role-derived expected:

```tsx
        reviewers={{
          count: reviewerSummary.reviewers.length,
          required: expectedReviewerCount,
          divergent: reviewerSummary.divergentCoords.size,
          ...(stage === 'extract' && runDetail
            ? { ready: runDetail.ready_count ?? 0, readyTotal: expectedReviewerCount }
            : {}),
        }}
```

- [ ] **Step 5: Verify the view renders + scrolls (manual, no unit test for layout)**

Run: `npm run test:run -- ExtractionFullScreen` (if a page test exists; otherwise skip).
Then manual: start local dev (`make start`), open a run in consensus stage, confirm the panel scrolls and the PDF toggle opens the panel beside it. (Full visual pass is Task 8 / design-review.)

- [ ] **Step 6: Typecheck + commit**

```bash
npm run lint
git add frontend/pages/ExtractionFullScreen.tsx frontend/lib/copy/consensus.ts
git commit -m "feat(consensus): panel in scrollable left panel + role count + soft-warn finalize"
```

---

## Task 7: Remove the "Reviewers per article" config field

**Files:**
- Modify: `frontend/components/project/settings/ConsensusConfigForm.tsx`
- Modify: `frontend/lib/copy/consensus.ts` (drop now-unused keys if no other consumer)

**Interfaces:**
- `ConsensusConfigForm` keeps `value`/`onChange` (still carries `reviewer_count` in the payload, defaulted) but no longer renders the input. `consensus_rule` + arbitrator picker unchanged.

- [ ] **Step 1: Write/adjust the test**

In the form's test (or add `frontend/test/ConsensusConfigForm.test.tsx` if none): assert the reviewer-count input is gone but the rule select remains.

```ts
it("no longer renders a reviewers-per-article input", () => {
  render(<ConsensusConfigForm value={{ reviewer_count: 1, consensus_rule: "unanimous", arbitrator_id: null }} onChange={vi.fn()} members={[]} />);
  expect(screen.queryByLabelText(/reviewers per article/i)).not.toBeInTheDocument();
  expect(screen.getByText(/consensus rule/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- ConsensusConfigForm`
Expected: FAIL (input still present).

- [ ] **Step 3: Remove the input**

In `frontend/components/project/settings/ConsensusConfigForm.tsx`, delete the `SettingsField` wrapping `reviewer-count` (the `<Input id="reviewer-count" type="number" .../>` block) and the now-unused `handleReviewerCountChange` + `minReviewers`/`maxReviewers` props if unreferenced. Leave `value.reviewer_count` flowing through unchanged (default stays).

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- ConsensusConfigForm` then `npm run lint`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/project/settings/ConsensusConfigForm.tsx frontend/lib/copy/consensus.ts frontend/test/ConsensusConfigForm.test.tsx
git commit -m "feat(consensus): drop the hand-typed 'reviewers per article' field"
```

---

## Task 8: Full-suite gate + design-review

**Files:** none (verification only).

- [ ] **Step 1: Full frontend suite**

Run: `npm run test:run`
Expected: PASS (no regressions in QA consensus, header, autosave).

- [ ] **Step 2: Lint + typecheck + compiler**

Run: `npm run lint`
Expected: clean (React Compiler must compile every changed component/hook — no `try/finally` introduced).

- [ ] **Step 3: design-review on the consensus screen**

Run the `/design-review` loop on the extraction consensus route at widths 1280 / 900 / 700 / 560: confirm scroll, PDF toggle beside the panel, the three sections, the resolved/agreed states, and "N of M" in the header. Fix visual diffs, re-screenshot.

- [ ] **Step 4: Manual multi-reviewer pass**

With the test account, open a 2-reviewer run with a planted conflict, a single-filler coord, and an untouched required coord. Confirm: conflict resolvable + editable via Change; single-filler + required-gap appear under Needs attention (required-gap offers the override editor); agreed collapsed with count; finalize shows the soft-warn when 1 of 2 submitted; finalize succeeds after confirm.

- [ ] **Step 5: Update the spec status**

Mark Phase A done in `docs/superpowers/specs/2026-06-23-consensus-view-fixes-design.md` (a one-line note under Phasing). Commit.

```bash
git add docs/superpowers/specs/2026-06-23-consensus-view-fixes-design.md
git commit -m "docs(consensus): mark Phase A implemented"
```

---

## Self-Review notes (author)

- **Spec coverage:** D1′ → Tasks 1,4; D2′ → Tasks 2,6; D3′ → Tasks 3,6; D4 → Task 4(g); D5a → Task 5; layout (Design A) → Task 6; config field (Design C) → Task 7. Phase B (F, G) intentionally excluded (separate plan).
- **Out of this plan:** the unit-conflict fix (G) and optional rationale (F) — they touch the backend/migration and ship in Phase B. Until then, unit conflicts remain classified as agreement (pre-existing behavior, not a regression).
- **Type consistency:** `classifyReconciliation` signature is identical in Tasks 1, 4, 6. `ConsensusPanel` prop changes (remove `evaluateAllCoords`; add `requiredCoords`, `peersRevealed`) are applied at both call sites in Task 4 Step 5.
- **Risk:** Task 4 is the largest; if a reviewer rejects it, Tasks 5–6 depend on its prop shape. Keep Task 4’s prop contract (the Interfaces block) stable.

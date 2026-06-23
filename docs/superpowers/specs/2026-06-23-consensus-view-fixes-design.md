---
status: draft
last_reviewed: 2026-06-23
owner: '@raphaelfh'
---

# Consensus view fixes (extraction) — design

> **Status:** Draft · Date: 2026-06-23 · Deciders: @raphaelfh
> **Relation to existing design:** This spec does **not** introduce a new
> consensus model. It records the reconciliation of five user-reported issues
> against behavior that already exists, and aligns the **extraction** consensus
> surface with the **quality-assessment** one (the QA surface already does the
> right thing on most of these points). It composes with — and stays out of the
> way of — the in-flight HITL lifecycle rework (PRs #369/#374).

## Context — what was reported

All five points were reported against the live extraction **Consensus** stage
(`stage='consensus'`), shown in `ExtractionFullScreen`:

1. **View is stuck** — cannot scroll down, cannot open the PDF/markdown side
   panel.
2. There should be a way to **accept all matching/agreeing fields**; identical
   reviewer values are mislabeled as "N reviewers disagreed".
3. The **reviewer count doesn't match** — it is a hand-typed config number; it
   should reflect the actual research team.
4. There is an **"edit" affordance on each reviewer card** that makes no sense
   (the manager / consensus role does not edit another reviewer's value in that
   reviewer's own field).
5. **Override is unclear after the fact**: once a field is resolved (especially
   via custom value), the written value and rationale disappear and cannot be
   revised before finalize. Also, the rationale should be **optional**, not
   required.

## Root causes (verified in code)

| # | Root cause | Evidence |
|---|-----------|----------|
| 1 | In consensus stage the `ConsensusPanel` is mounted in a static, non-scrolling strip (`border-b … px-4 py-3`) **above** the main area, with no height bound or overflow. With many fields it overflows the viewport and squeezes the PDF panel to ~0. | `frontend/pages/ExtractionFullScreen.tsx:1177` vs QA's scrollable `min-h-0 flex-1` host at `frontend/pages/QualityAssessmentFullScreen.tsx:658` |
| 2 | Extraction uses an `evaluate-all` mode that renders **every** touched coord (agreed + divergent) identically, and the row header copy is hardcoded to "{{count}} reviewers disagreed" using `decisions.length` regardless of agreement. | `frontend/components/runs/ConsensusPanel.tsx:170`, `:349-352` |
| 3 | `requiredReviewerCount` is read from `run.hitl_config_snapshot.reviewer_count` (a hand-typed, frozen number; default 1). The backend does **not** use it as a quorum gate. | `frontend/hooks/runs/useReviewerSummary.ts:154`; `frontend/components/project/settings/ConsensusConfigForm.tsx` |
| 4 | The per-reviewer pill is `<Badge>{d.decision}</Badge>` rendering the internal decision verb ("edit"). It is a status badge, read as an edit button. | `frontend/components/runs/ConsensusPanel.tsx:214` |
| 5 | When `isResolved`, the row hides the editor and the action buttons and **never renders** the published value or rationale — only a "Resolved · {mode}" badge. Re-resolution is supported by the backend but unreachable in the UI. | `frontend/components/runs/ConsensusPanel.tsx:183-192`, `:223`, `:240` |

## Invariants confirmed before deciding

These make the decisions below safe:

- **Hiding agreed coords loses nothing.** `approve_and_finalize` atomically
  publishes every agreed-but-unpublished coord, then advances to `finalized`;
  coords with ≥2 distinct reviewer values block finalize until resolved
  (`backend/app/services/run_lifecycle_service.py:256`, `_agreed_unpublished_values`
  at `:306`). The single value of a solo reviewer counts as "agreed".
- **Re-resolution already works end-to-end.** `record_consensus` is append-only
  with no "already resolved" guard, and `_publish_internal` does
  INSERT-or-(optimistic-lock)-UPDATE, so writing a new decision for an
  already-resolved coord re-publishes the canonical value
  (`backend/app/services/extraction_consensus_service.py:48-144`).
- **Rationale is enforced in two places** for `manual_override`: the DB CHECK
  `manual_override_complete` (`backend/app/models/extraction_workflow.py:362`)
  **and** the service guard (`extraction_consensus_service.py:79-80`). Making it
  optional requires touching both.
- **Divergence needs ≥2 reviewers** (`useReviewerSummary.ts:148`), so a solo
  reviewer is structurally non-divergent.

## Decisions (approved 2026-06-23)

- **D1 — Consensus view shows only divergent coords + a compact agreed-summary.**
  Agreed/solo coords are not rendered as action rows; they appear as a count
  ("N fields agreed — published on finalize"), expandable for a final read-only
  check.
- **D2 — Reviewer count = actual participants** (no fixed denominator). Remove
  the manual "Reviewers per article" config field. Leave `consensus_rule`,
  arbitrator, and the `reviewer_count` DB column untouched (owned by the
  lifecycle rework).
- **D3 — No-divergence state relies on the header for finalize** (single source);
  the panel shows "Nothing to resolve" + the agreed-summary, no second finalize
  button.
- **D4 — Phasing:** Phase A is frontend-only (no migration); Phase B is the
  optional-rationale migration.
- **D5 — AI stays an extraction assistant**, not a virtual reviewer (out of
  scope).

## Design

### 1 — Layout: ConsensusPanel becomes the scrollable left panel · `frontend`

During `stage='consensus'`, render `ConsensusPanel` as the **content of the left
resizable panel** (scrollable host `min-h-0 flex-1`), with the PDF/markdown panel
beside it (toggle unchanged) — mirroring `QualityAssessmentFullScreen`. The form
panel is not shown during consensus (editing is already disabled there), and the
old `inConsensusStage` strip above the main area is removed.

- Remove the strip at `ExtractionFullScreen.tsx:1177-1195`.
- In the left `ResizablePanel`, branch: `inConsensusStage ? <ConsensusPanel …/> :
  <ExtractionFormPanel …/>`, inside a scroll container matching QA.

### 2 — Only-divergent rendering + agreed-summary · `frontend`

Collapse the `evaluate-all` branch; unify extraction with QA's divergent-only
path. Add a shared **agreed-summary** block (used by both extraction and QA):

- Lists only coords in `summary.divergentCoords` as action rows.
- Shows a summary line for coords that are touched, non-divergent, and not yet
  published: "N fields agreed — will be published on finalize", expandable to a
  read-only list using `fieldLabelByCoord`.
- The per-row header shows "disagreed" copy **only** for true divergences;
  resolved rows show a resolved state (see 5a).
- Remove the `evaluateAllCoords` prop and its branching from `ConsensusPanel`.

### 3 — Reviewer count = participants · `frontend`

- Header/summary text shows the count of **distinct reviewers who submitted**
  (`summary.reviewers.length`) with no "/ required" denominator.
- Stop driving UI text from `requiredReviewerCount` / `completionRatio`.
- Remove the "Reviewers per article" input from `ConsensusConfigForm.tsx`
  (and its label/hint usage). Keep `consensus_rule`, arbitrator picker, and
  manager-visibility toggle. The `reviewer_count` column and snapshot stay
  (default 1); their removal belongs to the lifecycle rework.

### 4 — Remove the "edit" badge · `frontend`

Remove the `<Badge>{d.decision}</Badge>` entirely. It is redundant: a `reject`
row is already conveyed by its destructive border/background and the "(rejected)"
value text (`panelRejected`), and "edit"/"approve" carry no meaning to the user
in consensus. No replacement chip.

### 5a — Resolution stays visible and editable · `frontend`

After a coord is resolved, the row shows:

- The **published value** (`resolved.value`, unwrapped the same way values are
  rendered elsewhere).
- The **provenance**: "from {reviewer}" for `select_existing`, or "custom value"
  for `manual_override`.
- The **rationale** if present.
- A **"Change"** button that reopens the resolution controls pre-filled
  (override editor seeded with current value + rationale; select path re-enabled).

`resolvedByCoord` is built by picking the **newest decision per coord**
(`max(created_at)`), so re-resolution wins regardless of array order. No backend
change.

### 5b — Optional rationale · `backend (migration)` + `frontend`

- **Migration (Alembic):** relax CHECK `manual_override_complete` to require only
  `value IS NOT NULL` for `manual_override` (drop the `rationale IS NOT NULL`
  conjunct). Revision id ≤ 32 chars. Touches `extraction_*` → update the
  migration-head line + `last_reviewed` in
  `docs/reference/extraction-hitl-architecture.md`.
- **Service:** relax the guard at `extraction_consensus_service.py:79-80` to
  require only `value` for `manual_override`.
- **Frontend:** drop the empty-rationale disable on the override submit; change
  the copy from "Rationale (required)" to an optional label.

## Out of scope (recorded)

- AI as a virtual reviewer (compare human vs raw AI as a divergence).
- Removing `reviewer_count` / `consensus_rule` / arbitrator from the schema
  (owned by the HITL lifecycle rework, #369/#374).
- Per-article reviewer assignment.

## Phasing

- **Phase A — frontend only, no migration:** items 1, 2, 3, 4, 5a. Unblocks the
  view; low risk; one PR.
- **Phase B — migration + backend + frontend:** item 5b (optional rationale).

## Verification

- **TDD** for the testable logic: divergent-only selection + agreed-summary
  counting; participant count text; newest-decision-per-coord selection;
  resolved-state rendering (value/provenance/rationale + Change).
- **Component tests** updated in `frontend/test/ConsensusPanel.test.tsx`
  (evaluate-all removal, resolved rendering, agreed-summary).
- **Backend (Phase B):** integration test that a `manual_override` without
  rationale is accepted post-migration (real Postgres, CHECK is invisible to
  mocks).
- **`/design-review`** on the consensus screen at 1280 / 900 / 700 / 560 to
  confirm scroll, PDF toggle, and the resolved/summary states render correctly.
- Manual: Vitest run + local dev against the consensus stage.

## File-touch map

**Phase A (frontend):**
- `frontend/pages/ExtractionFullScreen.tsx` — move ConsensusPanel into the left
  panel; remove the strip; participant-count props.
- `frontend/components/runs/ConsensusPanel.tsx` — remove evaluate-all; agreed
  summary; remove decision badge; resolved-state rendering + Change; newest
  decision per coord.
- `frontend/components/project/settings/ConsensusConfigForm.tsx` — remove
  "Reviewers per article" input.
- `frontend/lib/copy/consensus.ts` — adaptive titles, agreed-summary copy,
  resolved-state copy.
- `frontend/test/ConsensusPanel.test.tsx` — update/extend.
- `frontend/pages/QualityAssessmentFullScreen.tsx` — **optional** (not required
  for the fix): QA is already divergent-only; it adopts the shared agreed-summary
  only if the block is extracted to a shared component. If that adds churn, scope
  it to extraction and leave QA as-is.

**Phase B (backend + frontend):**
- `backend/alembic/versions/*` — relax CHECK `manual_override_complete`.
- `backend/app/services/extraction_consensus_service.py` — relax rationale guard.
- `docs/reference/extraction-hitl-architecture.md` — migration-head + last_reviewed.
- `frontend/components/runs/ConsensusPanel.tsx` + `frontend/lib/copy/consensus.ts`
  — optional rationale.

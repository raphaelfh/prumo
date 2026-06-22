---
status: draft
last_reviewed: 2026-06-22
owner: '@raphaelfh'
---

# HITL lifecycle alignment — collapse `review`, fix finalize, define consensus

> **Status:** Draft — design approved in brainstorm 2026-06-21. Supersedes
> the lifecycle/finalize parts of ADR-0009 and ADR-0010 (new ADRs to be
> written during implementation). Pending: written-plan.

## 1. Context and problem

A user-reported "leftover badge" on the Consensus screen surfaced a cluster of
inconsistencies in the extraction HITL flow. Investigation (frontend + backend +
docs) found they all trace to two roots: an over-modeled run lifecycle and a
pre-HITL finalize path that was never removed.

Observed inconsistencies (evidence in code as of 2026-06-21):

- **I1 — the header "Finalize" doesn't finalize.** `handleFinalize`
  (`frontend/pages/ExtractionFullScreen.tsx:851`) calls `markInstancesCompleted`
  (`frontend/services/extractionInstanceService.ts:653`), a **direct Supabase
  write** of `extraction_instances.status='completed'`, then navigates away. It
  never calls `advance_stage`, so `run.stage` stays `consensus`. The column it
  writes is dead state: the backend only ever writes `pending` and never reads
  `completed`; its sole consumer is one progress-bar shortcut
  (`frontend/lib/extraction/progress.ts:184`).
- **I2 — a clean run cannot be finalized the correct way.** The lifecycle
  finalize requires ≥1 `ConsensusDecision` (`EmptyFinalizeError`,
  `backend/app/services/run_lifecycle_service.py:228`, unconditional). A
  no-divergence run (single reviewer, or full agreement) has nothing to resolve
  and no UI to publish agreed fields (consensus panel renders divergent coords
  only), so it can never satisfy the gate. The legacy header (I1) is the only
  "escape", which is why it *felt* correct.
- **I3 — a blind manager cannot evaluate in consensus.** The compare view
  (`RunReviewerComparison`) is server-blinded; a blind manager sees no peer
  columns, so cannot evaluate reviewers until they manually reveal. Nothing
  prompts this on entering consensus.
- **I4 — single-reviewer runs pass through a no-op consensus** they cannot exit
  (I2). `reviewer_count` defaults to 1.
- **I5 — `review` is a lifecycle stage for a user activity.** ADR-0010 made
  `review` the collaborative surface, bridged from `proposal` by a client-side
  auto-advance hook (`useAutoAdvanceToReview`) with a documented race + "advance
  failed" toast. Conceptually, "reviewing the AI output" is part of *extracting*,
  not a run lifecycle position.
- **I6 — two "Finalize" buttons** (header + consensus banner) with different
  handlers and gates.

## 2. Decisions

Locked in the 2026-06-21 brainstorm:

1. **Collapse `proposal` + `review` into a single `extract` stage.** Lifecycle
   becomes `pending → extract → consensus → finalized` (+ `cancelled`). Rename the
   enum value `proposal → extract`; drop `review`.
2. **The manager can extract too.** A manager produces their own values (counts
   as one of the N reviewers), blind by default, **and** adjudicates/finalizes.
3. **Consensus = evaluate-all + approve (publish everything).** The
   manager/consensus reviews *every* field in the compare view and approves;
   approval publishes all values, then finalizes.
4. **Extract → Consensus is opened manually by the manager/consensus.** "Mark
   ready" is a per-reviewer "I'm done" signal; the run does not auto-advance.
5. **Auto-reveal peers on entering consensus** (a blind manager is revealed for
   evaluation; the consensus role always sees).

## 3. Target model

### 3.1 Lifecycle

```text
pending → extract → consensus → finalized        (+ cancelled at any non-terminal stage)
```

| User-facing phase | DB stage | Who | What |
| --- | --- | --- | --- |
| **Extract** | `extract` | reviewers + manager (each blind) | AI + humans produce values; each person's values are their own reviewer decisions |
| **Consensus** | `consensus` | manager / consensus | evaluate every reviewer's answer in compare view; approve → publish |
| **Finalized** | `finalized` | — | canonical published state; read-only; reopenable |

### 3.2 Roles (unchanged set)

- **reviewer** — extracts; blind to peers.
- **manager** — extracts (one of the N reviewers, blind by default) **and**
  adjudicates/finalizes; auto-revealed on entering consensus.
- **consensus** — pure adjudicator; always sees peers.
- **viewer** — read-only.

## 4. Phase behaviour

### 4.1 Extract

- AI writes `ai` proposals; the user accepts AI suggestions or types values.
  Typed values autosave as `human` proposals; accepting a suggestion writes an
  `accept_proposal` decision. Proposals **and** decisions are both valid in
  `extract` (relax the stage checks in §6).
- AI extraction may run while the run is in `extract` (no mid-batch stage flip),
  so **`useAutoAdvanceToReview` is deleted** along with its race condition and
  "advance failed" toast.
- The "X/N reviewers" counter and the "0% until you accept" progress compute from
  **per-user reviewer state** (existing logic; no longer gated on a `review`
  stage).
- Human writes go **straight to per-user `ReviewerDecision`s** via `/decisions` —
  the form already does this in `REVIEW` (`extractionValueService.saveValue`); we
  relax `record_decision` to accept `extract`. So decisions exist live during
  `extract`, and the "X/N" counter + own-progress are correct **without** any
  stage flip. The old `proposal → review` auto-advance (`useAutoAdvanceToReview`)
  and boundary materialization (`run_lifecycle_service.py:261`) are therefore
  **deleted, not moved** — in the new model there are no un-materialized human
  proposals to convert (the transient `proposal` window they bridged is gone).
- **"Mark ready"** is a per-reviewer "I'm done" flag (introduced in **Phase 2**
  with manual "Open consensus"). It does not advance the run.

### 4.2 Consensus (manual open)

- A "N/M reviewers ready" hint helps the manager/consensus decide when to open.
- **"Open consensus"** advances `extract → consensus` (manager/consensus only).
- On entry, a blind manager is **auto-revealed** to peers (the consensus role is
  never blind). Bias control matters during extraction, not adjudication; the
  manager's own extraction is already committed.
- The surface is the compare view over **every field**: each reviewer's answer
  next to the adjudicator's own. Agreed fields are pre-selected to the agreed
  value; diverging fields are flagged for an explicit pick (`select_existing`) or
  override (`manual_override`).

### 4.3 Finalize (one action)

- **"Approve & finalize"** publishes the selected value for every field
  (`ConsensusDecision` → `PublishedState`) and advances `consensus → finalized`.
  Enabled only when every diverging field is resolved and all required fields are
  filled.
- Because approval publishes for **all** fields, `EmptyFinalizeError` and the
  ADR-0009 completeness gate (`IncompleteFinalizeError`) are satisfied naturally
  — they remain as backend safety invariants but are never a dead-end. I2/I4
  resolved.

## 5. What gets deleted (the *resquícios*)

- The `review` stage; `useAutoAdvanceToReview`
  (`frontend/hooks/extraction/useAutoAdvanceToReview.ts`); the proposal→review
  boundary materialization (`_materialize_human_decisions` + its call) — **deleted
  outright**, since humans write decisions directly in `extract`.
- The legacy header finalize: `handleFinalize`
  (`ExtractionFullScreen.tsx:851-976`), `markInstancesCompleted`
  (`extractionInstanceService.ts:639-663`), and the
  `extraction_instances.status==='completed'` progress shortcut
  (`progress.ts:184`) — progress derives from field-completeness instead.
- The two-Finalize-button split: the header primary action becomes phase-aware —
  "Mark ready" (extract) → "Open consensus" → "Approve & finalize" (consensus),
  one source of truth via `buildExtractionTransition`.
- The "N/M reviewers" sub-header badge (`ReviewerProgressBadge`) — **already
  removed** in the same branch (verified: typecheck/lint/133 tests green).

## 6. Data model & migration

- **Enum migration** (Alembic): `extraction_run_stage` — add `extract`, migrate
  existing `proposal`/`review` rows to `extract`, drop `review` (and the
  `proposal` label after data migration). Revision id ≤ 32 chars. Update the
  migration-head line + `last_reviewed` in
  `docs/reference/extraction-hitl-architecture.md` (backend rule).
- **Per-reviewer ready marker**: a `(run_id, reviewer_id)` ready flag — a boolean
  column on `extraction_reviewer_states` or a small dedicated table. (Decide in
  the plan; lean column for O(1) reads.)
- **Relax stage checks** to allow both AI proposals and reviewer decisions in
  `extract`:
  - `extraction_proposal_service.py:67` (allowed stages),
  - `section_extraction_service.py:171,356` ("AI extraction requires PROPOSAL"),
  - `extraction_review_service.py:54` ("requires REVIEW"),
  - the `_ALLOWED_TRANSITIONS` matrix (`run_lifecycle_service.py:80`).
- **`extraction_instances.status`**: stop writing it from the frontend; treat as
  legacy/unused (do not advance to `completed`). Progress is field-completeness.

## 7. Backend touch points

- `run_lifecycle_service.py` — transitions matrix; remove the review-boundary
  materialization; keep finalize gates (now always satisfiable); `pending →
  extract` create; reopen lands in `extract` (was `review`, line 625).
- `hitl_session_service.py` — park new runs in `extract` (was `proposal`);
  active-set stage list (`:396`).
- `section_extraction_service.py`, `extraction_proposal_service.py`,
  `extraction_review_service.py` — relax stage gating to `extract`.
- `extraction_run_read_service.py`, `extraction_export_service.py` — stage lists
  that enumerate `proposal`/`review` collapse to `extract`.
- Consensus "approve-all" path reuses `extraction_consensus_service`
  (`:137-143`, the per-coordinate publish that materializes `PublishedState`).

## 8. Frontend touch points

- `ExtractionFullScreen.tsx` — delete `handleFinalize` legacy path; the header
  transition's consensus action = open-consensus / approve-and-finalize via
  `buildExtractionTransition` (`frontend/lib/extraction/stageTransition.ts`).
- `ConsensusPanel.tsx` — becomes the evaluate-all surface (all fields, not only
  divergent), with "Approve & finalize"; shared with QA — keep QA's
  publish-then-advance semantics intact.
- Delete `useAutoAdvanceToReview`; reviewer counter/progress unconditioned on a
  `review` stage (`useReviewerSummary`, `progress.ts`).
- "Mark ready" wired to the per-reviewer ready flag + decision materialization.
- Auto-reveal on consensus entry via the existing manager-visibility mechanism
  (`useComparisonPermissions` / `managers_see_reviewers`); decide whether entry
  flips the per-kind toggle or a run-scoped reveal (plan).

## 9. Docs / ADRs

- New ADR **superseding ADR-0010** (collapse `review`) and **ADR-0009** (finalize
  via approve-publish; retire the no-divergence dead-end; keep the gates as
  invariants).
- Update `docs/reference/extraction-hitl-architecture.md`: §2.2 stage table,
  §"Stage advance (extraction)", the lifecycle diagrams, and the finalize-gates
  glossary; bump migration head.

## 10. Risks & open items

- **Migration of in-flight runs**: production runs in `proposal`/`review` must map
  to `extract` cleanly; finalized/consensus untouched. Backfill is
  information-preserving (same data, new label) — mirrors the 0017 role backfill.
- **QA shares `ConsensusPanel` and the lifecycle.** QA finalize is consensus-only
  (no completeness gate); the evaluate-all/approve surface must not regress QA's
  publish-then-advance flow. Scope QA carefully or keep its existing path.
- **Auto-reveal mechanism**: flipping `managers_see_reviewers[kind]` is a
  persistent project setting; a run-scoped reveal may be cleaner than mutating the
  project toggle on entry. Decide in the plan.
- **Per-reviewer ready vs. existing data**: introduce without breaking the
  current run-level advance during the transition.

## 11. Validation

- Backend: integration tests for `extract` stage gating (AI proposals + reviewer
  decisions both valid), the approve-all → publish → finalize path satisfying both
  gates, and the no-divergence single-reviewer finalize succeeding.
- Frontend: the header phase-aware action across `extract`/`consensus`; consensus
  evaluate-all surface; deletion of the legacy finalize path; counter/progress
  correct without a `review` stage.
- Regression: QA publish-then-finalize unchanged; reopen lands in `extract`.

## 12. Implementation sequencing (for the plan)

The change is large enough to stage into separate plans/PRs, in this order so
each ships green:

1. **Collapse the stage model** — enum migration (`proposal`/`review` → `extract`),
   relax `record_decision` + AI-proposal gating to `extract`, delete
   `useAutoAdvanceToReview` + the boundary materialization, park/reopen in
   `extract`, point autosave at `/decisions` in `extract`. New ADR superseding
   ADR-0010. (Self-contained; ships green; no finalize/ready-flag change.)
2. **Consensus + finalize rework** — per-reviewer "Mark ready" flag, manual
   "Open consensus", auto-reveal, evaluate-all `ConsensusPanel`, "Approve &
   finalize" (publish-all → advance), header phase-aware action. New ADR
   superseding the finalize parts of ADR-0009.
3. **Delete the legacy finalize path** ✅ **(done — Phase 3)** — `handleFinalize`,
   `markInstancesCompleted`, the `instance.status` progress shortcut; progress
   from field-completeness, plus dropping the `extraction_instances.status`
   column + `extraction_instance_status` enum (migration `0030_drop_instance_status`,
   ADR-0015 Consequences). (Pure cleanup once 2 lands.)

QA-shared surfaces (`ConsensusPanel`, lifecycle) are touched in stage 2 — guard
QA's publish-then-advance there.

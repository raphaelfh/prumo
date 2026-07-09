---
status: accepted
last_reviewed: 2026-07-09
owner: '@raphaelfh'
adr_number: '0018'
---

# Quality-assessment HITL mirrors extraction: staged consensus, arbitrator-only publish/finalize

> **Status:** Accepted · Date: 2026-07-09 · Deciders: @raphaelfh
> **Supersedes:** the QA carve-outs of 0015 · **Superseded by:** N/A

## Context and Problem Statement

The quality-assessment (QA) HITL flow was bugged: from the editable `extract`
stage, the single "Publish assessment" button drove the whole pipeline in one
click — it advanced `extract → consensus`, wrote a `manual_override`
`ExtractionConsensusDecision` per filled field, and immediately advanced
`consensus → finalized`. The `consensus` stage was therefore never a *visited*,
evaluable step: the user "reached consensus" and finalized in the same action,
with no opportunity to review peers or resolve divergence. Data extraction, by
contrast, treats `consensus` as a real stage (reviewers mark ready, an
arbitrator opens consensus, resolves divergence, then approves & finalizes).

ADR-0015 had deliberately carved QA out of the extraction finalize path:
`approve_and_finalize` rejected `kind=quality_assessment` (QA "published via its
own flow"), and the per-field `POST /runs/{id}/consensus` gate was
**reviewer-level** for QA (`ensure_project_reviewer`) on the rationale of
"single-reviewer self-publish". Those carve-outs are what enabled the one-shot
flow and the stage-skip.

## Decision

**Make the QA HITL flow mirror extraction — the same staged progression and the
same authority model — retiring the one-shot publish.**

1. **Staged UI (frontend).** `buildQaTransition` now matches
   `buildExtractionTransition`:
   - `extract` + reviewer → **Finish assessment** (advisory mark-ready via
     `POST /runs/{id}/ready`; does not advance the run).
   - `extract` + arbitrator → **Start consensus** (`extract → consensus`).
   - `consensus` + arbitrator → **Approve & finalize** (gated on every
     divergence being resolved), which publishes agreed values then advances
     `consensus → finalized`.
   - `consensus` + reviewer → no primary action.

   The consensus resolve panel is gated on `canResolveConflicts` (arbitrator),
   matching the extraction screen; `showFinalize` stays `false` (the run header
   owns the finalize action).

2. **`approve_and_finalize` covers both kinds (backend).** The
   `kind != EXTRACTION` guard in `RunLifecycleService.approve_and_finalize` is
   removed. QA now publishes each agreed reviewer decision (verbatim envelope,
   including ADR-0016 absent-reason markers) and advances to `finalized` in one
   atomic transaction, exactly like extraction. The required-field completeness
   gate (`IncompleteFinalizeError`) stays extraction-only (ADR-0009); the
   `EmptyFinalizeError` gate is kind-neutral and still fires for QA.

3. **Consensus + finalize are arbitrator-only for both kinds (backend).**
   - `POST /runs/{id}/consensus` now requires `ensure_project_arbitrator`
     unconditionally (previously kind-aware: arbitrator for extraction, reviewer
     for QA). Resolving/publishing canonical values is an adjudicator action.
   - `POST /runs/{id}/advance` additionally requires `ensure_project_arbitrator`
     when `target_stage == "finalized"`, on top of the reviewer gate. This
     closes the bypass whereby a reviewer could `advance→consensus`, self-publish
     via `/consensus`, then `advance→finalized` — flipping a run to `finalized`
     without an arbitrator. Earlier transitions (e.g. `extract→consensus`) stay
     reviewer-level, matching extraction.

The stage machine itself is unchanged: `_ALLOWED_TRANSITIONS` still allows
`consensus → finalized`; the new constraint is *who* may drive it, enforced at
the API layer (the service-role session bypasses RLS, so role gates live on the
endpoint — consistent with the existing `/approve-finalize` gate).

## Consequences

- **QA `consensus` is a real, evaluable stage.** The reported bug is fixed:
  reaching consensus no longer finalizes in the same action.
- **Authority is consistent end-to-end.** The UI already implied arbitrator-only
  finalize; the backend now enforces it, so there is no UI/API mismatch and no
  reviewer-level finalize bypass.
- **A single non-manager reviewer can no longer self-finalize a QA run** (the
  deliberate trade-off of "mirror extraction fully"). Projects carry ≥ 1 manager
  (min-one-manager guard), and the QA driver is typically a manager, so this
  matches real usage; it is the same constraint extraction has always had.
- **ADR-0015's QA carve-outs are superseded.** `approve_and_finalize` is no
  longer extraction-only, and QA `/consensus` is no longer reviewer-level.
- Frontend markers are no longer wrapped for publish on the client — reviewer
  decision envelopes are published verbatim by the backend, so the marker
  round-trip is exercised in the backend integration suite rather than the page.

## Verification

- Backend: `test_approve_and_finalize_qa_publishes_agreed_and_finalizes`
  (verbatim marker publish for the QA kind),
  `test_qa_consensus_publish_requires_arbitrator`,
  `test_qa_advance_to_finalized_requires_arbitrator`,
  `test_consensus_quality_assessment_requires_arbitrator`, and the direct
  endpoint-coroutine `test_advance_to_finalized_requires_arbitrator` /
  `test_advance_to_consensus_skips_arbitrator_gate` (ASGI-blind-spot coverage).
- Frontend: `qaTransition.test.ts` (per-role stage machine) and
  `QualityAssessmentFullScreen.test.tsx` (reviewer marks ready without
  advancing; manager starts consensus only; Approve & finalize gated on
  divergence; only an arbitrator sees resolve chrome).

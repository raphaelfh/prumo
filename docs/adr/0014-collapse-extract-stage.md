---
status: accepted
last_reviewed: 2026-06-21
owner: '@raphaelfh'
---

# Collapse the extraction `proposal` + `review` stages into a single `extract`

> **Status:** Accepted · Date: 2026-06-21 · Deciders: @raphaelfh
> **Supersedes:** 0010 · **Superseded by:** N/A

## Context and Problem Statement

ADR-0010 made `review` the multi-reviewer data-extraction surface, bridged from
`proposal` by a **client-side auto-advance** (`useAutoAdvanceToReview`) the
instant the run had content worth reviewing. The split existed only so the form
could write per-user `ReviewerDecision`s *immediately* after a transient
`proposal` window: a `proposal → review` boundary materialization
(`_materialize_human_decisions`) converted the human proposals typed in
`proposal` into `accept_proposal` decisions on entry to `review`.

That machinery carried real cost (cf. the 2026-06-21 HITL lifecycle-alignment
brainstorm):

- `useAutoAdvanceToReview` had a documented race and an "advance failed" toast.
- `review` is a **lifecycle stage modelling a user activity** ("reviewing the AI
  output"), which is conceptually part of *extracting*, not a run position.
- The boundary materialization is invisible state that only exists because
  human writes could not land as decisions during `proposal`.

## Decision

Collapse `proposal` and `review` into a single **`extract`** stage. The run
lifecycle becomes:

```text
pending → extract → consensus → finalized   (+ cancelled at any non-terminal stage)
```

- The Postgres `extraction_run_stage` enum drops `proposal` and `review` and
  gains `extract` (migration `0028_run_stage_extract`; existing `proposal`/
  `review` rows map to `extract`).
- Human extraction writes land as per-user `ReviewerDecision`s directly in
  `extract` (`record_decision` now gates on `extract`). The `/proposals`
  endpoint **rejects** human writes for `kind='extraction'` runs — the
  blind-review write defense is preserved (each reviewer's value must be
  reviewer-scoped, never a shared proposal). AI/system proposals are still
  written in `extract`.
- `useAutoAdvanceToReview` and the `_materialize_human_decisions` boundary
  materialization are **deleted, not moved** — there is no transient `proposal`
  window left to bridge.
- The frontend `ExtractionRunStage` union collapses likewise; the editable-stage
  hooks route by run **kind**: in `extract`, extraction reads/writes go through
  reviewer-states/`/decisions` while QA stays on proposals/`/proposals`.

Consensus and finalize semantics are unchanged in this step (the finalize
completeness gate of ADR-0009 and the consensus/finalize rework are out of
scope; the latter is a follow-up phase).

## Consequences

- **Positive.** One fewer stage and no client-side auto-advance: no race, no
  "advance failed" toast, no invisible boundary materialization. The "X/N
  reviewers" counter and "0% until you accept" progress derive from
  per-user reviewer state that exists live in `extract`.
- **Migration.** In-flight production runs in `proposal`/`review` map to
  `extract` information-preservingly (same data, new label); `consensus`/
  `finalized` are untouched.
- **QA shares the lifecycle.** QA runs also open in `extract` and publish
  straight `extract → consensus → finalized`; QA keeps its shared-proposal
  write path (no per-reviewer blind contract).

See the design spec
`docs/superpowers/specs/2026-06-21-hitl-lifecycle-alignment-design.md` and the
Phase-1 plan `docs/superpowers/plans/2026-06-21-hitl-phase1-stage-collapse.md`.

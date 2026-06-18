---
status: accepted
last_reviewed: 2026-06-17
owner: '@raphaelfh'
adr_number: '0009'
---

# Block extraction finalize until every required field is filled

> **Status:** Accepted · Date: 2026-06-17 · Deciders: @raphaelfh

## Context and Problem Statement

An extraction Run advances `proposal → review → consensus → finalized`.
Finalizing is meant to mean "this article's extraction is done and
published". Three gates were supposed to enforce that, but they disagreed
(verified 2026-06-17):

- **Header finalize button** — blocked at < 100% completeness
  (`isComplete`), the canonical, user-facing rule.
- **ConsensusPanel fast-path** — offered finalize on "no divergence" alone
  (always true for a single reviewer), regardless of completeness.
- **Backend `advance_stage → finalized`** — blocked only when zero
  `ConsensusDecision` rows existed (`EmptyFinalizeError`); empty required
  fields were allowed.

So a run could be finalized with required fields still blank — through the
consensus panel or a direct API call — producing a "Published" article
that is missing data the template declares mandatory. Completeness logic
lived **only** in the frontend (`frontend/lib/extraction/progress.ts`),
which is advisory: it can be bypassed and is not the source of truth.

This decision is stricter than the frozen design spec (the 2026-04-27
extraction HITL + QA design), which specified a consensus-only finalize
gate with no completeness requirement. Rather than silently edit that
immutable spec, the change is recorded here.

## Decision Drivers

- A FINALIZED run is consumed downstream (export, dashboards, reopen
  seed); missing required data corrupts every consumer silently.
- The authoritative gate must live on the server — frontend checks are
  advisory and bypassable.
- The fix must not change quality-assessment (PROBAST/QUADAS-2) finalize
  semantics, which were not analysed here.

## Considered Options

- **A — Server-side completeness gate against resolved reviewer/consensus
  values** (chosen).
- **B — Server-side gate against published values plus auto-publish of
  agreed coords at finalize.** Stronger (export becomes complete) but a
  large change to the consensus engine; published states are otherwise
  sparse (only explicitly-resolved coords are published), so this would
  also have to backfill them.
- **C — Keep the backend at "≥ 1 consensus" and only tighten the
  frontend.** Rejected: leaves the authoritative path bypassable, which is
  the root problem.

## Decision Outcome

Chosen option: **A**. `RunLifecycleService.advance_stage` now blocks the
`consensus → finalized` transition for **extraction** runs when any
required field of any existing instance lacks a resolved value, raising
`IncompleteFinalizeError` (a subclass of `InvalidStageTransitionError`, so
the endpoint already maps it to HTTP 400 with the message in
`error.message`).

Precise semantics:

- **Requiredness** is read from the run's frozen template *version
  snapshot* (`extraction_template_versions.schema_`), so a mid-run
  template edit cannot move the gate.
- **Per existing instance, no phantom instances.** An entity type with no
  instances contributes nothing — so an optional many-cardinality entity
  type with zero instances (e.g. CHARMS `prediction_models` with no models
  added) stays finalizable. Study-level singletons are auto-seeded on
  session open, so their required fields are always enforced.
- **"Resolved value"** is a non-empty published (consensus) value *or* a
  non-empty current reviewer decision. `accept_proposal` decisions resolve
  through the referenced proposal's value; `reject` decisions count as
  unfilled. Emptiness mirrors the frontend predicate exactly (only `None`
  and `""` are empty, after peeling one `{"value": …}` envelope), so the
  backend gate is never stricter than the form the user just saw.
- The existing `EmptyFinalizeError` (≥ 1 consensus) check runs first and is
  unchanged.
- **Scope: extraction only.** Quality-assessment runs keep the
  consensus-only rule; extending completeness to QA is a separate,
  un-analysed decision (a one-line `kind` change plus a QA test
  migration).

The frontend is brought into line in the same change: the ConsensusPanel
fast-path is gated on completeness plus at least one decision, and
`useAdvanceRun` surfaces the backend rejection as a toast instead of
swallowing it.

### Consequences

- Good — a finalized extraction run is guaranteed to carry a resolved
  value for every required field; downstream consumers can rely on it.
- Good — the authoritative rule is server-side and matches the frontend
  metric, so the header button, the consensus panel and the API agree.
- Bad — runs that previously could be force-finalized incomplete now
  cannot; this is the intended behaviour change.
- Neutral — published state remains sparse (only consensus-resolved coords
  are published). Making the export itself complete is Option B,
  deliberately deferred.

## Validation

- New integration test `test_finalize_blocked_until_required_fields_filled`
  (`backend/tests/integration/test_run_lifecycle_service.py`): publishing
  one of two required fields raises `IncompleteFinalizeError`; filling the
  second lets finalize succeed.
- Full backend suite green (1860 passed) with the gate in place; the
  existing `EmptyFinalizeError` regression test
  (`test_cannot_finalize_run_without_consensus`) still passes because the
  consensus check runs first.
- QA publish-flow tests unchanged and green — the gate does not apply to
  `kind=quality_assessment`.

## More Information

- [Extraction + HITL architecture](../reference/extraction-hitl-architecture.md)
- Frozen design spec (consensus-only finalize):
  `docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md`
- Canonical frontend completeness metric:
  `frontend/lib/extraction/progress.ts`
- Implementation: `backend/app/services/run_lifecycle_service.py`
  (`IncompleteFinalizeError`, `_find_unfilled_required_coords`,
  `_filled_coords`).

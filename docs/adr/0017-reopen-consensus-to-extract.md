---
status: accepted
last_reviewed: 2026-07-08
owner: '@raphaelfh'
adr_number: '0017'
---

# Reopen consensus → extract (arbitrator-only), discarding intermediate consensus work

> **Status:** Accepted · Date: 2026-07-08 · Deciders: @raphaelfh
> **Supersedes:** N/A · **Superseded by:** N/A

## Context and Problem Statement

The extraction lifecycle (`pending → extract → consensus → finalized`, plus
`cancelled`) is forward-only: `_ALLOWED_TRANSITIONS` has no edge out of
`consensus` except `finalized` / `cancelled`. Once a manager clicks **Start
consensus**, the run leaves the single editable stage — reviewers can no longer
edit their decisions, "Run AI" is disabled, and the only exits are pushing
forward to `finalized` or the terminal `cancelled`. A manager who opened
consensus **prematurely or by mistake** (the motivating case) was stuck.

The existing `finalized` "reopen" (`reopen_run` / `POST /runs/{id}/reopen`) does
**not** cover this: it forks a *new* child run seeded from the published values.
The gap is a same-run backward move from `consensus`, before anything is
finalized.

## Decision

**Add an arbitrator-only, in-place backward transition `consensus → extract`
that discards the run's consensus work.** A new
`RunLifecycleService.reopen_to_extract` (exposed as
`POST /api/v1/runs/{id}/reopen-extraction`) sets `stage = extract` on the same
run and hard-deletes, for that run, its `ExtractionConsensusDecision` and
`ExtractionPublishedState` rows. Reviewer decisions/states/proposals and the
`extraction_reviewer_ready` flags are **preserved** — reviewers resume editing
exactly where they were, and AI extraction is re-enabled (both are
stage-driven). The run stays a single live run throughout, so the one-live-run
invariant (`uq_one_live_extraction_run_per_coord`, 0045) is untouched.

**Both consensus rows are deleted, not just one.** The frontend derives
"resolved" from `consensus_decisions` (`reconciliation.ts` builds
`resolvedByCoord`), while the backend approve-all and finalize gates key off
`PublishedState`. Deleting only one would leave the other side showing stale
"resolved" state or silently skipping edited coords in `approve_and_finalize`
(`_agreed_unpublished_values` skips already-published coords). Evidence attached
to a consensus decision cascade-deletes (FK `ON DELETE CASCADE`, 0044);
reviewer-attached evidence is preserved.

**Endpoint-only, not via `_ALLOWED_TRANSITIONS`.** `reopen_to_extract` flips the
stage directly and the `consensus → extract` edge is **deliberately absent** from
the transition map. Adding it there would let the reviewer-gated
`POST /runs/{id}/advance` pull a run backward and would break `advance_stage`'s
forward-only invariant. The backward move is reachable only through the
arbitrator-gated endpoint (`ensure_project_arbitrator`, manager/consensus —
symmetric with **Start consensus** and **Approve & finalize**). Extraction only;
a `kind` guard rejects quality-assessment runs (QA passes through `consensus`
transiently in a single publish action).

**The discard is destructive by design, confirmed in the UI.** The header
surfaces a **Reopen extraction** menu item (consensus stage, arbitrator only)
that opens a destructive `AlertDialog` whose copy names the number of resolutions
that will be discarded (`resolvedCount > 0`) or states that nothing is discarded
(`=== 0`, the "by mistake" path).

## The append-only reconciliation (constitution §IX)

Hard-deleting `ExtractionConsensusDecision` — an append-only table — is a
deliberate, bounded departure from §IX, justified as follows:

> A `ConsensusDecision` is **intermediate resolution state**, authoritative only
> once the run reaches `finalized` (that is when its `PublishedState` becomes the
> value of record). Reopening to `extract` is an explicit, arbitrator-only,
> confirmed abandonment of an in-progress consensus pass — like discarding a
> draft. §IX's guarantee protects the **selection of record** (the finalized
> outcome) and the **`ExtractionReviewerDecision`** trail (who chose which
> proposal, preserved here); it does not require retaining abandoned intermediate
> resolution attempts.

To keep the discard from being *silent*, without the complexity of a DB-level
snapshot: the discard is gated behind the confirmation dialog, and the endpoint
emits a self-contained structlog event `hitl_run_reopened_to_extract`
(`run_id`, `project_id`, `article_id`, `discarded_consensus_count`,
`discarded_published_count`, `by`) — the operational forensic record. Exact
discarded values are intentionally not retained.

Alternatives rejected: **keeping the rows** (leaves the frontend showing stale
resolutions and lets `approve_and_finalize` publish stale values); **snapshotting
into `run.parameters` before delete** (extra JSONB-serialization complexity for a
case the owner scoped as "opened by mistake, nothing resolved"); **forking a new
run** like the finalized reopen (revision-lineage noise for what is an *undo*).

## Consequences

- **Positive.** The consensus stage is no longer a one-way door. A premature
  "Start consensus" is undoable; reviewer work is preserved; the destructive
  scope is confirmed and logged.
- **No migration.** No schema change — rows are deleted at runtime.
- **No path assumes consensus rows are undeletable.** The finalize gate
  (`consensus_count > 0`) recomputes; exports read only finalized `PublishedState`
  (a reopened run is non-terminal, never exported); `last_human_activity_order`
  falls back to reviewer decisions (preserved).
- **Neutral.** Re-blinding of reviewers on returning to `extract` is automatic
  (the arbitrator consensus auto-reveal is `stage == consensus`-scoped, ADR-0015).
  `reviewers_ready` flags are kept, so the manager can immediately re-advance if
  nothing needs changing.

## Validation

- Backend: `test_reopen_to_extract_clears_consensus_preserves_reviewer_work`,
  `_no_resolution_is_noop_delete`, `_from_extract_stage_rejected`,
  `_missing_run_raises_valueerror`, `_cascades_consensus_evidence` (real
  Postgres: consensus-evidence cascades, reviewer-evidence preserved);
  endpoint matrix `test_reopen_extraction_{manager_ok, rejects_reviewer,
  rejects_viewer, wrong_stage_returns_400, qa_kind_returns_400}`; direct
  endpoint-coroutine unit `test_reopen_run_to_extract_awaits_arbitrator_gate`
  (ASGI blind spot).
- Frontend: `deriveCanReopenExtraction` (arbitrator + consensus gate),
  `ReopenExtractionDialog` (adaptive discard copy), `useReopenExtraction`
  (endpoint + cache invalidation), ExtractionHeader menu-item visibility.

## More Information

- Design spec: `docs/superpowers/specs/2026-07-08-manager-reopen-consensus-to-extract-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-08-manager-reopen-consensus-to-extract.md`
- Builds on [ADR-0015](0015-finalize-via-approve-publish.md) (consensus stage,
  arbitrator gates, auto-reveal) and [ADR-0016](0016-typed-absent-reason-marker.md).
- [Extraction + HITL architecture](../reference/extraction-hitl-architecture.md)

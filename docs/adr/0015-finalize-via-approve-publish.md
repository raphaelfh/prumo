---
status: accepted
last_reviewed: 2026-06-22
owner: '@raphaelfh'
adr_number: '0015'
---

# Finalize via approve-and-publish; per-reviewer ready flag; consensus auto-reveal

> **Status:** Accepted · Date: 2026-06-21 · Deciders: @raphaelfh
> **Supersedes:** the no-divergence dead-end of 0009 · **Superseded by:** N/A

## Context and Problem Statement

ADR-0009 made `consensus → finalized` require ≥1 `ExtractionConsensusDecision`
(`EmptyFinalizeError`) plus, for extraction runs, every required field resolved
(`IncompleteFinalizeError`). Those gates are correct invariants, but the only UI
that wrote consensus decisions was the divergence resolver — which renders **only
divergent coordinates**. So a run with no divergence (a single reviewer, or full
agreement) had nothing to publish and could never satisfy `EmptyFinalizeError`:
the gate became a dead-end (spec I2/I4). The only escape was the pre-HITL header
`handleFinalize` path, a direct Supabase `extraction_instances.status` write that
never advanced the run (spec I1).

Two adjacent gaps surfaced in the same investigation: a blind manager could not
see peers to adjudicate on entering consensus (I3), and there was no per-reviewer
"I'm done" signal to tell the manager when to open consensus.

This decision is Phase 2 of the HITL lifecycle alignment (design spec
`docs/superpowers/specs/2026-06-21-hitl-lifecycle-alignment-design.md`); Phase 1
(ADR-0014) collapsed `proposal`+`review` into `extract`.

## Decision

**Finalize is reached by an atomic approve-and-publish, keeping ADR-0009's gates
as invariants but always satisfiable.** A new
`RunLifecycleService.approve_and_finalize` (exposed as
`POST /api/v1/runs/{id}/approve-finalize`) publishes, in one transaction, a
consensus value for every existing-instance × field coordinate that has a single
unambiguous resolved reviewer value and no `PublishedState` yet — reusing the
per-coordinate `ExtractionConsensusService.record_consensus` — and then calls
`advance_stage(FINALIZED)`. Because the publishes and the gate checks run in the
same transaction, `EmptyFinalizeError` and `IncompleteFinalizeError` are satisfied
naturally for a complete run; a coordinate whose reviewers still diverge unresolved
is rejected so the manager resolves it first. The gates themselves are unchanged.
Extraction only — quality-assessment keeps its own publish-then-advance flow (a
`kind` guard rejects QA runs from `approve_and_finalize`).

**Per-reviewer "ready" flag.** A new `extraction_reviewer_ready (run_id,
reviewer_id, is_ready, marked_ready_at)` table (migration `0029`) records an
advisory "I'm done extracting" signal, toggled by
`POST /api/v1/runs/{id}/ready` (membership + reviewer-role gated). It does **not**
gate any stage transition — the HITL config is inert (no quorum; one user can
finalize alone). The run view surfaces an `N/M reviewers ready` hint
(`M = max(configured reviewer_count, N)`) so the manager knows when to open
consensus.

**Consensus auto-reveal (run-scoped).** `get_run_with_workflow_history` now
unblinds an arbitrator (manager/consensus) once the run reaches `consensus`,
mirroring the existing `finalized` auto-unblind — run-scoped, no persistent
project-toggle write. Plain reviewers stay blind to peers even in consensus, so
the reviewer↔reviewer boundary (and its RLS-0025 / `resolve_caller_current_values`
lockstep copies) is unchanged; this only relaxes the API path for managers, which
RLS already permits. A `peers_revealed` flag on the run payload echoes the
effective unblind so the client need not re-derive visibility.

**Header primary action (one source of truth).** `buildExtractionTransition` is
phase/role-aware: **Mark ready** (reviewer, extract — sets the flag, no advance) /
**Open consensus** (manager, extract — advances) / **Approve & finalize**
(manager, consensus — `approve_and_finalize`, enabled only when complete and every
divergence resolved). This resolves the two-Finalize-button split (I6); the
`ConsensusPanel` becomes an evaluate-all surface and the legacy header
`handleFinalize` is unwired (Phase 2 stops writing `instance.status`; fully deleted
in Phase 3 — see Consequences).

**Per-coordinate consensus writes are role-gated at the API layer (kind-aware).**
The standalone `POST /api/v1/runs/{id}/consensus` (`record_consensus`) — the
per-coordinate path behind both the extraction `ConsensusPanel` divergence resolver
and the QA per-field publish loop — must enforce role, not just membership, because
the service-role session bypasses RLS (which already admits only `is_project_reviewer`
to the workflow tables). Without it, any project member — including a read-only
**viewer** — could publish a consensus decision and its canonical `PublishedState`.
The gate is kind-aware: **extraction → arbitrator** (`ensure_project_arbitrator`,
manager/consensus), matching this ADR's manager/consensus-only consensus surface and
the `approve-finalize` gate; **quality-assessment → reviewer**
(`ensure_project_reviewer`), because QA "Publish assessment" is by design a
single-reviewer self-publish (its extract-stage publish is deliberately ungated in
`frontend/lib/qa/qaTransition.ts`). A blunt arbitrator gate would have regressed QA
by 403-ing every reviewer's publish. (This closes a gap the original Phase-2
whole-branch review missed — `approve-finalize` was gated, but the older
`create_consensus` predated it and stayed membership-only.)

## Consequences

- **Positive.** A complete no-divergence run finalizes in one action; the gates
  stop being a dead-end while remaining authoritative server-side invariants. The
  blind manager can adjudicate immediately on consensus entry without mutating a
  project-wide setting. The ready flag gives the manager a quorum-free signal.
- **Migration.** `0029_reviewer_ready_flag` adds one table with RLS (member
  SELECT; self + reviewer INSERT/UPDATE). Information-preserving; no backfill.
- **QA mostly untouched.** `approve_and_finalize` is extraction-only; `ConsensusPanel`'s
  evaluate-all / `showFinalize` changes are opt-in props QA does not pass, so QA's
  publish-then-advance and its in-panel finalize button are unchanged for
  reviewers/managers. The one deliberate change: the kind-aware consensus gate above
  now reviewer-gates QA's per-field publish, so a read-only viewer can no longer
  publish a QA assessment (it was previously membership-only).
- **Neutral.** Published state remains sparse (only resolved coords). The header
  "Approve & finalize" gate is advisory; the backend gate is authoritative (a
  rejection surfaces as a toast).
- **Phase 3 — legacy path + column removed.** The `instance.status` write was
  unwired here in Phase 2; Phase 3 deletes the remainder: the `handleFinalize`
  caller and `markInstancesCompleted`, the instance-status progress shortcut
  (row progress is now field-completeness only), and the
  `extraction_instances.status` column with its `extraction_instance_status`
  enum (migration `0030_drop_instance_status`). The run lifecycle is owned
  entirely by `extraction_runs`. Data loss is intentional and accepted; the
  `downgrade` restores the schema but not the data (no backfill).

## Validation

- Backend: `test_approve_and_finalize_publishes_agreed_and_finalizes` (the
  no-divergence dead-end now finalizes), `_requires_consensus_stage`,
  `_blocks_unfilled_required` (the completeness gate still bites),
  `_rejects_unresolved_divergence`; `test_run_consensus_reveal` (arbitrator
  revealed in consensus, reviewer stays blind, `peers_revealed` correct);
  `test_extraction_reviewer_ready` + `test_extraction_runs_ready_api` (idempotent
  toggle, reviewer-role gate, N/M hint on the view). QA finalize tests unchanged.
- Frontend: `stageTransition` (3 phase-aware actions); `ConsensusPanel` evaluate-all
  with `showFinalize`; `hooks-runs` (useMarkReady / useApproveFinalize); QA regression.

## More Information

- Design spec: `docs/superpowers/specs/2026-06-21-hitl-lifecycle-alignment-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-21-hitl-phase2-consensus-finalize.md`
- Supersedes the dead-end of [ADR-0009](0009-extraction-finalize-completeness-gate.md);
  builds on [ADR-0014](0014-collapse-extract-stage.md) and
  [ADR-0012](0012-manager-blind-review-and-reveal.md).
- [Extraction + HITL architecture](../reference/extraction-hitl-architecture.md)

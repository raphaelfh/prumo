---
status: draft
last_reviewed: 2026-08-10
owner: '@raphaelfh'
---

# B-9g (§6 reopen-on-publish) — why it is blocked, and on what

Built from an independent code map (2026-08-10) of every reopen path, made
**before** planning, because §6 conflates two different operations. The map
confirmed that and found more.

**Conclusion up front: §6 cannot be implemented as written.** Not because
it is large — because it is factually wrong about this codebase in four
ways, and both "obvious" implementations are actively destructive. It needs
a product decision and a new ADR, not a plan.

## What actually exists

There are **three** ways a live run appears over a coordinate, not two.

**A. `POST /runs/{id}/reopen` — forks.**
`RunLifecycleService.reopen_run` (`run_lifecycle_service.py:649`).
Reviewer-gated. Requires `stage == finalized`. Mutates nothing: it creates
a NEW run seeded with `source='system'` proposals from the parent's
published values. The parent stays finalized with no pointer back —
lineage lives only in `parameters->>'parent_run_id'` (JSONB, no FK, no
index). The child pins the **currently active** version, not the parent's.

**B. `POST /runs/{id}/reopen-extraction` — destroys in place.**
`RunLifecycleService.reopen_to_extract` (`run_lifecycle_service.py:599`).
Arbitrator-gated. `consensus → extract` on the SAME run. Hard-deletes that
run's `ExtractionConsensusDecision` and `ExtractionPublishedState` rows
(consensus-attached evidence cascades via 0044). Not idempotent — a second
call is a 400. No DB audit; the only record is a structlog line emitted
**after** commit.

**C. `resolve_or_create_extract_run` — unnamed, undocumented.**
`run_lifecycle_service.py:230`, reached from the "Run AI" endpoints. Its
lookup filters `NON_TERMINAL_STAGES`, so a finalized run is invisible to
it: on a finalized coordinate it creates a fresh live run with **no
parent, no lineage, no log line** saying a finalized coordinate was
reopened. Nobody has been treating this as a reopen path. It is one.

## The four things §6 gets wrong

1. **`finalized → extract` exists nowhere.** `_ALLOWED_TRANSITIONS` maps
   both terminals to `set()` (`run_lifecycle_service.py:145-151`), and
   `reopen_to_extract` guards `stage == consensus` explicitly (`:630`).

2. **It is not "a widening of ADR-0017".** ADR-0017's safety argument rests
   entirely on the run *staying live and singular* — quoting it: "the run
   stays a single live run throughout, so the one-live-run invariant
   (0045) is untouched." `finalized → extract` breaks exactly that
   property. ADR-0017 also **explicitly rejected** the fork alternative.
   Worse: a finalized run's `ExtractionPublishedState` rows ARE the value
   of record, which is the thing ADR-0017's §IX carve-out says it does
   **not** cover. Relaxing the guard from `== consensus` to
   `in (consensus, finalized)` looks like a one-line diff and is a silent,
   unrecoverable destruction of published records. **This needs a new ADR
   superseding 0017, not an edit to it.**

3. **`ExtractionHitlConfig.arbitrator_id` is read by ZERO authorization
   paths.** All arbitrator authority today is
   `project_members.role IN ('manager','consensus')` via
   `is_project_arbitrator` (0025). So §6's stated resolution mechanism does
   not exist — making it authoritative is **greenfield authorization
   work**, not a tightening of an existing switch. And since
   `arbitrator_id` is `None` whenever `consensus_rule != 'arbitrator'`
   (`hitl_config_service.py:29`), "authoritative" would mean **nobody** can
   reopen on most projects.

4. **The permission models are incompatible.** `republish` is
   `require_project_manager` (manager only). §6 wants the reopen leg
   arbitrator-gated (manager OR consensus). Putting them in one transaction
   means either widening a manager-only endpoint to consensus users — the
   opposite of the spec's stated tightening — or a second, narrower gate
   inside it.

## Two mechanical blockers on top

**Lock-order inversion.** `acquire_publish_locks` computes its per-article
advisory locks from `_EDITABLE_STAGES = (pending, extract)`
(`template_version_service.py:127`). Every run being reopened is
**finalized**, so its article's lock was never taken. Acquiring run locks
after that inverts the documented lock order against `open_or_resume` —
the docstring says this deadlocks.

**One-live-run, and no carrier for per-run outcomes.** Either semantics
puts each reopened run into `uq_one_live_extraction_run_per_coord` (0045).
Any coordinate that already has a live run — the common case, which the
sheet's own "active runs re-pin automatically" bullet is about — raises
`23505` and **aborts the entire publish transaction**. §6 wants per-run
outcomes ("1 reopened · Chen 2024 was already reopened by L. Costa"), but
`RepublishTemplateVersionResponse` is four scalars with no per-item array,
and a per-run *failure* cannot be reported from a transaction that must
roll back on the first collision. Savepoints per run would be new
machinery. There is also no queryable "reopened by": Path A keeps it in
JSONB, Path B only in a log line.

## What shipped instead

The map surfaced one real, independent bug, and that is fixed:
`POST /runs/{id}/reopen` caught only `CannotReopenRunError` and
`ValueError`, so a one-live-run collision escaped as a **500** where the
sibling `create_run` returns a truthful **409**. Reachable today via path
C: finalized run → someone clicks "Run AI" → unparented live run → reopen
collides → 500. B-9g would have made that the default failure mode.

## The decision needed before B-9g can be planned

1. **Destroy in place, or fork?** They are different products. Destroying
   deletes records of record; forking silently creates N runs pinned to the
   version being published in that same transaction.
2. **Is reopen-on-publish worth a new ADR superseding 0017?** Individual
   reopen already exists post-publish via the worklist, and §6 itself says
   "Publishing never requires reopening."
3. **Who is an arbitrator?** Either `is_project_arbitrator` stays
   authoritative (and §6's sentence about `arbitrator_id` is dropped), or
   per-config authority is designed from zero.

Until 1–3 are answered, any B-9g plan is fiction.

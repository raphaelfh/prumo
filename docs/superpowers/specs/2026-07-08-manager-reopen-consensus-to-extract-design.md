---
status: draft
last_reviewed: 2026-07-08
owner: '@raphaelfh'
---
# Manager reopen: Consensus → Extraction — design

> **Status:** Draft · Date: 2026-07-08 · Deciders: @raphaelfh
> **Problem:** the extraction lifecycle is forward-only. Once a
> manager clicks **Start consensus**, the run leaves the `extract`
> stage and there is no way back — reviewers can no longer edit, "Run
> AI" is disabled, and the only exits are pushing forward to
> `finalized` or `cancelled` (terminal). A manager who opened consensus
> **prematurely or by mistake** is stuck.

## 1. Goal

Let a **manager / consensus arbitrator** send an extraction run **back
from `consensus` to `extract`** (in place, same run), so reviewers can
edit again and AI extraction is re-enabled. The motivating scenario
(owner-confirmed) is *"opened consensus early / by mistake, nothing
resolved yet"* — but the action is also allowed after partial
resolution, in which case the consensus work is **discarded** behind an
explicit confirmation.

### Non-goals

- **Not** the `finalized` reopen. `finalized` runs already have a
  distinct "reopen for revision" flow (`RunLifecycleService.reopen_run`
  / `POST /runs/{id}/reopen`) that **forks a new child run** seeded from
  the published values. This spec is only about the `consensus → extract`
  gap on the **same, not-yet-finalized** run.
- **No** quality-assessment support. QA runs pass through `consensus`
  transiently in a single "Publish assessment" action; there is no
  arbitrator "sitting" in a QA consensus stage to reopen. Extraction only
  (symmetric with `approve_and_finalize`).
- **No** reviewer notification system (out of scope; V1 limitation — see
  §8).

## 2. Decision

**Approach A — in-place backward transition.** The same run moves
`consensus → extract`. Reviewer work (`ReviewerDecision` /
`ReviewerState` / `ProposalRecord`) and `reviewers_ready` flags are
preserved intact. The consensus-produced rows are **hard-deleted**
(dry delete, no DB-level snapshot — see §5).

Rejected alternatives:

- **Fork a new extract run** (mirror the finalized reopen). The
  finalized reopen seeds from `PublishedState`, which for a
  not-yet-finalized run is empty; it would create revision-lineage noise
  for what is really an *undo*. Over-engineered.
- **Generalize `POST /runs/{id}/advance` to accept backward targets.**
  That endpoint is **reviewer-gated**, so any reviewer could pull a run
  back; and `advance_stage`'s forward-only assumption is load-bearing.
  Permission leak + larger blast radius. Rejected.

## 3. Lifecycle change

A new **arbitrator-only, destructive back-edge**:

```text
pending → extract → consensus → finalized
             ↑__________|              ↓
        (reopen_to_extract)       cancelled
        arbitrator-only,
        discards consensus work
```

The run stays a **single live run** throughout (both `consensus` and
`extract` are non-terminal), so the one-live-run invariant (partial
unique index `uq_one_live_extraction_run_per_coord`, 0045) is
untouched — no new row, no index conflict.

## 4. Backend design

### 4.1 Service — `RunLifecycleService.reopen_to_extract`

```python
async def reopen_to_extract(self, *, run_id: UUID, user_id: UUID) -> ExtractionRun: ...
```

- Lock the run `FOR UPDATE` (mirrors `advance_stage` /
  `approve_and_finalize`) so concurrent callers serialize.
- Preconditions (each raises a mapped error):
  - `run.stage == 'consensus'` — else `InvalidStageTransitionError` (400).
  - `run.kind == 'extraction'` — else `InvalidStageTransitionError` (400).
- Delete, for this run:
  - `ExtractionConsensusDecision` rows — the consensus UI derives
    "resolved" from these (`reconciliation.ts` builds `resolvedByCoord`
    from `consensus_decisions`), so they **must** go for a clean slate.
    Their `ExtractionEvidence` cascade-deletes (FK `ON DELETE CASCADE`,
    migration 0044).
  - `ExtractionPublishedState` rows — else `approve_and_finalize`'s
    `_agreed_unpublished_values` **skips** the already-published coord and
    the stale value would stick, silently ignoring reviewers' new edits.
- Set `run.stage = 'extract'` **directly** (NOT via `advance_stage`, and
  the transition is deliberately **absent** from `_ALLOWED_TRANSITIONS`
  — see §4.3). Leave `run.status` untouched (mirror `advance_stage`,
  which does not touch status for `extract`/`consensus`).
- Preserve: `ReviewerDecision`, `ReviewerState`, `ProposalRecord`,
  `extraction_reviewer_ready`.
- Emit structlog `hitl_run_reopened_to_extract` with
  `discarded_consensus_count`, `discarded_published_count`, `by=user_id`
  (operational trace — see §5).

**Auto re-blind is automatic.** The arbitrator consensus auto-reveal is
`stage == 'consensus' && caller_is_arbitrator` (read-path, ADR-0015).
Back in `extract` the condition no longer holds, so peers re-blind
(unless the project's `managers_see_reviewers` toggle is on) with **no**
extra code — provided the frontend cache is invalidated (§4.2, risk #2).

### 4.2 Endpoint

`POST /api/v1/runs/{run_id}/reopen-extraction` (name distinct from
`/reopen`, the finalized fork).

- Membership check + **arbitrator gate** (`ensure_project_arbitrator`,
  = manager/consensus), symmetric with **Start consensus**
  (`/advance` to consensus) and **Approve & finalize**. The gate lives at
  the API layer because the service-role session bypasses RLS.
- Returns `ApiResponse[RunSummaryResponse]` (ran-by scrubbed, like
  `/advance`).
- Error mapping: `InvalidStageTransitionError` → 400, not-arbitrator →
  403, not-found → 404.

### 4.3 Why not reuse `advance_stage` / `_ALLOWED_TRANSITIONS`

Adding `consensus → extract` to `_ALLOWED_TRANSITIONS` would let the
**reviewer-gated** `POST /runs/{id}/advance` pull a run backward — a
permission leak — and it would break the invariant that `advance_stage`
only moves forward (relied on across the service). `reopen_to_extract`
therefore performs its own precondition checks and flips the stage
directly; the backward move is reachable **only** through the
arbitrator-gated endpoint.

### 4.4 No migration

Pure service + endpoint + frontend. Rows are deleted at runtime; no
schema change ⇒ **no Alembic migration**.

## 5. The dry delete — justification (constitution §IX)

Hard-deleting `ExtractionConsensusDecision` (an append-only,
human-selection table) is a departure from the append-only guarantee in
§IX ("every human selection is append-only… not a silent drop"). It is a
**deliberate, documented** choice, justified as:

> A `ConsensusDecision` is **intermediate resolution state**,
> authoritative only once the run reaches **FINALIZED** (that is when the
> `PublishedState` becomes the value of record). Reopening to `extract`
> is an **explicit, arbitrator-only, confirmed abandonment** of an
> in-progress consensus pass — like discarding a draft. §IX protects the
> *selection of record* (the finalized outcome); it does not require
> retaining abandoned intermediate resolution attempts.

Mitigations that keep this from being a *silent* drop, cheaply (no JSONB
snapshot, no schema):

- A clear destructive confirmation dialog (§6) makes the discard
  deliberate and shows the count being discarded.
- The `hitl_run_reopened_to_extract` structlog event records the
  discarded counts + actor as an operational trace.
- A short **ADR** captures this decision (§7).

Deleting a `ConsensusDecision` cascade-deletes evidence attached to it
(consistent with discarding the consensus work); evidence attached to
`ReviewerDecision`s is preserved.

## 6. Frontend design

**Placement.** A **Menu item** in the `RunHeader`, shown **only** when
`stage === 'consensus'` **and** the caller is an arbitrator
(`canResolveConflicts`), labelled **"Reopen extraction"**. This mirrors
the existing finalized "Reopen for revision" menu item
(`ExtractionHeader.tsx`), keeps a destructive action out of the
accidental-click path, and leaves the primary consensus control
("Approve & finalize") unchanged. `buildExtractionTransition` is **not**
modified.

**Confirmation (`AlertDialog`, destructive).** Copy adapts to the count
of resolved decisions, derived from `runDetail.consensus_decisions` via
the existing `reconciliation` helper:

- `resolvedCount > 0`:
  > **Reopen for extraction?**
  > This discards **N resolved consensus decision(s)** (and any evidence
  > attached to them) and returns the article to Extraction, where
  > reviewers can edit again. **This can't be undone.**
  > `[Cancel]` `[Reopen & discard]`
- `resolvedCount === 0` (the "by mistake" path):
  > **Reopen for extraction?**
  > This returns the article to Extraction so reviewers can edit again.
  > Nothing has been resolved yet, so nothing is discarded.
  > `[Cancel]` `[Reopen]`

**Data/state.** Hook `useReopenExtraction` mirroring `useReopenRun`:
`POST /api/v1/runs/{id}/reopen-extraction` via the typed `apiClient`
(no `fetch` / `supabase.from`); `onSuccess` invalidates the run key
family (`runsKeys.detail`) so `/view` refetches the now-empty
`consensus_decisions` / `published_states` and the `extract` stage
(mitigates the stale-cache risk). New copy keys in
`lib/copy/extraction.ts` (must pass the "Run"-noun vocabulary guard).

## 7. Risks

| # | Risk | Sev | Mitigation |
|---|------|-----|------------|
| 1 | Audit loss (§IX) — the arbitrator's selection disappears from the DB. | Med | Documented justification (ADR + §5) + structlog event with discarded counts. |
| 2 | Stale TanStack cache — UI still shows consensus/resolved after reopen. | Med | Mutation invalidates `runsKeys.detail` family; covered by a hook test. |
| 3 | FK/trigger blocks the hard delete at runtime. | Med | Evidence FK is `CASCADE` (0044). Verify no other RESTRICT FK references `consensus_decision` during implementation; the real-Postgres integration test exercises the delete. |
| 4 | Evidence attached to consensus decisions cascade-deletes. | Low | Consistent with "discard the consensus"; stated in the dialog + ADR. Reviewer-attached evidence is preserved. |
| 5 | Concurrency (double-click, or race with Approve & finalize). | Low | `FOR UPDATE` serializes; the loser sees `stage != consensus` → 400; the frontend refetches. |
| 6 | Reviewers not notified the article reopened. | Low | V1 limitation (no notification system). `reviewers_ready` preserved so the manager can immediately re-advance if nothing changed. |
| 7 | `run.status` carries a non-editable value back into `extract`. | Low | Mirror `advance_stage` (leave status); verify a consensus run's status during implementation. |

## 8. Testing plan

**Backend (pytest integration, real Postgres — cascade/RLS are invisible
to mocks):**

- Happy path: consensus run with consensus decisions + published states +
  evidence-on-consensus → reopen → `stage == extract`;
  `consensus_decisions` / `published_states` deleted; consensus-evidence
  cascade-deleted; `ReviewerDecision` / `ReviewerState` /
  `ProposalRecord` / `reviewers_ready` preserved (covers risks #3, #4 on
  a real DB).
- "By mistake" (zero consensus decisions) → deletes are no-ops,
  `stage == extract`.
- Permission: reviewer → 403, viewer → 403, manager/consensus → 200.
- Wrong stage: extract / pending / finalized / cancelled → 400.
- Wrong kind: QA run in consensus → 400.
- (Optional) idempotency/race: second call once already in `extract` →
  400.

**Frontend (vitest):**

- `useReopenExtraction` hits the right endpoint + invalidates the key
  family.
- Header shows "Reopen extraction" only in `consensus` + arbitrator;
  hidden for reviewer/viewer and non-consensus stages.
- `AlertDialog` renders the discard-count copy when `resolvedCount > 0`
  and the soft copy when `0`; confirm fires the mutation, cancel does
  not.
- Copy passes the "Run"-noun vocabulary regression guard.

**E2E (Playwright, ephemeral stack):** build a run to consensus, resolve
a divergence, reopen extraction, assert it is back in `extract` +
consensus cleared + a reviewer can edit — mirroring
`extraction-reopen.ui.e2e.ts`.

## 9. Docs

- **ADR-0017 (short)** — justify the destructive delete of intermediate
  consensus state on reopen (the §IX reconciliation in §5). `0016` is the
  current latest ADR; re-confirm `0017` is free at authoring time.
- Update `docs/reference/extraction-hitl-architecture.md`: add the
  arbitrator-only, destructive `consensus → extract` back-edge to the
  lifecycle description/diagram; bump `last_reviewed`.

## 10. Open questions / future

- **Reset `reviewers_ready` on reopen?** Decided **no** for V1 — in the
  "by mistake" scenario nothing changed about reviewer readiness, and
  keeping the flags lets the manager re-advance immediately. Revisit if
  reopen-after-edits becomes common.
- **Reviewer notification** on reopen — deferred until a notification
  surface exists.

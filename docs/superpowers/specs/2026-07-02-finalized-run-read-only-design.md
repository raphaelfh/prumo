---
status: draft
last_reviewed: 2026-07-02
owner: '@raphaelfh'
---

# Finalized run read-only enforcement — design

> **Status:** Draft — design approved in brainstorm 2026-07-02.
> Implements the "Finalized = canonical published state; read-only;
> reopenable" row of the HITL lifecycle spec
> (`2026-06-21-hitl-lifecycle-alignment-design.md`, phase table) that the
> frontend never honored. Pending: written plan.

## Problem

A run whose header shows stage **Finalized** and the green **Published**
badge still renders a fully interactive form on both session screens:

- Fields accept typing, AI-suggestion accept/reject buttons render, the
  nav rail shows "22 required left", add/remove-model controls work.
- Autosave is gated to `stage === 'extract'`
  (`frontend/pages/ExtractionFullScreen.tsx:379`), so those edits are
  **silently dropped** — worse than blocking, because the user believes
  they changed a published value.
- The form values shown on a finalized run come from the **viewing
  reviewer's own decision stream**, not from the published state
  (`frontend/hooks/extraction/useExtractedValues.ts:98` —
  `usesReviewerStatePath` covers `finalized`). A manager who never typed
  anything sees empty required fields on a run labeled Published.

The backend API write paths are already correct: proposals require
`extract` (`extraction_proposal_service.py:69`), decisions require
`extract` (`extraction_review_service.py:56`), consensus requires
`consensus` (`extraction_consensus_service.py:63`), and `advance_stage`
enforces the "a FINALIZED run carries ≥1 PublishedState" invariant
(`run_lifecycle_service.py:192`). Writes to a finalized run 400.

One integrity hole exists OUTSIDE the API (found in adversarial plan
review, 2026-07-02): instance CRUD goes PostgREST-direct
(`extractionInstanceService.ts`), RLS on `extraction_instances` DELETE
has no stage predicate, and `extraction_published_states.instance_id`
is `ondelete=CASCADE` — deleting an instance silently destroys its
published rows and can leave a finalized run with zero published state,
violating the `advance_stage` invariant and constitution §IX
(append-only). D5 closes this with a one-line FK flip to RESTRICT.
Everything else is frontend presentation and data resolution.

Both screens are affected: `ExtractionFullScreen.tsx` renders the
interactive `ExtractionFormPanel` for every non-consensus stage
(line 1115), and `QualityAssessmentFullScreen.tsx` renders the QA form
whenever `!inConsensusStage` (line 668) — on finalized runs it only
hides the save badge and the header AI-extract button.

## Goals

1. A finalized run is visibly and behaviorally read-only on both the
   extraction and quality-assessment screens.
2. A finalized run displays the **published values**, not the viewer's
   drafts.
3. UI editability and autosave persistence can never disagree again —
   one shared predicate drives both.

## Non-goals

- No backend endpoint/behavior changes (guards verified; test coverage
  is confirmed or added). The one exception is the D5 database-integrity
  migration protecting published rows from CASCADE deletion.
- No change to reopen semantics (any project member may reopen; the
  reopen endpoint already seeds the child run from published values).
- No dedicated "published summary" surface — the existing form layout is
  reused in disabled state (decided in brainstorm; option rejected).
- No RLS or export changes.

## Design

### D1 — Single editability invariant

New helper `frontend/lib/runs/editability.ts`:

- `isRunEditable(stage)` → `stage === 'extract'` (the single export; a
  `reason` vocabulary was considered and dropped in plan review — no
  consumer branches on it, the banner keys off `finalized` directly)

`useAutoSaveProposals`'s `enabled` predicate on **both** screens switches
to `isRunEditable(stage)` (today the predicate is duplicated inline).
The invariant: **the form is editable exactly when autosave persists**.
Divergence between those two is the root cause of the silent-drop bug.

### D2 — `RunEditability` context

New `frontend/components/runs/RunEditabilityContext.tsx` (sibling of
`RunHeaderContext`):

- Value: `{ readOnly: boolean }`.
- `useRunEditability()` returns **editable** when no provider is mounted
  — safe default for tests, the dev harness, and any other `FieldInput`
  consumer.
- Provider wraps the form-panel subtree in `ExtractionFullScreen` and
  `QualityAssessmentFullScreen`, derived once from the active run stage.

Consumers (audit list finalized during planning; known set):
`FieldInput` (`disabled`), AI-suggestion action rows (accept/reject,
batch accept), per-section AI-extract buttons, add/remove
prediction-model and instance controls, and the `QASectionAccordion`
equivalents. Context (not prop threading) was chosen so every future
interactive affordance inherits the gate instead of having to remember a
prop — the forgotten-prop failure mode is this bug.

### D3 — Published values on finalized runs

`useExtractedValues` gains a third resolution path: when
`stage === 'finalized'`, hydrate the values map from
`runDetail.published_states` (already delivered to the frontend; the
ConsensusPanel consumes it) using the same envelope unwrap as the other
paths.

- **No fallback** to reviewer-state: a published run shows only what was
  published. A coord without a published row renders empty — truthful,
  since it was never published. The `advance_stage` invariant guarantees
  at least one row exists.
- Envelopes carrying `absent_reason` (ADR-0016 no-information marker)
  render their label through the existing `value_semantics`
  `ABSENT_REASON_LABELS` / `isAbstention` path, as reviewer-compare does.

### D4 — Read-only chrome (both screens)

Hidden when read-only:

- AI-suggestion accept/reject rows, batch accept, and pending
  suggestions (they remain in history/audit, not in the form).
- AI-extract buttons — per-section and header (QA already hides the
  header one via `canExtract`; extraction now matches).
- Add/remove model and instance controls.
- Save badge (extraction now matches QA's `hidden={finalized}`).
- The nav-rail "N required left" footer (a fill-completion CTA; noise on
  a published run).

Kept: nav rail for navigation (counts now reflect published coverage
automatically, since they derive from the values map), suggestion
history popover (read-only audit trail), Compare / reviewer comparison,
PDF panel.

Added: the finalized sub-header (currently just the `HITLStatusBadges`
"Published" badge) becomes an explicit state banner — "published values,
read-only" copy plus an inline **Reopen for editing** button. The
existing header-menu reopen item stays. Copy through `lib/copy`, English.

### D5 — Backend

No endpoint behavior changes. Two pieces:

1. **Integrity migration**: flip
   `extraction_published_states.instance_id` from `ondelete=CASCADE` to
   `ondelete=RESTRICT` (model + Alembic migration). A published
   instance becomes undeletable — the PostgREST-direct delete path can
   no longer destroy the canonical published record; deleting a
   never-published instance still works. Pinned by an integration test.
2. Confirm (or add, if missing) integration tests asserting writes
   against a finalized run return 400 for proposals, decisions, and
   consensus.

**Accepted residual risk** (logged, deferred): instance INSERT and
label UPDATE remain PostgREST-open to members with no stage predicate —
presentation-only pollution of a finalized view (published values are
untouched). A follow-up RLS ratchet on `extraction_instances` /
`extraction_published_states` direct writes is out of scope here.
Additionally (2026-07-02 hardening review): in a REOPENED revision, an
instance that carries published rows from the finalized parent cannot be
removed (the deferred FK blocks the delete at commit) — the UI surfaces
a specific "pinned by a published revision" message instead of the
generic failure; an append-only retire/supersede flow for published
instances is a follow-up, not this change.

## Edge cases

- `stage === 'pending'` (or not yet loaded): read-only; no published
  banner (transient stage, invariant coverage only).
- `stage === 'consensus'`: the form panel is not rendered today
  (ConsensusPanel branch); the context covers it defensively if that
  changes.
- Reopen: creates a child run in `extract`; the existing session refetch
  flips the context to editable — no new wiring.
- `FieldInput` outside the provider: default editable, unchanged
  behavior.

## Testing

Interleaved per layer, not batched at the end:

- **Vitest**: `editability.ts` predicate; `useExtractedValues` finalized
  path (published envelope resolution, `absent_reason` → label);
  `FieldInput` disabled under a read-only provider;
  `SectionAccordion` / `QASectionAccordion` hide suggestion actions when
  read-only; screen-level tests (both screens) — finalized run ⇒ fields
  disabled, banner present, zero accept/reject buttons.
- **pytest**: verify or add "write to finalized run ⇒ 400" integration
  coverage for proposals, decisions, consensus; "instance delete with
  published rows is blocked" for the D5 migration; migration roundtrip
  (`downgrade -1 → upgrade head`) stays green.
- **Visual**: `/design-review` on the extraction route with a finalized
  run before claiming done.

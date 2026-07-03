---
status: draft
last_reviewed: 2026-07-03
owner: '@raphaelfh'
---

# Consensus as the compare table — design

> **Status:** Draft · Date: 2026-07-03 · Deciders: @raphaelfh
> **Relation to existing design:** Supersedes the *surface* of the 2026-06-23
> consensus-view-fixes spec (the card worklist) while keeping its semantic
> model intact: reconciliation-by-state buckets, optional rationale (F),
> full-envelope agreement, newest-consensus-wins. No backend change.

## Context — what was reported

The consensus stage renders a card worklist (`ConsensusPanel`) with a raw
JSON override input ("Custom value (JSON; use a string for free-text
fields)"), no side-by-side view of reviewers, and no PDF panel. Meanwhile the
extraction/QA "Compare" surface (`RunReviewerComparison`) already renders the
side-by-side per-field table — but it is read-only and disappears entirely in
the consensus stage. Two complaints, one root cause:

1. **Compare is a dead end** — it shows the comparison but you can act on
   nothing.
2. **Consensus loses the comparison** — exactly the stage where side-by-side
   matters most, the layout degrades to stacked cards and a JSON input.

## Decisions (locked with the user, 2026-07-03)

| # | Decision |
|---|----------|
| D1 | The consensus stage **renders the compare table** with resolution inline. The card-based `ConsensusPanel` is deleted. |
| D2 | **Full table + filter chips**: all `(instance, field)` coords grouped by entity/instance, with a per-row status; chips `Needs attention (n)` (default) · `All` · `Resolved (n)`. |
| D3 | **Typed override editor**: the raw JSON input dies. The editor dispatches on `field_type` (text/textarea, number + unit, date, select + other, multiselect + other, boolean) and can emit the "No information" disposition marker (ADR-0016). |
| D4 | **Both kinds at once**: extraction and QA consensus swap to the new surface together (one shared component, as today). |
| D5 | **Approach A — one mode-aware surface**: `RunReviewerComparison` gains an optional `resolution` prop; without it the read-only compare (extract/assess) is unchanged. No separate consensus table component. |

## Architecture

### `RunReviewerComparison` (evolved, `frontend/components/runs/`)

Keeps its current skeleton — rows are `(instance, field)` grouped by
entity type → instance; columns are one per reviewer with decisions — and
gains an optional `resolution` prop. Absent ⇒ byte-for-byte today's read-only
behavior. Present ⇒ resolve mode:

- **"Consensus" column** (last): per-row status (conflict / required gap /
  single-filler / agreed / resolved); when resolved, the published value +
  source ("from {reviewer}" or "Custom") + rationale in a tooltip + a
  "Change" button that re-opens resolution.
- **Filter chips** above the table: `Needs attention (n)` (default) · `All` ·
  `Resolved (n)`. Buckets come from the existing `classifyReconciliation`.
- **Adopt affordance**: in an unresolved row, each reviewer cell exposes
  "Use this value" (hover/focus-visible); clicking publishes
  `select_existing` immediately (parity with today; reject cells stay
  inactive).
- **Override row**: an "Override" button in the Consensus column expands one
  extra full-width row (`colspan`) hosting the typed editor + optional
  rationale + "Publish override". Required-gap rows open the editor with one
  click (no mass auto-expand).
- **The "You" column disappears in resolve mode** — the arbitrator, if they
  reviewed, is an ordinary reviewer column (`decisionsByCoord` already
  includes everyone once `peers_revealed`). `ownValues` is not consumed in
  resolve mode.

The component stays **presentational**: no fetching, no mutation hooks inside.

### `FieldValueEditor` (new, shared)

The type-dispatch core extracted out of `FieldInput`: value in, `onChange`
out — no AI chrome, no `RunEditabilityContext` coupling (which is read-only
during consensus and would disable a reused `FieldInput`). `FieldInput`
delegates its input rendering to it; the four existing `FieldInput.*.test.tsx`
files are the regression net for the extraction. The consensus override uses
`FieldValueEditor` plus a "No information" disposition option that emits the
ADR-0016 marker (something the JSON box could never produce).

**Canonical envelope requirement**: the editor emits values in the same
envelope the extraction form produces (via the shared `valueSemantics`
helpers), so a `manual_override` publish is indistinguishable downstream
(export, appraisal) from a `select_existing` publish.

### `deriveConsensusResolution()` (new, `frontend/lib/runs/reconciliation.ts`)

The logic currently inlined in `ConsensusPanel` becomes a pure function:
newest-consensus-wins `resolvedByCoord`, buckets via `classifyReconciliation`,
per-coord status, and the finalize gate (`conflicts resolved && no required
gaps && isComplete && ≥1 consensus decision`). Consumed by both pages;
unit-tested directly.

### Mounting and deletion

- `ConsensusPanel.tsx` is **deleted** (both pages).
- Extraction (`ExtractionFullScreen`) and QA (`QualityAssessmentFullScreen`)
  mount the resolve-mode table in the same `RunSplitShell` `formPanel` slot;
  the **PDF panel becomes available during consensus** via the existing
  header `PanelToggle`.
- Finalize ownership is unchanged: extraction header owns "Approve &
  finalize"; QA renders a slim finalize bar above the table (today's
  `showFinalize` contract).
- **Zero backend change**: same `GET /runs/{id}/view`, same
  `POST /runs/{id}/consensus` with `select_existing` / `manual_override`.

## Interaction model

| Row state | Reviewer cells | Consensus column |
|---|---|---|
| Conflict | "Use this value" per cell (reject inactive) | conflict badge + Override |
| Single-filler | same (adopt the lone value) | single-filler badge + Override |
| Required gap | empty cells | "Required · not filled" + Override (opens editor) |
| Agreed | equal values, no action | "Agreed" — published by approve-finalize, as today |
| Resolved | — | published value + source + rationale tooltip + "Change" |

- Adopt = immediate `select_existing`, no rationale prompt (parity).
- Override publish is gated on a non-empty typed value **or** the
  "No information" marker; rationale stays optional (2026-06-23 decision F).
- Agreed rows remain non-actionable (parity; arbitrator override on agreed
  rows is an explicit non-goal for this iteration).

## Data flow

Unchanged at the edges: `useRun` → `useReviewerSummary` →
page builds the `resolution` prop from `deriveConsensusResolution()` plus
callbacks from `useCreateConsensus` (which already invalidates
`runsKeys.detail`). `useConsensusReconciliation` keeps providing
`fieldLabelByCoord` and `requiredCoords`. Copy goes through `lib/copy`;
short-label/icon buttons carry Tooltip + `aria-label`.

## Permissions & blinding

- The page constructs `resolution` only when the caller can resolve
  (extraction: arbitrator/manager — mirrors the backend write guard; QA:
  reviewer self-publish — parity with current behavior).
- A non-resolver in consensus sees the plain read-only table.
- A blind caller receives no peer columns because the server already scrubs
  `decisions` (`peers_revealed` / ADR-0012). Resolve affordances are pure UI
  over already-revealed data — **no new leak surface**.

## Error handling

- Mutations stay in the pages' existing handlers (services return
  `ErrorResult`, pages toast + refetch). The table receives `disabled`
  (`isResolving`) and disables all controls while a publish is inflight.
- Optimistic-concurrency conflicts on `PublishedState` resolve via refetch
  (newest-wins display, today's behavior).

## Testing

- `deriveConsensusResolution`: pure unit tests — buckets, newest-wins,
  finalize gate (each guard individually).
- `FieldValueEditor`: per-type render + `onChange` payload tests. The
  **payload-envelope test is the highest-value test in the feature**: the
  override payload must match what `select_existing` would publish for the
  same logical value. Includes select/multiselect "other" and the
  "No information" marker.
- `FieldInput`: the four existing test files stay green after delegation
  (regression net for PR 1).
- `RunReviewerComparison`: read-only mode unchanged; resolve mode — filter
  chips, adopt fires the right callback, override builds the right payload,
  omitting the `resolution` prop renders zero resolve affordances, blind
  caller renders no peer columns.
- Pages: consensus mount swap on both screens; E2E survives because the
  critical testids keep their names (`consensus-accept-*`,
  `consensus-override-submit-*`, `consensus-finalize-button`).
- Post-implementation: `/design-review` loop on the consensus route (project
  rule: verify with eyes, not diff).

## Rollout — two PRs (merge-train)

1. **PR 1 — pure refactor**: extract `FieldValueEditor`, make `FieldInput`
   delegate. No visible change; existing tests are the proof.
2. **PR 2 — the feature**: resolve mode in `RunReviewerComparison`,
   `deriveConsensusResolution`, both page swaps, `ConsensusPanel` deletion,
   new copy keys.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `FieldInput` regression (hottest component) | PR 1 isolated; 4 test files as net |
| Override value-envelope mismatch | reuse `valueSemantics`; dedicated payload tests |
| Table density with many reviewers | existing `overflow-x-auto`; `min-w` on the Consensus column |
| E2E drift | critical testids preserved verbatim |
| Extraction/QA drift returning | single shared component, single `resolution` prop |

## Out of scope

- Backend changes of any kind (endpoints, models, gating).
- Override on agreed rows.
- Rationale prompt on adopt (`select_existing` stays one-click).
- Compare toggle behavior in extract/assess stages (read-only compare stays
  as is; making it *useful* there is exactly what resolve mode does for the
  consensus stage).
- Refactoring `FieldInput` beyond the input-dispatch extraction.

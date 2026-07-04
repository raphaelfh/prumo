---
status: draft
last_reviewed: 2026-07-04
owner: '@raphaelfh'
---

# Consensus AI trace + compare-toggle cleanup — design

Locked with user 2026-07-04; revised same day after a 3-lens adversarial
panel (24 findings) — the panel's blocker reshaped D0/D4 and the QA scope.
Follow-up to the 2026-07-03 compare-table spec (shipped as #483).

## Problem

1. **Traceability gap.** The resolve-mode compare table shows each
   reviewer's *value* but not *how they arrived at it*. The arbitrator
   cannot see which AI extraction a reviewer adopted, its evidence, or the
   prompt that produced it. Conflicts with constitution §IX. The audit
   surfaces already exist (`AISuggestionReviewPopover`,
   `GenerationDetailsDialog`, `useReaderLocate`) — but the *link* does
   not: no UI write path records `proposal_record_id` today (see facts).
2. **Dead header affordance.** During consensus both screens always render
   `ConsensusResolutionPanel` (ignoring `viewMode`), yet the header keeps
   offering `CompareToggle`. The mechanism differs per screen: extraction's
   `canCompare` stays true via `peers_revealed` (arbitrator auto-reveal);
   QA's stays true via the persistent `canSeeOthers` setting (it never
   reads `peers_revealed`). Either way, clicking does nothing. QA has a
   second dead affordance: the header divergence chip's
   `onJumpToDivergence` flips `viewMode` during consensus, which the
   consensus branch ignores.
3. **Context pollution.** The superseded 2026-06-23 consensus spec/plan
   (card worklist, deleted `ConsensusPanel`) still sit un-flagged where
   agents load them; ADR-0015 still names `ConsensusPanel` as the
   consensus surface.

## Verified facts the design rests on

Positive:

- Backend `record_decision` accepts and persists an optional
  `proposal_record_id` on **any** decision kind, including `edit`, and
  includes it in the idempotent-replay key
  (`extraction_review_service.py:49,116,126`). The linkage fix is
  frontend-only.
- `GET /articles/{id}/suggestions/history` is gated by project membership
  only; the AI proposal trail is article-wide and shared. `ranByName` is
  resolved server-side per history item; today it surfaces only inside
  `GenerationDetailsDialog` — popover run-group headers are anonymous
  timestamps.
- Both consensus mount points sit inside `RunEditabilityProvider` with
  `stage='consensus'`, and `isRunEditable` is true only for `'extract'` —
  so the popover is **already read-only in consensus via context**
  (`editability.ts:7`, `ExtractionFullScreen.tsx:1197`,
  `QualityAssessmentFullScreen.tsx` formPanel). No new read-only plumbing
  needed; the only gap is that `onSelect` is a required prop.
- Locate-with-closed-panel has no dead end: both screens subscribe
  reader-locate to open the PDF panel, and the consensus panel renders
  inside the shared `ViewerProvider`.

Negative (the panel's blocker):

- **No UI write path records the AI link today.** Both screens use
  `acceptStrategy: 'human-proposal'`: accepting/selecting an AI suggestion
  bubbles the value into the form; extraction autosave persists it as
  `decision:'edit'` with **no** `proposal_record_id`
  (`useAISuggestions.ts:143`, `extractionRunService.ts:173`). Without D0,
  the trace icon would never render and a "Manual" chip would mislabel
  every AI-adopted value.
- **QA has no reviewer-decision rows in real flows.** QA autosave writes
  human `/proposals` (no `kind`/`stage` passed →
  `useDecisionEndpoint=false`); nothing creates QA decisions.
  `decisionsByCoord` — the compare table's only source — is empty on real
  QA runs; #483's QA tests hand-feed decisions fixtures, masking this.
  Knock-on effects, all verified: QA's "Use this value"
  (`select_existing`) would fail validation against real decision rows
  (`extraction_consensus_service.py:86-99`); single-user exports read
  decisions only, so **QA exports are blank today**
  (`extraction_export_service.py:1185`). Fixed by D8 this cycle.
- The decisions write path is gated by **stage, not kind**
  (`extraction_review_service.py:56-59` — `stage != 'extract'` is the
  only block): a QA run in extract accepts reviewer decisions as-is,
  same `ensure_project_reviewer` role gate. QA finalize/publish never
  reads decisions (QA publishes via per-field `manual_override`
  consensus), so D8 does not disturb it.
- QA form hydration reads **raw `runDetail.proposals`**
  (`QualityAssessmentFullScreen.tsx:247-258`), not `current_values` — the
  backend Layer-1(own proposals)/Layer-2(own decisions) resolver already
  exists (`resolve_caller_current_values`) and covers both old
  (proposals-only) and new (decisions) QA runs.
- Section provenance is last-writer-wins per (run, section): if the same
  section is re-extracted under one run by a different user, older
  proposals in that run group are retroactively attributed to the latest
  runner. Accepted data-model limitation, documented here.

## Decisions

- **D0 — Record the linkage at write time (extraction, frontend-only).**
  The extraction screen already tracks accepted-suggestion state per coord
  (`aiSuggestions`, keyed `${instanceId}_${fieldId}`, carrying the
  accepted `proposal_record_id`). `useAutoSaveProposals` gains an optional
  `linkByKey` map (coord key → proposal id); the autosave body attaches
  `proposal_record_id` to the `edit` decision when the coord's current
  value originated from an accepted/selected AI suggestion (further edits
  keep the link — the chip wording distinguishes, D3). Zero backend.
  Forward-only: decisions written before this ship carry no link (D4
  handles them without misattribution).
- **D1 — Per-cell AI trace icon (consensus resolve mode only).** In each
  reviewer cell, render a discrete sparkles icon-button **iff**
  `decision.proposal_record_id != null && decision.decision !== 'reject'`.
  Renders on **all row states** including agreed/resolved — two reviewers
  agreeing on the same AI basis is itself audit-relevant. The Consensus
  column is unchanged: trace affordances live only in reviewer cells; a
  `manual_override` resolution keeps its "Custom" label and gets no chip.
  Icon gets a tooltip + aria-label (frontend a11y rules).
- **D2 — Reuse `AISuggestionReviewPopover` read-only.** Make `onSelect`
  optional (render no action when absent); rely on the existing
  `RunEditabilityContext` for read-only — no new `readOnly` prop. The
  trace passes `selectedProposalId = decision.proposal_record_id`,
  `getHistory`, `articleId`, `fieldType`, `allowedValues`. Evidence keeps
  "Locate in document" (same `useReaderLocate` flow); "How this was
  generated" keeps opening `GenerationDetailsDialog`.
- **D3 — Explicit attribution (option B, blinding-aligned).** Additive,
  optional popover props; existing call-sites unchanged unless stated:
  - Title override: consensus passes "AI used by {reviewer}".
  - Adoption chip: the trace passes the decision value; the popover
    compares it with the pinned version's value — equal ⇒
    "Adopted by {name}", different ⇒ "Edited by {name}" (covers `edit`
    decisions honestly).
  - Cross-marking: the trace passes a `{proposalId → reviewerLabel}` map
    built from the row's peer decisions; every matching version row gets a
    small "Adopted by {other}" tag, so the shared history under one
    reviewer's title cannot mis-read as "nobody else adopted".
  - Run-group headers gain ran-by attribution (initials avatar +
    "Run by {ranByName}" + timestamp) **whenever the caller may see peer
    identity** (`peersRevealed || canSeeOthers`) — this covers consensus
    (auto-reveal) and unblinded/manager extract-stage use. A blind
    reviewer during extract keeps today's timestamp-only header, matching
    the #474 identity-scrub precedent. Fallback when `ranByName` is
    absent (legacy runs): timestamp-only.
- **D4 — Manual chip without misattribution.** In resolve-mode reviewer
  cells, show a discrete outline "Manual" chip only when the decision has
  no link **and** the coord has no AI suggestion at all (from the screen's
  `aiSuggestions` map). A coord that has AI proposals but an unlinked
  decision (all pre-D0 history) shows **nothing** — "can't tell" must not
  render as "Manual" on an adjudication surface. Chip gets a tooltip.
- **D5 — History fetch depth + honest degradation.**
  `useAISuggestions.getSuggestionsHistory` gains an optional `limit`
  param (screens don't import the service; the backend endpoint caps at
  100). Consensus passes 50. When `selectedProposalId` is set but absent
  from the loaded items, the popover shows an explicit "adopted version
  is older than the loaded history" notice — today's code would silently
  drop the pin, erasing the attribution.
- **D6 — Remove dead consensus affordances.** Extraction:
  `hasComparison={canCompare && !inConsensusStage}`. QA: add
  `!inConsensusStage` to the CompareToggle guard **and** to
  `onJumpToDivergence`. While touching the QA wiring, gate `canResolve`
  on non-viewer roles (today a viewer gets resolve chrome whose writes
  403 — one line + test).
- **D7 — Docs hygiene (separate PR).**
  - Move `docs/superpowers/specs/2026-06-23-consensus-view-fixes-design.md`
    and `docs/superpowers/plans/2026-06-23-consensus-view-fixes-phase-a.md`
    into their `archive/` folders with a top-of-file "SUPERSEDED by the
    2026-07-03 compare-table spec" banner.
  - ADR-0015: one-line note that the consensus surface is now the
    resolve-mode compare table (`ConsensusPanel` deleted, #483).
  - `extraction-hitl-architecture.md` glossary: **add** a
    consensus-surface entry (the glossary never named `ConsensusPanel`;
    this is an addition, not a correction).
  - ADR-0009/0010 already carry banners + `superseded_by` frontmatter —
    no action.
- **D8 — QA decisions parity (hybrid, user-elected into this cycle).**
  Gives QA real per-reviewer decisions so the compare table, adopt,
  trace, and exports work there too:
  - **(a) Going forward, one shared write path.** QA autosave writes
    decisions in the extract stage: extend the `useDecisionEndpoint`
    predicate to `kind === 'quality_assessment'` too (backend already
    accepts it — stage-gated only). D0's `linkByKey` then applies
    identically on QA. The QA screen's hydration switches from raw
    `runDetail.proposals` to `current_values` (Layer-1 keeps old
    proposals-only runs hydrating; Layer-2 picks up new decisions).
  - **(b) One-shot materialization at extract→consensus.** In
    `RunLifecycleService.advance_stage`, for QA runs: each
    (reviewer, coord) whose newest human proposal has no decision gets an
    `ExtractionReviewerDecision` inserted as **`edit` with the proposal's
    value copied** plus the `ExtractionReviewerState` upsert. NOT
    `accept_proposal`: that kind carries `value=None` by contract, which
    the table renders as "No value" and the agreement math would collapse
    two different adoptions into "agreed". No `proposal_record_id` (a
    human proposal is not an AI proposal; pinning it into the AI-history
    popover would mis-trace). Idempotent: coords that already have a
    decision are skipped. Covers runs mid-flight at deploy.
  - Consequences: QA `select_existing` ("Use this value") starts working
    against real rows; QA single-user exports stop being blank. The
    per-cell trace icon appears on QA for post-deploy linked decisions
    (D0-a); materialized decisions carry no link and follow D4's
    "show nothing when ambiguous" rule.

## Architecture

New leaf component **`frontend/components/runs/ReviewerAITrace.tsx`**
(own file — `RunReviewerComparison` is at 640 lines):

- Props: `decision`, `decisionValue`, `field` (type + allowed_values),
  `articleId`, `getHistory`, `reviewerLabel`, `adoptionByProposalId`,
  `showRanBy`. Renders the icon-button (D1) or the Manual chip (D4) and
  mounts the popover with the D2/D3 props.
- Service-free: `getHistory` arrives as a prop (the apiClient/supabase
  static-import chain must not enter this module graph — jsdom CI
  constraint).

Threading: screens → `ConsensusResolutionPanel` (new props
`getSuggestionsHistory`, `articleId`, `aiSuggestions`) →
`RunReviewerComparison` via the `resolution` object → `ResolveRow` →
`ReviewerAITrace`.

File-size ratchet: PR1 necessarily grows both baseline-frozen pages
(`ExtractionFullScreen.tsx` 1310, `QualityAssessmentFullScreen.tsx` 841)
and possibly `frontend/lib/copy/extraction.ts` (928); the PR updates
`scripts/fitness/check_file_size.baseline` in the same commit (known
Fitness + Backend-Tests double-failure otherwise).

Copy: keys used by the shared popover (ran-by header, adoption chips,
history notice) go in the namespace the popover already draws from;
consensus-only keys (trace aria-label/tooltip, Manual chip, title
override) under `consensus`. English, single-sourced in
`frontend/lib/copy/`.

## Testing

- D0: autosave unit — body carries `proposal_record_id` for linked
  coords, omits it for manual/unlinked; idempotent replay unaffected.
- D1/D4: `ReviewerAITrace` unit — icon iff linked non-reject; Manual chip
  iff no link AND no AI suggestion for the coord; nothing when AI existed
  but the decision is unlinked; renders on agreed rows; tooltips +
  aria-labels present; engine-free pdf-viewer imports only.
- D2/D3: popover unit — optional `onSelect` renders no action; title/chip
  overrides; "Adopted by" vs "Edited by" by value comparison;
  cross-marking tags; ran-by header present when `showRanBy`, absent
  (timestamp-only) otherwise and when `ranByName` missing.
- D5: hook passes limit through; popover renders the not-in-history
  notice when the pinned id is absent.
- D6: CompareToggle absent in consensus, present in extract/assess (query
  by accessible name); QA divergence chip inert-guard; viewer sees no
  resolve chrome.
- D7: docs-ci green (frontmatter, markdownlintignore globs already cover
  `specs/2026-*-design.md` and `specs/archive/**`; verify the plans
  archive path is covered before moving).
- D8-a: QA autosave posts to `/decisions` in extract (and still
  `/proposals` never); hydration renders old proposals-only runs and new
  decision-backed runs identically via `current_values`.
- D8-b: backend integration — advancing a QA run with human proposals
  materializes `edit` decisions with copied values + reviewer_states;
  replaying the advance is idempotent; a coord with an existing decision
  is untouched; QA `select_existing` consensus succeeds against a
  materialized decision. Run on real PG (delete-orphan/transient-filter
  class needs it).

## PR slicing

- **PR 1 (feature):** D0–D6 — write-path linkage, consensus trace UI on
  both screens, popover attribution, dead-affordance cleanup, baseline
  update. Trace icons light up on extraction immediately; QA data
  arrives with PR 2.
- **PR 2 (QA parity):** D8 — QA autosave flip + hydration switch +
  consensus-entry materialization (the cycle's only backend change; no
  schema migration — existing tables only).
- **PR 3 (docs):** D7 — non-overlapping paths, safe in parallel.

## Out of scope

- Filtering the popover to only the adopted version (rejected: shared
  history is useful arbitration context — cross-marking covers the
  ambiguity instead).
- Per-row expander comparing all reviewers' AI bases (rejected: heavier
  component, diverges from the "same modal" goal).
- Schema migrations (D8 uses existing tables; the only backend change is
  the consensus-entry materialization step).
- Backfilling AI links for historical decisions, and any AI-link recovery
  for materialized QA decisions (the link was never recorded at write
  time).

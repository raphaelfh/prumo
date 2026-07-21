---
status: draft
last_reviewed: 2026-07-09
owner: '@raphaelfh'
---

# Consensus per-field AI trace + honest link-primary cross-marks — design

Locked with user 2026-07-09 through a brainstorming cycle plus two
adversarial workflows (a compare-view reachability audit + 5-lens design
panel; and a cross-mark honesty review with 3 rival models refuted by
paired skeptics). Follow-up to the 2026-07-04 consensus-ai-trace spec
(shipped as #488/#491), which this partly supersedes on the reviewer-cell
trace mechanics.

## Problem

At the consensus stage a reconciler (and, on the read-only surface, other
reviewers/viewers) cannot see **where a field's value came from** — the
AI's extraction, its evidence in the source text, and its reasoning —
unless a very specific and rare condition holds. Today's per-reviewer-cell
trace (`ReviewerAITrace`, spec 2026-07-04 D1) renders **iff**
`decision.proposal_record_id != null`, i.e. only when a reviewer explicitly
adopted an AI suggestion through the write path that records the link. In
practice that link is rarely present (values are typed, or runs predate the
feature), so the consensus surface shows little or no AI provenance — which
reads as a bug even though the component works as specified. Conflicts with
constitution §IX (transparency & traceability of AI-assisted decisions).

Two secondary problems surfaced during the review:

1. **Cross-mark honesty.** Attributing an AI version to a reviewer by
   *value equality* (the intuitive "who landed on the AI's answer") **fabricates
   provenance**: every "no information" marker byte-matches every no-info AI
   version, short scalars collide by chance, and `accept_proposal` (the
   cleanest adoption) carries `value=null` and would false-negative. Only the
   persisted link is honest across these extremes.
2. **Peer over-attribution.** Today the peer cross-marks flatten to a blanket
   "Adopted by {name}", overclaiming a peer who linked-then-edited as a
   verbatim adopter.

## Verified facts the design rests on

Reachability (compare-view audit, high confidence):

- The read-only mode of `RunReviewerComparison` (mounted **without** the
  `resolution` prop) is **reachable production code, not dead**. Three mounts:
  (a) `ExtractionFormPanel.tsx:54` and (b) `QualityAssessmentFullScreen.tsx:758`
  are always read-only and reachable via a live `CompareToggle` during the
  extract/assess stage (ADR-0012 feature, kept in-scope by the 2026-07-03
  spec); (c) `ConsensusResolutionPanel.tsx:114` renders it when
  `canResolve === false` — the non-resolver consensus surface this feature
  targets. It must **not** be deleted; 6 user-facing tests cover it.
- Who lands on the read-only branch at consensus: extraction non-arbitrator
  reviewers **and** viewers (`canResolve = permissions.canResolveConflicts`,
  arbitrator-only); QA viewers (`canResolve = userRole !== 'viewer'`). The
  consensus panel is rendered for everyone; only the resolve chrome is gated.

Data availability (cross-mark audit, high confidence):

- The consensus panel already receives, on both screens, a fully-populated
  trace context: `articleId`, `getSuggestionsHistory` (50-deep), and
  `aiSuggestions` (keyed `${instanceId}_${fieldId}`, latest proposal per
  coord). `useAISuggestions` is **not** stage-gated. **Zero backend change.**
- Each reviewer decision carries `value` (envelope/marker), `decision`
  (`accept_proposal|reject|edit`), `proposal_record_id` (nullable link),
  `reviewer_id`, `created_at` (`hooks/runs/types.ts:66`). Each AI history
  version carries `id` (**same id space** as `proposal_record_id`), `value`
  (raw-unwrapped, except abstentions kept as the full marker), `runId`,
  `provenance.ranByName`, `confidence`, `reasoning`, `evidence[]`.
- Version **values** are loaded lazily on popover open — cross-marks that need
  value comparison must run inside the open popover, not at table-render time.

Honesty constraints (decisive, both directions):

- **Value equality fabricates on abstentions (guaranteed):**
  `{value:null, absent_reason:'no_information'}` stableStringifies identically
  for an AI no-info version and an independently-marked no-info decision, so
  `decisionMatchesVersion` returns `true` with zero causal link. Same
  coincidental-match risk for short scalars.
- **Value equality false-negatives the cleanest adoption:** `accept_proposal`
  carries `value=null` by contract; `decisionMatchesVersion` returns `false`
  for a null decision envelope (`valueEquality.ts:37`).
- Therefore the **only** honesty-safe existence signal is the explicit link
  `decision.proposal_record_id === version.id`. `decisionMatchesVersion`
  (`lib/runs/valueEquality.ts`) is reliable **but** may refine wording only on
  an already-linked row — it must never mint a mark.
- The `aiLink.ts` invariant (never derive AI links from `suggestions[].status`)
  generalises: value coincidence is a different-but-equivalent unsafe
  inference source, likewise barred from creating a mark.

## Decisions

- **D1 — Per-field AI trace on the field-label row (column-independent).** A
  new leaf `FieldAITrace` renders a discrete AI-suggestion icon on the field
  label **iff** the coord has an AI proposal (`aiSuggestions[coordKey]`
  present). It opens the shared `AISuggestionReviewPopover` read-only
  (locate-in-text via `useReaderLocate`, reasoning, `GenerationDetailsDialog`).
  Its **existence is endorsement-neutral** — "the AI proposed something for
  this field", never "this value is AI-derived". Renders on **all row states**
  and for **all roles** at consensus (resolve + read-only). Silent absence
  when no AI proposal, or when `aiSuggestions === null` (loading/failed) — no
  "no AI" chip.

- **D2 — One trace channel, not two (relocate, never duplicate).** Delete
  `trace` from `ComparisonResolution`; add a single top-level optional
  `aiTrace?: ConsensusTraceContext` prop on `RunReviewerComparison`.
  `ConsensusResolutionPanel` passes `aiTrace` **unconditionally** (it keeps
  gating only the resolve chrome — adopt/override/status — behind
  `canResolve`). Both trace surfaces (D1, D3) consume this one channel. Adding
  `aiTrace` while leaving `resolution.trace` is the parallel-path anti-pattern
  and is explicitly rejected.

- **D3 — Keep the per-reviewer-cell trace (`ReviewerAITrace`), re-sourced.**
  Per user choice, retain the per-cell trace in resolve mode (the reconciler's
  at-a-glance "AI used by {name}" on a linked cell), now reading from the
  top-level `aiTrace` instead of `resolution.trace`. It stays
  `proposal_record_id`-gated (rare-but-honest). The per-field (D1) and per-cell
  (D3) traces answer different questions and open the **same** popover; they
  must be **visually differentiated** (D6).

- **D4 — Shared `FieldLabelCell`.** Extract the field-label markup (entity/
  instance eyebrow + field label + optional trace slot) into one component
  used by **both** the read-only branch (`RunReviewerComparison.tsx:285-294`)
  and `ResolveRow` (`~531-536`). Only `ConsensusResolutionPanel`-originated
  mounts fill the trace slot; the extract/assess compare mounts pass nothing,
  so those surfaces stay byte-for-byte and their 6 tests stay green. "Clean in
  code you touch" — the redesign edits that cell in both branches.

- **D5 — Honest link-primary cross-marks.** Cross-mark **existence** is a pure
  function of `decision.proposal_record_id === version.id` (a non-reject
  decision). Never value-match, never `status`. `decisionMatchesVersion` is
  quarantined to refining the **wording** of an already-linked row. The rules:

  | Condition (link to this version, non-reject) | Label |
  |---|---|
  | `accept_proposal` (checked first; `value=null` by contract) **or** value matches | **Adopted by {name}** |
  | `edit` **and** value differs from the version | **Edited by {name}** |
  | `proposal_record_id == null` (manual/legacy), even if value coincidentally equals | *render nothing* |
  | Marker/empty-degenerate **without** a link | *hard-suppress (never value-match)* |
  | `reject` (any state) | *render nothing* |
  | Linked but version outside the loaded history window (reopened runs, #514) | **Adopted by {name}**, link-only, no wording — **never** value-match a different version |

  **Guarantee:** a human-typed value carries no link by construction
  (`aiLink.ts`), so it can receive **no** mark on any version — even one it
  coincidentally equals. Value equality is structurally incapable of creating a
  mark. Over-attribution is treated as more corrosive than under-attribution on
  an adjudication surface — the model fails closed (matching the D4 precedent of
  the 2026-07-04 spec).

- **D6 — Peer Adopted/Edited fidelity.** Apply the D5 Adopted-vs-Edited split
  to **peer** marks too (today they flatten to a blanket "Adopted by", which
  overclaims a linked-then-edited peer). This requires threading each peer's
  **newest** decision `value` + `decision` kind into the version rows
  (`buildAdoptionMap` currently carries only `proposalId → label`). Use the
  latest-per-distinct-reviewer set (`useReviewerSummary`) so append-only stale
  decisions do not resurrect marks. Include the **current user's own** adoption
  in the per-field popover cross-marks (there is no pinned-row "You" chip on the
  field-level entry point).

- **D7 — "Run by {name}" in the run-group header.** Surface who **triggered**
  the extraction (`provenance.ranByName`) per run-group header in the popover —
  orthogonal to reviewer attribution, **not** a per-version cross-mark. Gated
  behind `showPeerIdentity` (`peers_revealed || canSeeOthers`) with a
  timestamp-only fallback, so peer identity never leaks in blind review
  (reuses the existing gate at `AISuggestionReviewPopover.tsx:431`).

- **D8 — Suppress the false "Selected" chip.** In per-coord / per-field mode
  the reused popover falls back to `history[0]` (newest AI version) and paints
  the green "Selected"/"Adopted" pinned-version chip on a value nobody chose —
  a lie on an audit surface. Add a read-only/provenance popover mode that
  suppresses the pinned-version chip **unless** a consensus decision genuinely
  pins a proposal.

- **D9 — Visual differentiation of the two traces (D6-of-2026-07-04 lineage,
  settled in design-review).** The per-field icon is **muted at rest**, AI
  accent (`--text-ai`) on hover/focus, always visible (not group-hover-gated)
  so the presence pattern down the column stays scannable; it trails the field
  label text only (never the 11px eyebrow). The per-cell icon keeps its AI
  accent next to the value. Exact treatment confirmed with the `design-review`
  loop, both roles, light + dark, and at narrow width (`min-w-0 truncate` must
  survive a trailing icon).

## Architecture

New leaf **`frontend/components/runs/FieldAITrace.tsx`** — service-free,
jsdom-safe (`getHistory` as a prop; reuse the `React.lazy`
`GenerationDetailsDialog` + `@/pdf-viewer/core` path; no static apiClient or
non-`/core` pdf barrel import). Props: `instanceId`, `fieldId`, `field`
(type + allowed_values), `articleId`, `getHistory`, `latestSuggestion`,
`adoptionByProposalId` (link-derived, per-version, with Adopted/Edited
wording), `showRanBy`. Restate the never-fabricate header warning in-file.

`ConsensusTraceContext` moves out of `ComparisonResolution` to a top-level
`aiTrace` prop (D2). `RunReviewerComparison` gains `FieldLabelCell` (D4) and
threads `aiTrace` to both `FieldAITrace` (row) and the retained
`ReviewerAITrace` (cell). `buildAdoptionMap` (or a successor) is extended to
carry, per proposal id, the adopting reviewers **with** their decision
value+kind so the Adopted/Edited split (D5/D6) is computed honestly, keyed on
the link and refined by `decisionMatchesVersion`.

Threading (unchanged data, relocated channel):
`ExtractionFullScreen` / `QualityAssessmentFullScreen` → `ConsensusResolutionPanel`
(`aiTrace={…}` unconditional) → `RunReviewerComparison` (`aiTrace` top-level)
→ `FieldLabelCell` → `FieldAITrace`, and → `ResolveRow` → `ReviewerAITrace`.

Copy: existing `reviewAdoptedBy` / `reviewEditedBy` / `reviewRunBy` reused for
cross-marks and header; a new endorsement-neutral field-level key for the
`FieldAITrace` icon aria-label + tooltip (e.g. "AI suggestions for this
field") — never the reviewer-scoped `traceTitle`. English, single-sourced in
`frontend/lib/copy/`.

## Scope

- **Consensus view only.** The extract/assess read-only compare (mounts a, b)
  receive **no** `aiTrace` — reviewers there have the live AI popover in their
  own `FieldInput`. This asymmetry is intentional (provenance is an
  adjudication concern); document it so a future reader does not file the
  missing icon as a bug.
- **Frontend-only, zero backend, no migration.**

## Out of scope

- **Value-match cross-marks** — rejected as fabricating provenance (see
  Verified facts). The honest home for "did reviewers converge on the AI's
  answer" is the compare-table agreement math (a claim about *values*), never a
  tag on an AI version (a claim about *endorsement*).
- **Arbitrator → Reconciler role rename** — a real ask but orthogonal to this
  cross-mark work (touches consensus **config** copy + the rule vocabulary, not
  the trace mechanics). Ships on its own small track. Internal identifiers
  (`ensure_project_arbitrator`, `canResolveConflicts`) stay.
- Deleting the read-only compare branch — it is reachable ADR-0012 code.

## Testing

- `FieldAITrace` unit: icon renders iff `aiSuggestions` has the coord; nothing
  when absent or when `aiSuggestions === null`; popover opens read-only (no
  "use this version" action); engine-free pdf-viewer imports only (jsdom-safe).
- Cross-mark unit (`valueEquality`-backed): existence keyed on link only — a
  null-link decision whose value equals a version renders **nothing**; an
  independent no-information marker renders **nothing** (hard-suppress); an
  **adopted** abstention (link) keeps "Adopted by"; `accept_proposal` →
  "Adopted by" (short-circuit); linked `edit` with differing value → "Edited
  by"; a stale link across a reopened run is link-only and never value-matches
  a new version.
- Peer split: a linked-then-edited **peer** is "Edited by", not a blanket
  "Adopted by"; the current user's own adoption appears in the per-field
  popover; latest-per-reviewer is used (no resurrected stale marks).
- `RunReviewerComparison`: `aiTrace` renders the field-row trace in **both**
  branches; extract/assess mounts (no `aiTrace`) stay byte-for-byte (6 tests
  green); reviewer cells still render the retained per-cell trace.
- `ConsensusResolutionPanel`: passes `aiTrace` even when `canResolve === false`
  (a non-arbitrator / viewer at consensus now sees the per-field trace — the
  feature's core justification).
- D8: the pinned-version "Selected" chip is suppressed unless a consensus
  decision pins a proposal.
- E2E `qa-consensus-ai-trace.e2e.ts` rewrite: assert the per-field icon opens a
  popover with an honest "Adopted by {name}" cross-mark; add coverage that a
  non-resolver at consensus sees the icon; drop obsolete per-cell-only cases.
- Gates: `npm run test:run`, then `npm run test:e2e:local`, and typecheck with
  `tsc -p tsconfig.app.json` (vitest passing ≠ typecheck).

## No-legacy commitments

- **One trace channel, not two.** `resolution.trace` is **deleted** the same
  change that adds top-level `aiTrace`; no dual channel period.
- **Shared cell, no drift.** The field-label markup is factored into
  `FieldLabelCell` for both branches — the resolver and non-resolver views show
  the same provenance affordance byte-identically.
- **No fabricated marks.** Existence rides only the append-only link; value
  equality never mints a mark; `suggestions[].status` is never read. Peer marks
  stop overclaiming.
- **Dead-reference sweep before "clean".** After the change, grep for any
  remaining `resolution.trace` references, orphaned copy keys, and dead types;
  no dangling reference left for later.

## Verification / open build items

- **Locate-in-text for non-resolvers.** `useReaderLocate` is a no-op outside a
  `ViewerProvider`. Verify live (both roles) whether the reader panel is
  mounted alongside the consensus panel for non-resolvers; if not, locate
  degrades gracefully (button hidden) — confirm that is an intentional,
  verified state, not an accident.
- **Reopened runs (#514 / ADR-0017).** `aiSuggestions` is run-scoped while
  `getHistory` is run-independent; confirm a reopened run does not leave
  `aiSuggestions === null` but history-present, hiding the icon on a coord that
  has provenance.
- **Narrow width.** The trailing icon in the dense field-label cell must not
  defeat `min-w-0 truncate` or force horizontal overflow past `overflow-x-auto`.
- **Design-review** the two-icon differentiation (D9) in both roles, light +
  dark (`--ai` token contrast), narrow width.

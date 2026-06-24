---
status: draft
last_reviewed: 2026-06-23
owner: '@raphaelfh'
---

# Consensus view fixes (extraction) — design

> **Status:** Draft · Date: 2026-06-23 · Deciders: @raphaelfh
> **Relation to existing design:** This spec does **not** introduce a new
> consensus *backend* model. It reframes the extraction consensus **surface** as
> a reconciliation worklist, aligns it with the QA surface, and closes
> multi-reviewer gaps surfaced by an adversarial review. It composes with — and
> stays out of the way of — the in-flight HITL lifecycle rework (PRs #369/#374).
> A first draft (decisions D1/D2 below, now **superseded**) collapsed every field
> into "divergent vs. the rest"; the adversarial review showed that hid two
> dangerous states, so the design was revised to **reconciliation-by-state**.

## Context — what was reported

All five points were reported against the live extraction **Consensus** stage
(`stage='consensus'`), shown in `ExtractionFullScreen`:

1. **View is stuck** — cannot scroll down, cannot open the PDF/markdown side panel.
2. There should be a way to **accept all matching/agreeing fields**; identical
   reviewer values are mislabeled as "N reviewers disagreed".
3. The **reviewer count doesn't match** — it is a hand-typed config number; it
   should reflect the actual research team and roles.
4. There is an **"edit" affordance on each reviewer card** that makes no sense.
5. **Override is unclear after the fact**: once a field is resolved (especially
   via custom value), the written value and rationale disappear and cannot be
   revised before finalize. Also, the rationale should be **optional**.

## Root causes (verified in code)

| # | Root cause | Evidence |
|---|-----------|----------|
| 1 | In consensus stage the `ConsensusPanel` is mounted in a static, non-scrolling strip above the main area, with no height bound or overflow. | `frontend/pages/ExtractionFullScreen.tsx:1177` vs QA's scrollable `min-h-0 flex-1` host at `frontend/pages/QualityAssessmentFullScreen.tsx:658` |
| 2 | Extraction uses an `evaluate-all` mode that renders **every** touched coord identically, with header copy hardcoded to "{{count}} reviewers disagreed" using `decisions.length` regardless of agreement. | `frontend/components/runs/ConsensusPanel.tsx:170`, `:349-352` |
| 3 | `requiredReviewerCount` is read from `run.hitl_config_snapshot.reviewer_count` (hand-typed, frozen, default 1); the backend does not use it as a quorum gate. | `frontend/hooks/runs/useReviewerSummary.ts:154`; `ConsensusConfigForm.tsx` |
| 4 | The per-reviewer pill is `<Badge>{d.decision}</Badge>` rendering the internal verb ("edit"). | `frontend/components/runs/ConsensusPanel.tsx:214` |
| 5 | When `isResolved`, the row hides the editor + buttons and never renders the published value/rationale. | `frontend/components/runs/ConsensusPanel.tsx:183-192`, `:223`, `:240` |

## Invariants confirmed before deciding

- **Hiding agreed coords loses nothing on publish.** `approve_and_finalize`
  atomically publishes every agreed-but-unpublished coord, then advances to
  `finalized`; coords with ≥2 distinct reviewer values block finalize
  (`backend/app/services/run_lifecycle_service.py:256`, `_agreed_unpublished_values`
  at `:306`). A solo reviewer's single value counts as agreed.
- **Re-resolution already works end-to-end.** `record_consensus` is append-only
  with no "already resolved" guard; `_publish_internal` does
  INSERT-or-(optimistic-lock)-UPDATE
  (`backend/app/services/extraction_consensus_service.py:48-144`).
- **Rationale is enforced twice** for `manual_override`: DB CHECK
  `manual_override_complete` (`extraction_workflow.py:362`) **and** the service
  guard (`extraction_consensus_service.py:79-80`).
- **Divergence needs ≥2 reviewers** (`useReviewerSummary.ts:148`); a solo
  reviewer is structurally non-divergent.
- **Agreement comparison drops `unit`** on both sides: `_unwrap_value`
  (`run_lifecycle_service.py:107`) and the FE `unwrap` (`useReviewerSummary.ts:92`)
  peel `{value, unit}` to the bare value; the autosave writes `{value, unit}`
  (`useAutoSaveProposals.ts:213`). Confirmed.

## Adversarial review — multi-reviewer findings (verified)

An independent adversarial pass + author verification produced these. The verdict
that drove the redesign: the first-draft "divergent-only + agreed summary" was
**not adequate for 2+ reviewers** — it hid two dangerous states.

| F | Finding (verified) | Severity | Pre-existing / Introduced | Addressed by |
|---|---|---|---|---|
| F2 | **Premature finalize.** With "participants only" and no expected count, a manager can open consensus with 1 of N submitted and publish a single reviewer's values; the "waiting" signal is gone (ready hint is `stage==='extract'`-only, `ExtractionFullScreen.tsx:1114`). | high | gate gap old; signal loss was the draft's | D2′ + soft-warn finalize |
| F5 | **Unit conflict reads as agreement.** `5 mg` vs `5 g` compare equal (unit dropped), publishing one unit silently; D1 hid the value. | high | compare bug old; hiding was the draft's | D6 (full-envelope compare, FE+BE+test) |
| F3 | **Single-filler buried.** A coord filled by only 1 of N reviewers is auto-published as "agreed" and hidden in a count — defeats double extraction. | medium | publish old; burial was the draft's | "Needs attention" section |
| F4 | **Required-gap dead-end.** A required field nobody filled blocks finalize, but the divergent-only panel offered no route (form hidden in consensus, no backward transition). | medium | pre-existing, unfixed | "Needs attention" section w/ override editor |
| F1 | **FE/BE verdict drift.** Canonicalization differs (`JSON.stringify` unsorted vs `json.dumps(sort_keys)`) and the FE doesn't resolve `accept_proposal` through its proposal. **Verified the *deadlock* direction is latent**, not active: sorting only makes the BE agree *more* (FE-agreed ⟹ BE-agreed), and the current `ExtractionFullScreen` accept path uses `acceptStrategy:'human-proposal'` (writes `edit` with a value), so `accept_proposal`-with-null is not produced here. | latent | asymmetry old | mitigated: every coord has a resolve path; (optional) approve-finalize returns blocking coords |
| F6 | **No blind leak found.** A blind non-arbitrator gets only their own decisions (`extraction_run_read_service.py:144-150`), so `divergentCoords` is empty and `reviewers.length` reads 1 for them. | minor (none) | n/a | 5a renders "from {reviewer}" only when `peers_revealed` |
| F7 | **Re-resolution map must use newest-wins.** Current map is iteration-order-wins (`ConsensusPanel.tsx:341-347`); concurrent arbitration can skew display vs published value. | minor | append old; rate worsened by 5a | `max(created_at)` per coord (required, not optional) |

## Model — five reconciliation states

The consensus stage is a **reconciliation** of N independent (often blind)
extractions. Every (instance, field) coord lands in exactly one state:

1. **Conflict** — ≥2 reviewers, materially different values. → resolve. *Blocks finalize.*
2. **Agreement** — every reviewer who filled it gave the same value. → auto-accept on finalize.
3. **Single-filler** — ≥2 reviewers participated overall, but only one filled
   this coord (others empty/untouched). → verify. *Soft (warns, doesn't block).*
4. **Required gap** — a required field no reviewer filled. → fill via override. *Blocks finalize.*
5. **Optional empty** — non-required, unfilled. → ignore.

Plus two process signals: **readiness** (how many expected reviewers submitted)
and **completeness** (required filled).

## Decisions (approved 2026-06-23; supersedes the first-draft D1/D2)

- **D1′ — Reconciliation worklist, sections by state.** The consensus screen
  renders, top-to-bottom by attention: **Conflicts** → **Needs attention**
  (single-filler + required gaps, each with a resolve/override control) →
  **Agreements** (collapsed, count only, expandable read-only, **no** bulk
  button — auto-accepted on finalize). Optional-empty coords are not shown.
- **D2′ — Count = participants, expected = roles.** Numerator = reviewers who
  submitted (`summary.reviewers.length`); denominator = project members with role
  `reviewer` or `manager` (dynamic; replaces the hand-typed config field). Shown
  as "N of M reviewers" with readiness chips and a per-state breakdown. This
  realizes the original #3 ("dynamic by roles").
- **D3′ — Finalize: single header action, soft gate.** Blocks on unresolved
  **conflicts** or **required gaps**. **Warns (confirm dialog, does not block)**
  when participants < expected or any single-filler coords remain. No hard
  quorum gate (backend has none; one user can still finalize). The "Reviewers per
  article" config field is removed.
- **D4 — Remove the `<Badge>{d.decision}</Badge>`** entirely (reject is already
  conveyed by destructive styling + "(rejected)" text).
- **D5a — Resolution stays visible and editable.** After resolving, show the
  published value + provenance ("from {reviewer}" only when `peers_revealed`, else
  "custom value") + rationale (if any) + a "Change" button. `resolvedByCoord`
  picks the **newest** decision per coord (`max(created_at)`). No backend change.
- **D5b — Optional rationale.** Relax the DB CHECK + service guard so
  `manual_override` needs only `value`. Migration.
- **D6 — Agreement compared on the full envelope.** `decisionsAgree` (FE) and
  `_agreed_unpublished_values` (BE) compare the whole stored value
  (`json.dumps(value, sort_keys=True)` / canonicalized `JSON.stringify`), **not**
  the unit-stripped `unwrap`, so a unit/structured difference counts as a conflict.
  Backed by an integration test.
- **D7 — AI stays an extraction assistant**, not a virtual reviewer (out of scope).

## Design

### A. Layout — ConsensusPanel becomes the scrollable left panel · `frontend`
During `stage='consensus'`, render `ConsensusPanel` as the content of the left
resizable panel (scroll host `min-h-0 flex-1`), PDF/markdown panel beside it
(toggle unchanged) — mirroring QA. The form panel is not shown during consensus
(editing is already disabled). Remove the strip at `ExtractionFullScreen.tsx:1177-1195`.

### B. Reconciliation sections · `frontend`
Compute each coord's state from `summary.decisionsByCoord`, `summary.reviewers`,
the template (`entityTypes`/`instances` → all required coords), and
`published_states`. Classify in **strict precedence order** so a coord lands in
exactly one bucket:
1. **Conflict** — in `summary.divergentCoords` (≥2 reviewers, materially
   different, incl. one `reject` vs another's value). *Blocks finalize.*
2. **Required gap** — a required template coord with **no** decision and **no**
   published state. *Blocks finalize.*
3. **Single-filler** — not a conflict, `reviewers.length ≥ 2`, and the coord has
   decisions from **fewer than all participants**
   (`decisionsByCoord[coord].length < reviewers.length`). *Soft (warns only).*
4. **Agreement** — touched, non-conflict, all participants present and equal.
5. **Optional empty** — not required, no decision. Not rendered.

The **Needs attention** section holds states 2 + 3 (required gaps flagged as
blocking, single-filler as a soft warning). Render sections with counts;
Conflicts and Needs-attention rows carry select/override controls (required gaps
get the override editor since no reviewer value exists); the Agreements block is
collapsed with an expandable read-only list (`fieldLabelByCoord`), no buttons.
Remove the `evaluate-all` branch.

### C. Count + readiness + soft finalize · `frontend`
- Header reviewers slot: "N of M reviewers" (M from `useProjectMembers` filtered
  to role `reviewer`/`manager`) + a per-state breakdown ("5 conflicts · 3 single
  · 2 gaps · 40 agreed"). Stop driving text from `requiredReviewerCount`/`completionRatio`.
- Remove the "Reviewers per article" input from `ConsensusConfigForm.tsx`; keep
  `consensus_rule`, arbitrator, manager-visibility. Keep the `reviewer_count`
  column (lifecycle-owned).
- `handleApproveFinalize` shows a **confirm dialog** when `participants < expected`
  or single-filler coords remain, listing what's unverified; proceeds on confirm.
  (The hard backend gates — conflicts, required — still error if hit.)
- *Limitation:* without per-article assignment, "expected" counts the whole
  reviewer-role roster, so the warning can over-fire on articles only one person
  was meant to do. Soft-warn (not block) makes that a one-click confirm.
  Per-article assignment is the future precise fix.

### D. Remove decision badge · `frontend`
Delete the `<Badge>{d.decision}</Badge>`. No replacement.

### E. Resolution visible + editable · `frontend`
Resolved rows show published value + provenance (guarded by `peers_revealed`) +
rationale + "Change" (reopens controls pre-filled). `resolvedByCoord` = newest
decision per coord by `created_at`. No backend change.

### F. Optional rationale · `backend (migration)` + `frontend`
- Migration relaxes CHECK `manual_override_complete` to require only `value`
  (≤32-char revision id; update migration-head + `last_reviewed` in
  `docs/reference/extraction-hitl-architecture.md`).
- Relax the service guard (`extraction_consensus_service.py:79-80`).
- FE: drop the empty-rationale disable; copy "(required)" → "(optional)".

### G. Full-envelope agreement compare · `backend` + `frontend`
- BE: in `_agreed_unpublished_values`, key on `json.dumps(resolved, sort_keys=True,
  default=str)` (the full envelope) instead of `_unwrap_value(resolved)`.
- FE: `decisionsAgree` compares the full value (canonicalized) rather than `unwrap`.
- Integration test (real Postgres): two reviewers `5 mg` vs `5 g` ⇒ the coord is a
  conflict (not auto-published).

## Out of scope (recorded)
AI as a virtual reviewer; per-article reviewer assignment; removing
`reviewer_count`/`consensus_rule`/arbitrator from the schema (lifecycle-owned);
a hard quorum gate; backend `approve_and_finalize` returning the specific
blocking coords (a defensive nice-to-have — the FE already surfaces every state).

## Phasing
- **Phase A — frontend only, no migration:** A, B, C, D, E. Unblocks the view and
  makes the surface multi-reviewer-adequate. **✅ Implemented 2026-06-24**
  (commits `68cb0778..8a65cd6f`; 856 tests green, lint clean, whole-branch review
  "ready to merge", design-review passed at 1280/560).
- **Phase B — backend + frontend:** F (optional rationale migration) and G
  (full-envelope compare + test).

## Verification
- **TDD** for state classification (conflict / single-filler / required-gap /
  agreement), participant+expected counts, newest-decision-per-coord, soft-warn
  triggers, resolved-state rendering.
- **Component tests** in `frontend/test/ConsensusPanel.test.tsx` (state sections,
  resolved rendering, badge removal, agreed-collapse).
- **Backend (Phase B):** integration tests — `manual_override` without rationale
  is accepted post-migration; `5 mg` vs `5 g` is a conflict (CHECK + agreement
  logic are invisible to mocks → real Postgres).
- **`/design-review`** on the consensus screen at 1280/900/700/560 — scroll, PDF
  toggle, the three sections, resolved/summary states.
- Manual: Vitest + local dev against a 2-reviewer run with a planted conflict,
  single-filler, required-gap, and a unit difference.

## File-touch map
**Phase A (frontend):**
- `frontend/pages/ExtractionFullScreen.tsx` — ConsensusPanel into the left panel;
  remove the strip; participant+expected props; soft-warn confirm in `handleApproveFinalize`.
- `frontend/components/runs/ConsensusPanel.tsx` — reconciliation sections; remove
  evaluate-all; remove decision badge; resolved-state + Change; newest-per-coord.
- `frontend/hooks/runs/useReviewerSummary.ts` — single-filler + required-gap
  derivation helpers (or a new `useReconciliation` hook); full-envelope `decisionsAgree`.
- `frontend/components/project/settings/ConsensusConfigForm.tsx` — remove
  "Reviewers per article".
- `frontend/lib/copy/consensus.ts` — section titles, breakdown, readiness,
  resolved-state, soft-warn copy.
- `frontend/test/ConsensusPanel.test.tsx` + new hook tests.

**Phase B (backend + frontend):**
- `backend/alembic/versions/*` — relax CHECK `manual_override_complete`.
- `backend/app/services/extraction_consensus_service.py` — relax rationale guard.
- `backend/app/services/run_lifecycle_service.py` — full-envelope agreement key.
- `backend/tests/integration/*` — optional-rationale + unit-conflict tests.
- `docs/reference/extraction-hitl-architecture.md` — migration-head + last_reviewed.
- `frontend/components/runs/ConsensusPanel.tsx` + `frontend/lib/copy/consensus.ts`
  + `frontend/hooks/runs/useReviewerSummary.ts` — optional rationale + full-envelope compare.

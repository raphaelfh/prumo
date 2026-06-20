---
status: accepted
last_reviewed: 2026-06-18
owner: '@raphaelfh'
---

# REVIEW stage as the multi-reviewer data-extraction surface

> **Status:** Accepted · Date: 2026-06-18 · Deciders: @raphaelfh
> **Supersedes:** N/A · **Superseded by:** N/A

## Context and Problem Statement

When data extraction and quality assessment were unified onto one HITL stack
(ADR 0003), the shared `HITLSessionService` parks every new run in `PROPOSAL`
— the stage where the AI and the proposer write `human`/`ai`
`ProposalRecord`s. That is correct for QA (a single user fills then publishes),
but data extraction is multi-reviewer: the surfaces that make it work —
per-reviewer `ReviewerDecision`s, the "X/N reviewers" counter, and the
"0% until you accept" progress metric — only have meaning from `REVIEW`
onward, because reviewer decisions do not exist in `PROPOSAL`.

Nothing advanced extraction runs past `PROPOSAL`: the per-section AI path
deliberately stays in `PROPOSAL`, and the explicit "Submit for review" button
was rarely used. In production every run sat in `PROPOSAL` indefinitely, which
made the reviewer-centric UI misreport: the AI proposals are shared and
pre-filled the form for every reviewer, so progress showed a non-zero
percentage to a reviewer who had accepted nothing; the reviewer counter read
"0/N" while people were actively filling the form; and accepting an AI
suggestion never reached a durable state because its status is derived from the
(empty) reviewer-state pointer. This is the same status-drift / blind-review
incident class the single-read-path work targets (ADR 0007).

## Decision Drivers

- Multi-reviewer correctness: each reviewer's values must be their own
  decisions, and the counter/progress must reflect real per-user state.
- AI extraction is a `PROPOSAL`-only operation: `ExtractionProposalService`
  only accepts `source='ai'` proposals while the run is in `PROPOSAL`.
- Batch (section-by-section) AI extraction issues one request per section
  against the same run, each requiring `PROPOSAL`.
- Preserve the blind-review contract (reviewers do not see each other's
  in-flight human values).

## Considered Options

- Option A — Keep the `PROPOSAL`-fill model and patch the UI (hide the reviewer
  counter in `PROPOSAL`, derive accept-status from the user's own human
  proposals, compute progress from own values only).
- Option B — Auto-advance `PROPOSAL → REVIEW` in the backend, inside the AI
  section-extraction service after it records proposals.
- Option C — Auto-advance `PROPOSAL → REVIEW` orchestrated by the frontend,
  once the run has proposals or the reviewer makes a first edit.

## Decision Outcome

Chosen option: **Option C (frontend-orchestrated advance)** because AI section
extraction is called once per section on the same run and hard-requires
`PROPOSAL`; advancing inside the backend service (Option B) would push the run
to `REVIEW` after the first section and make every subsequent section in the
same batch fail its stage check. Option A leaves a confusing two-phase
"fill then submit" flow and duplicates, in the UI, state the `REVIEW` read path
already resolves correctly.

`PROPOSAL` becomes a transient seeding stage; `REVIEW` is the collaborative
extraction surface. A small `useAutoAdvanceToReview` hook advances the run the
moment it has content worth reviewing (AI seeded proposals, or the reviewer
typed). The existing `advance_stage` transition already materializes each
user's `human` proposals into their own `accept_proposal` decisions and leaves
AI proposals as suggestions to accept, so values survive the transition and the
blind-review contract is preserved. Reviewers extract independently in `REVIEW`
and reconcile at `CONSENSUS`; `reviewer_count` (resolved into the run's frozen
`hitl_config_snapshot`) drives when consensus is required.

### Consequences

- Good — the reviewer counter, per-user progress, and durable accept all become
  correct without changing the backend write path; a fresh reviewer sees 0%
  and AI suggestions to accept, not a phantom percentage.
- Good — runs already stuck in `PROPOSAL` self-heal: they advance the moment a
  reviewer next opens them.
- Bad — a lifecycle transition is now orchestrated client-side; two reviewers
  opening the same article within the same instant can race, and the reviewer
  who loses the transition sees a benign "advance failed" toast (the backend is
  authoritative and the run still ends in `REVIEW`).
- Neutral — `PROPOSAL` is now near-invisible to users; "Submit for review"
  remains only as the explicit affordance for a run that has no content yet.

## Validation

`useAutoAdvanceToReview` is unit-tested (fires once per `PROPOSAL → REVIEW`
transition, never outside `PROPOSAL`, re-arms on stage-leave/failure). The
reviewer-counter gate and the AI-disable-in-`REVIEW` behaviour are covered by
component tests. Confirmed manually with two reviewers on one article: AI run
advances to `REVIEW`, the second reviewer opens at 0% with suggestions to
accept, accepts stick, and the counter advances as each reviewer decides.

## Pros and Cons of the Options

### Option A — patch the PROPOSAL-fill UI

- Good — no lifecycle change; smallest backend surface.
- Bad — keeps the confusing two-phase flow and re-implements, in the UI, the
  per-user resolution the `REVIEW` read path already does.

### Option B — backend advance after AI

- Good — atomic with the AI write.
- Bad — breaks batch extraction: the second section's request hits a `REVIEW`
  run and fails the `PROPOSAL`-required check.

### Option C — frontend-orchestrated advance

- Good — path-agnostic across every AI/edit entry point; idempotent; self-heals
  stuck runs.
- Bad — a stage transition lives in the client; rare cross-client races produce
  a benign loser toast.

## More Information

- Canonical schema + flow: `docs/reference/extraction-hitl-architecture.md`.
- Implementation plan: `docs/superpowers/plans/archive/2026-06-20-governance-sweep/2026-06-18-extraction-review-stage-restore.md` (shipped; archived).
- The `PROPOSAL`-only constraint: `app/services/extraction_proposal_service.py`
  and `app/services/section_extraction_service.py`.
- Related: ADR 0003 (kind discriminator), ADR 0007 (single API read path),
  ADR 0009 (finalize completeness gate).

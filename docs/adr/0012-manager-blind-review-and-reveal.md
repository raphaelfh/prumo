---
status: accepted
last_reviewed: 2026-06-19
owner: '@raphaelfh'
---

# Manager blind-review by default, with a per-kind reveal toggle

> **Status:** Accepted · Date: 2026-06-19 · Deciders: @raphaelfh
> **Supersedes:** N/A · **Superseded by:** N/A

## Context and Problem Statement

After the blind-leak fix (ADR 0007 single read path; migration `0025`
reviewer-scoped SELECT), reviewers can no longer see each other's in-flight
values: both the RLS layer and the `extraction_run_read_service` API filter
self-scope reviewer-attributable rows. But a project **manager** (and the
`consensus` arbitrator) was always exempt — `is_project_arbitrator` lets a
manager read every reviewer's decisions so they can reconcile at consensus.

That exemption defeats blind review *for the manager*. A manager who also acts
as a reviewer (the common small-team case) sees the other reviewers' answers
while forming their own, which is exactly the bias blind review exists to
prevent. There was no way to ask a manager to review blind and only reveal the
other answers deliberately, at reconciliation time.

Two further constraints shaped the problem:

- The product runs **two kinds** on the same stack (`extraction` and
  `quality_assessment`, ADR 0003). A team may want managers blind for one and
  not the other — the policy must be **per-kind**, not global.
- The old comparison surface was a frontend dual-read: a bespoke
  `loadValuesForOthers` that read `extraction_reviewer_states` directly via
  PostgREST, plus a parallel set of compare components per screen. That is the
  same dual-read posture the single-read-path work is retiring, and it
  duplicated the comparison UI across extraction and QA.

## Decision Drivers

- Blind-review integrity must extend to managers, not just reviewers.
- The reveal must be **deliberate and reversible** — a manager chooses to see
  peers, and can go back to blind — not a permanent property frozen per run.
- Per-kind independence: `extraction` and `quality_assessment` carry separate
  manager-visibility settings.
- One comparison surface for both kinds (no per-screen fork); no legacy
  dual-read left behind (KISS / no-legacy).
- Do not weaken the reviewer↔reviewer blind contract that RLS `0025` and the
  API filter already enforce in lockstep.

## Considered Options

- **Option A — Single project-level boolean** (`managers_see_reviewers`)
  covering both kinds at once.
- **Option B — Per-kind project-level setting**
  (`settings.managers_see_reviewers = {extraction, quality_assessment}`), read
  **live** at request time, enforced in the API read service; RLS unchanged.
- **Option C — Per-run snapshot** of the visibility choice into
  `hitl_config_snapshot`, frozen at run creation.

## Decision Outcome

Chosen option: **Option B (per-kind, live-read, API-enforced; RLS unchanged)**.

- **Storage.** `projects.settings.managers_see_reviewers` is a JSON object
  `{ "extraction": bool, "quality_assessment": bool }`, both defaulting to
  `false` (managers blind by default). A focused typed endpoint
  (`PUT …/manager-review-visibility`, manager-only) sets exactly one kind and
  preserves the other (the JSONB-reassign gotcha — SQLAlchemy does not track
  in-place dict mutation — is handled by reassigning a merged dict).
- **Enforcement (API, live).** `extraction_run_read_service.caller_can_see_peers(
  project_id, user_id, kind)` returns `true` for the `consensus` arbitrator
  always; for a `manager`, it returns the **live**
  `settings.managers_see_reviewers[kind]`; for everyone else, `false`. A
  `finalized` run is unblinded for all (published state is public within the
  project). The value is read per request, so a manager toggling reveal sees
  peers immediately — no run re-creation.
- **Deliberate API-stricter-than-RLS split.** RLS `0025` is left **unchanged**:
  at the database layer a manager remains an arbitrator and *may* SELECT peer
  rows. The API read path is deliberately **stricter** — when the toggle is
  off it withholds peer values from the manager even though RLS would allow
  them. This is sound because the manager is genuinely *authorized* to see
  (they can flip the toggle); manager blindness is a bias-control UX policy,
  not a security boundary. The hard security boundary — reviewers cannot read
  peers — stays enforced identically at **both** layers, so the
  "two read paths encode the identical predicate" rule (§3 of the architecture
  doc) still holds for the case that matters.
- **One shared compare surface.** Both screens render a single
  `RunReviewerComparison`, fed by the already-server-blinded
  `reviewerSummary.decisionsByCoord` (derived from `/runs/{id}/view`). When the
  caller is blind there simply are no peer columns — no separate fetch, no
  direct Supabase read. The frontend permission gate
  (`useComparisonPermissions(projectId, userId, kind)`) and the server filter
  agree by construction: the toggle is offered only when
  `canSeeOthers && decisionsByCoord.size > 0`, and `decisionsByCoord` is
  non-empty only when the server already unblinded the caller.

### Consequences

- Good — managers review blind by default and reveal peers deliberately, per
  kind, with one click; the reveal is live and reversible.
- Good — the bespoke dual-read (`loadValuesForOthers`) and both per-screen
  compare implementations are deleted; one `RunReviewerComparison` serves
  extraction and QA (net ≈ −3000 lines of legacy compare code).
- Good — the setting is per-kind, so a project can run managers-blind on
  extraction while leaving QA open (or vice versa).
- Bad — the API read path is now intentionally stricter than RLS for the
  manager case, so a manager poking the PostgREST/devtools path directly could
  still read peer rows the app UI hides. Acceptable: the manager is authorized
  to reveal anyway; this is not a confidentiality boundary.
- Neutral — visibility is not captured per run, so a historical run reflects
  the *current* setting, not the setting in force when it ran. This matches the
  "reveal is a live view, not a recorded decision" intent.

## Validation

- Backend: `caller_can_see_peers` unit-tested across roles (consensus → see;
  manager + setting on/off → see/blind; reviewer/viewer → blind) and the
  per-kind endpoint covered (sets one kind, preserves the other; manager-only).
  The QA session open now embeds `run_view` so QA shares the read path.
- Frontend: per-kind permission resolution tested
  (`comparison-permissions`); `RunReviewerComparison` render tests (peer
  columns, reject cell, blind empty-state); extraction + QA pages tested for
  the toggle gate (blind → no toggle; manager-with-reveal → toggle appears and
  the shared comparison renders peers from `decisionsByCoord`); the QA
  configuration toggle mount (disabled for non-managers, seeds the persisted
  value).
- Full frontend suite green post-change (532 tests); typecheck, eslint, and the
  react-query key fitness check clean.

## More Information

- Canonical schema + the read-path/RLS split: `docs/reference/extraction-hitl-architecture.md` (§3 RLS, §5 QA reuse boundary).
- Design spec: `docs/superpowers/specs/2026-06-18-manager-blind-review-design.md`.
- Implementation plan: `docs/superpowers/plans/2026-06-19-manager-blind-review.md`.
- Related: ADR 0003 (kind discriminator), ADR 0007 (single API read path), ADR 0008 (typed response payloads), ADR 0010 (REVIEW stage for collaboration).

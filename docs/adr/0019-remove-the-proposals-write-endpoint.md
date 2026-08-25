---
status: accepted
last_reviewed: 2026-08-24
owner: '@raphaelfh'
adr_number: '0019'
---

# Remove `POST /runs/{id}/proposals`: proposal writes are in-process only

> **Status:** Accepted · Date: 2026-08-24 · Deciders: @raphaelfh
> **Amends:** 0014 (which still describes the endpoint as live) · **Superseded by:** N/A

## Context and Problem Statement

`POST /api/v1/runs/{run_id}/proposals` accepted a `source` constrained to
`^(ai|human|system)$`. Over three separate changes, every one of those values
became forbidden at the API boundary:

- **`human`** — rejected in `ExtractionProposalService.record_proposal` since
  the ADR-0014 stage collapse. A reviewer's value must land as a per-user
  `ReviewerDecision` via `/decisions`, or the blind-review contract breaks
  (`loadValuesForUser` filters by `reviewer_id`; a shared human proposal is
  visible to peers).
- **`system`** — rejected at the endpoint. These are reopen-seeding rows
  (`run_lifecycle_service`), and for QA runs they hydrate into *every*
  caller's form baseline through `current_values` Layer-1, so an
  authenticated member must not be able to plant them.
- **`ai`** — rejected at the endpoint as of the security fix that preceded
  this ADR. Blind peers read AI proposals unattributed
  (`extraction_run_read_service`), so a caller-authored `ai` row is a forged
  model suggestion — `confidence_score` and `rationale` included — that a
  reviewer cannot distinguish from real pipeline output.

The endpoint therefore had no reachable success path. It could only ever
return `400`.

That left a question the security fix deliberately did not answer: keep it as
an explicit rejecting stub, or remove it? The stub was chosen at the time so
existing clients would fail visibly rather than on a `404`, and that was
recorded as a scope decision rather than a verdict.

## Decision

**Remove the route and its request schema.** Proposal rows are written
in-process, by the code that owns them, and have no HTTP surface.

The deciding argument is the generated contract, not the runtime behaviour.
`frontend/types/api/schema.d.ts` is generated from the FastAPI app and is the
repo's own client surface. While the route existed it advertised an operation
typed to return `201` with a `ProposalRecordResponse` — a `201` it could never
return. A typed client that a developer can call, that type-checks, and that
always fails at runtime is a worse artifact than an absent one: it invites the
call and defers the failure. Removing the route makes the published contract
honest, which matters more here than preserving a diagnostic `400` for a
caller that does not exist.

Supporting facts, each verified rather than assumed:

- **No production caller.** The frontend's sole run write path is
  `extractionRunService.ts` → `POST /runs/{id}/decisions`. Every remaining
  `/proposals` reference in `frontend/` is a comment or an E2E assertion, and
  a unit test already pins that `useAutoSaveProposals` never posts there.
- **No published API reference.** `docs/reference/` documents the schema and
  architecture, not an external HTTP contract; there is no third-party
  consumer to break.
- **The real writers are internal.** `SectionExtractionService` calls
  `record_proposal` in-process for `ai`; `run_lifecycle_service` inserts
  `system` rows directly.

### What deliberately stays

- **`ProposalRecordResponse`** — still the read model for the `proposals[]`
  list in run detail (`extraction_run_read_service`). Only
  `CreateProposalRequest` was removed with the route.
- **The `human` rejection inside `record_proposal`** — its `else` branch is
  now unreachable from production callers, but it is exhaustiveness over the
  source domain and a service-level invariant with direct tests, not dead
  code. A future caller passing `human` must still be refused loudly.
- **`ExtractionProposalService`'s stage and coordinate-coherence guards** —
  these were already unreachable through HTTP once the source guards landed;
  their assertions live on the service, which is where the pipeline reaches
  them.

## Consequences

**Good.** The OpenAPI contract no longer advertises an impossible operation.
The endpoint's membership gate, reviewer-role gate, error translation, request
schema, and their tests are gone — roughly 250 lines of generated contract and
a comparable amount of hand-written surface that could never execute. The
"which sources may a client write?" question disappears with the route rather
than needing a guard, a comment, and a test to keep answering it.

**Bad.** A client still calling the route gets `404` instead of a `400` naming
`/decisions`. This is the cost the stub was protecting against; it is accepted
because no such client is known to exist, and because `git log` plus this ADR
carry the explanation better than a runtime string. Anyone who hits it is
doing something the system forbade anyway.

**Neutral.** ADR-0014 still reads "The `/proposals` endpoint **rejects** human
writes" and "AI/system proposals are still written in `extract`". Both were
true when written; ADRs are historical records and are not rewritten. This ADR
amends that reading: AI and system proposals are still written in `extract`,
but never over HTTP.

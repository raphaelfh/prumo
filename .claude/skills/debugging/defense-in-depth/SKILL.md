---
name: defense-in-depth
description: After finding a root cause, validate at every layer the data passes through so the bug becomes structurally impossible. Use when designing or reviewing prumo validation, especially for auth/RLS, BOLA, multi-tenant invariants, and SQLAlchemy ↔ Pydantic drift.
---

# Defense-in-Depth Validation (prumo)

## Overview

Fixing a bug at a single layer feels sufficient. It isn't. A check inside one service is bypassed by a new endpoint, a refactor, a Celery task, a SQL admin script, or a test mock. The next bug of the same class will land in a place your single check doesn't guard.

**Core principle:** validate the *invariant* at every layer the data crosses. Make the bug impossible to express, not merely caught.

Single validation = "we fixed this bug".
Multiple layers = "we made this class of bug impossible".

## Why multiple layers — prumo edition

Different layers catch different cases:

- **Pydantic v2 request schema** catches obviously malformed input fast, before any DB hit.
- **Service-layer invariant** catches semantically wrong input (e.g. advancing a finalised run).
- **SQLAlchemy + Postgres constraints** catch concurrent writers and admin scripts that skip the service.
- **RLS** catches cross-tenant access regardless of which endpoint/service forgot.
- **Frontend Zod** catches drift on display and gives the user a useful error before the round-trip.

Each layer assumes the others might fail. That's the point.

## The five layers on prumo

### Layer 1 — Pydantic request schema

Reject obviously invalid input at the API boundary.

```python
# backend/app/schemas/extraction_run.py
from pydantic import BaseModel, UUID4, model_validator
from typing import Literal

class AdvanceRunRequest(BaseModel):
    target_stage: Literal["PROPOSAL", "REVIEW", "PUBLISHED", "FINALISED"]
    row_version: int  # optimistic concurrency token

    @model_validator(mode="after")
    def stages_are_forward_only(self) -> "AdvanceRunRequest":
        # cheap sanity; full ordering is checked in the service
        return self
```

Why: turns "string `null`" into a 422 before it touches a service. Frees the service to focus on business invariants, not parsing.

### Layer 2 — Service-layer business invariant

Ensure the request makes sense for the current state of the world.

```python
# backend/app/services/run_lifecycle_service.py
async def advance_stage(
    *, run_id: UUID, target_stage: RunStage, row_version: int,
    actor: User, session: AsyncSession,
) -> Run:
    run = await session.execute(
        select(Run).where(Run.id == run_id).with_for_update()
    )
    run = run.scalar_one()

    if run.row_version != row_version:
        raise ConcurrentUpdateError(run_id=run_id)

    if not _is_forward_transition(run.stage, target_stage):
        raise InvalidStageTransitionError(current=run.stage, target=target_stage)

    if not await _actor_is_project_reviewer(actor, run.project_id, session):
        # belt-and-braces; RLS also enforces this
        raise NotAProjectReviewerError(project_id=run.project_id, user_id=actor.id)

    run.stage = target_stage
    run.row_version += 1
    return run
```

Why: this is where the *business rule* lives. A request with `target_stage=FINALISED` from `PROPOSAL` is well-formed (Pydantic accepted it) but illegal here.

### Layer 3 — SQLAlchemy / Postgres constraints

Make the impossible state literally unrepresentable, regardless of who is writing.

- `CHECK` constraints on stage enums.
- `UNIQUE` constraints on `(run_id, decision_id)` to prevent duplicate published states.
- Composite FK `(run_id, current_decision_id)` so a `extraction_reviewer_states` row can never point at a decision in a different run (this is exactly what migration 0005 does).
- `ON DELETE` policy on every FK — cascading where the parent owns the child, restricting where it doesn't. Missing `ON DELETE` is one of the most common drift bugs.
- Deferred triggers for cross-row invariants (e.g. migration 0004's "a project template must have an active version" trigger).

Why: a Celery task, an admin SQL session, or a future refactor can't sneak past these.

### Layer 4 — Row-Level Security (RLS)

For every multi-tenant table, RLS is the *last* and *most authoritative* boundary. The endpoint or service may forget to check membership; RLS won't.

```sql
-- supabase/migrations/...
create policy "reviewers can write workflow rows"
on extraction_reviewer_decisions
for all
to authenticated
using (
  is_project_reviewer(auth.uid(), (
    select project_id from extraction_runs where id = extraction_reviewer_decisions.run_id
  ))
)
with check (
  is_project_reviewer(auth.uid(), (
    select project_id from extraction_runs where id = extraction_reviewer_decisions.run_id
  ))
);
```

Why: BOLA bugs on prumo are the highest-impact class. Endpoints will be added in a hurry; service helpers will be forgotten. RLS is the only layer that *cannot* be bypassed by a careless route.

See `docs/reference/extraction-hitl-architecture.md` for the canonical `is_project_reviewer` SECURITY DEFINER helper (introduced in migration 0018).

### Layer 5 — Frontend Zod on display

Don't trust the API response shape blindly. The backend has bugs too.

```ts
// frontend/services/extractionValueService.ts
import { z } from 'zod';

const publishedValueSchema = z.object({
  run_id: z.string().uuid(),
  field_id: z.string().uuid(),
  value: z.unknown(),
  published_at: z.string().datetime(),
});

export async function getPublishedValue(runId: string, fieldId: string) {
  const data = await apiClient.get(`/runs/${runId}/values/${fieldId}`);
  return publishedValueSchema.parse(data); // throws on drift
}
```

Why: catches SQLAlchemy ↔ Pydantic ↔ Zod drift loudly, in development, with a stack trace that says exactly which field disagreed. Far cheaper than chasing the rendered `undefined` six components downstream.

## Applying the pattern

When you've found and fixed a root cause:

1. **Map the data flow.** Where does this value originate? What layers does it cross before it hurts?
2. **For each layer, ask: would this layer have caught this bug?** If no, add the cheapest possible check that *would* have caught it.
3. **Don't duplicate; specialise.** Pydantic does shape, service does business rules, DB does invariants, RLS does authorisation, Zod does drift. Putting "is user a reviewer?" in all five is fine if each layer enforces it in its own vocabulary.
4. **Verify each layer in isolation.** Write a test that bypasses Pydantic (e.g. call the service directly) and confirm the service still rejects. Bypass the service (raw SQL) and confirm the DB constraint rejects. Bypass the endpoint (different user's JWT) and confirm RLS rejects.

## Worked example — BOLA on `POST /api/v1/runs/{run_id}/advance`

**Bug.** A project member could advance a run in a project they had read-only access to. The endpoint checked "is the user authenticated"; nothing checked "is the user a reviewer on *this* run's project".

**Five layers added:**

- **Layer 1 (Pydantic).** Body schema rejects unknown stages — no change needed here; the bug isn't in shape.
- **Layer 2 (service).** `run_lifecycle_service.advance_stage` now requires `actor: User` and calls `await _actor_is_project_reviewer(actor, run.project_id, session)`; raises `NotAProjectReviewerError(403)` otherwise.
- **Layer 3 (DB).** Composite FK on `extraction_reviewer_states.(run_id, current_decision_id)` — added in migration 0005 — prevents a reviewer's state from pointing at a decision in a *different* run, which was an adjacent bug class.
- **Layer 4 (RLS).** Policy on `extraction_runs` uses `is_project_reviewer(auth.uid(), project_id)`. Migration 0018 introduced the SECURITY DEFINER helper so the policy is cheap to evaluate.
- **Layer 5 (frontend Zod).** Run advance response schema asserts `stage` is one of the known enum values; an unexpected stage from a broken backend trips a loud parse error in dev, not a silent UI bug.

**Verification:**

```bash
# bypass Pydantic — direct service call
pytest backend/tests/services/test_run_lifecycle_service.py -k advance_stage_rls_bypass

# bypass service — raw insert with a non-reviewer JWT
pytest backend/tests/rls/test_extraction_runs_rls.py

# end-to-end via the endpoint
pytest backend/tests/api/test_runs_endpoint.py -k advance_authz
```

All four layers caught the attack; any one of them being absent would have been a quiet regression.

## Common prumo bug classes and the layer that should close them

| Bug class | Layer to close it |
|---|---|
| BOLA on `/api/v1/runs/...` | Layer 2 (service membership check) + **Layer 4 (RLS, authoritative)** |
| TOCTOU in `run_lifecycle_service.advance_stage` | Layer 2 (`with_for_update` + `row_version` token) + Layer 3 (deferred trigger) |
| `Promise.all` swallows one error in `extractionValueService` | Layer 2 (service: `allSettled` + throw) + Layer 5 (Zod on response) + UI surface for errors |
| Stale TanStack cache | Service-layer invariant: never accept `undefined` IDs; key includes all variant axes |
| SQLAlchemy ↔ Pydantic ↔ Zod drift | Generate schemas, or add a contract test in `backend/tests/contracts/` |
| Missing FK `ON DELETE` | Layer 3 (Alembic migration with explicit `ondelete=...`) |
| RLS gap on new workflow table | Default-deny policy in the same migration that creates the table |

## Anti-patterns

- **One belt, no braces.** "I added a check in the service" is not defence-in-depth; it's one check. RLS, constraints, schemas, frontend validation should still exist.
- **Five identical belts.** Copy-pasting the same check at every layer (and missing the layer's actual purpose) creates a maintenance fire.
- **Disabling a layer "temporarily".** RLS disabled "for the migration"; the migration ships; the disable never gets reverted. If a layer is in the way, the bug is the architecture, not the layer.
- **Trusting the agent.** A Pydantic regex that *looks* right but accepts the bad input. Always test the layer with a known-bad payload.

## Key insight

All five layers are necessary because each catches a different *class* of caller:

- Layer 1 catches typos and malformed JSON.
- Layer 2 catches well-formed but semantically wrong calls.
- Layer 3 catches concurrent writers and admin scripts.
- Layer 4 catches anyone who skipped Layers 1–3.
- Layer 5 catches *backend bugs*, which is uncomfortable but real.

Don't stop at one. Especially not for anything touching `extraction_*`, `hitl_*`, or `project_members`.

---
status: accepted
last_reviewed: 2026-06-10
owner: '@raphaelfh'
adr_number: '0007'
---

# Consolidate all frontend reads on the typed API client (retire the dual Supabase-REST read path)

> **Status:** Accepted · Date: 2026-06-07 (recorded 2026-06-10) ·
> Deciders: @raphaelfh

## Context and Problem Statement

The frontend historically read HITL/extraction data through two
parallel paths: direct Supabase PostgREST queries (`supabase.from(...)`
from `frontend/services/*`) and the FastAPI backend via the typed
client at `frontend/integrations/api/client.ts`. The constitution
(§VI as ratified 2026-04-20) explicitly allowed direct Supabase reads
"for simple table operations".

This dual path is the documented root cause of a whole incident class:
slow run loads (serial request waterfalls), run-status drift between
the two sources, proposal duplication, and the blind-review leak
(PostgREST reads bypassed the service-layer blind filter until RLS
migration `0025_reviewer_scoped_select_rls` closed that hole at the
database). Every rule the backend enforces in a service must otherwise
be duplicated in RLS for the PostgREST path — two filters that MUST
encode the identical predicate or the read paths diverge.

It also costs agent ergonomics: with three plausible "correct" data
access patterns in the codebase (Supabase client, typed API client,
raw `fetch` with `VITE_API_URL`), an agent session copies whichever it
sees first.

## Decision

All frontend reads and writes for application data go through the
typed API client (`frontend/integrations/api/client.ts`). Direct
Supabase client usage is restricted to an explicit allow-list:
auth (session/token) and storage (file upload/download URLs).

Enforcement is deterministic, not advisory: a fitness function under
`scripts/fitness/` bans `supabase.from(` and `import.meta.env.VITE_API_URL`
outside the integration layer, wired into the CI fitness job.

## Consequences

- One authorization/filter surface (backend services + repositories);
  RLS remains as defense-in-depth, not as a second primary path.
- Read shapes become server-composed (e.g. `GET /api/v1/runs/{id}/view`,
  the Phase 2 server-side collapse) instead of client-side waterfalls.
- The frontend loses "free" PostgREST queries — new read needs require
  a backend endpoint (accepted cost; endpoints are cheap with the
  backend-development skill and generated API types are planned).
- Supersedes constitution §VI's direct-read allowance; the constitution
  re-ratification records this.

## Links

- Incident analysis + approval: project memory 2026-06-07
  ("extraction data-path consolidation").
- Blind-leak DB fix: `backend/alembic/versions/0025_reviewer_scoped_select_rls.py`.
- Server-side collapse: PR #228 (`/api/v1/runs/{id}/view`).
- Execution plans: `docs/superpowers/plans/2026-06-08-runopen-slowload-phase*.md`.

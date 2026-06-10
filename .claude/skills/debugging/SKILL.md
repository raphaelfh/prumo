---
name: debugging
description: Dispatcher for prumo's debugging methodology — use the moment a user reports a bug, a failing test, an unexpected behaviour, a "weird" UI state, or anything that does not match the spec. Picks the right sub-skill for the phase you are in.
---

# Debugging (prumo)

Four sub-skills, one philosophy: **evidence before hypothesis, root cause before fix, verification before claim**.

This is for *any* technical issue on prumo — backend (FastAPI + SQLAlchemy async + Celery + Supabase RLS), frontend (Vite + TanStack Query + Zustand), or the seams between them.

## Sub-skills

| Sub-skill | Path | Use when |
|---|---|---|
| systematic-debugging | `systematic-debugging/SKILL.md` | You just heard about a bug. Before any hypothesis. |
| root-cause-tracing | `root-cause-tracing/SKILL.md` | Current evidence looks like a downstream symptom; you need to walk backwards through `Promise.all`, services, or the cache. |
| defense-in-depth | `defense-in-depth/SKILL.md` | You found the root cause and now want to prevent the *class* of bug from recurring. Especially for auth, BOLA, RLS. |
| verification-before-completion | `verification-before-completion/SKILL.md` | You are about to type "fixed", "done", "confirmed", "ready to merge". |

## Quick dispatch

| Symptom | Start here |
|---|---|
| Test failure or unexpected behaviour, no theory yet | systematic-debugging |
| Error appears inside `extraction_*`, deep in a service, but the trigger came from a hook/endpoint | root-cause-tracing |
| Same class of bug keeps coming back (cache key drift, RLS gap, missing await) | defense-in-depth |
| About to claim a fix lands or a flake is real | verification-before-completion |

## Why systematic beats guess-and-check

Empirically on this codebase: most "weird HITL behaviour" reports collapse into one of five classes:

- BOLA on `backend/app/api/v1/endpoints/*` — a project member can act on another project's resource.
- TOCTOU / race in `run_lifecycle_service.advance_stage` or `hitl_session_service.open_session`.
- Error swallowing inside `frontend/hooks/extraction/*` or `frontend/services/*` — `Promise.all` partial failure, `.catch(() => undefined)`.
- Stale TanStack cache — query key is missing `run_id` or `template_version_id`.
- Drift: SQLAlchemy model ↔ Pydantic schema ↔ Alembic migration ↔ frontend Zod don't agree.

Each has a known shape. Run the framework first; pattern-matching by gut is what produced the bug in the first place.

## Cross-skill flow

1. **Bug arrives** → `systematic-debugging` Phase 1 (reproduce, gather evidence at *every* layer, do not theorise yet).
2. **Symptom is downstream of trigger** → switch to `root-cause-tracing` to walk back.
3. **Root cause confirmed, fix ready** → before writing the fix, apply `defense-in-depth` so the class is closed, not just this instance.
4. **About to claim it's done** → `verification-before-completion` to actually run `make test-backend`, `pytest -k <name>`, `vitest run <path>`, `ruff check`, `tsc --noEmit`, and read the output.

Skipping any step is how the same bug keeps coming back.

## House rules

- No "should work" — run the command, read the output, then claim.
- Async-first: a "missing await", an uncommitted transaction, or `asyncio.gather` swallowing one exception look identical to a logic bug. Eliminate these before deeper hypotheses.
- Multi-tenant by default: every bug in `runs`, `extraction_*`, `hitl_*` is a candidate RLS/BOLA bug until you've checked `project_members` and the endpoint's authorisation.
- Logs: prefer `structlog.contextvars.bind_contextvars(run_id=..., project_id=..., user_id=...)` over `print`. Repro evidence is only useful if it carries the IDs.
- Traces: for bugs that span Celery → FastAPI → DB, use the OpenTelemetry trace ID before guessing — the span tree usually points at the boundary that drops context.

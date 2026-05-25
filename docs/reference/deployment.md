---
status: stable
last_reviewed: 2026-05-24
owner: '@raphaelfh'
---

> **Status:** Stable · Last reviewed: 2026-05-24 · Owner: @raphaelfh

# Deployment

Last updated: 2026-05-24 (post GitHub auto-deploy wiring).

## Topology

```text
Browser
   │
   ▼
Vercel ─── (VITE_API_URL=https://web-production-48b398.up.railway.app) ──▶ Railway web (FastAPI + gunicorn)
                                                              │
                                                              │ Celery .delay()
                                                              ▼
                                                          Railway Redis (managed)
                                                              ▲
                                                              │ broker
                                                              │
                                                          Railway worker (Celery)
                                                              │
                                                              ▼
                                                          Supabase (Postgres + Auth + Storage)
                                                          (web also writes directly)
```

All three Railway services + the Redis plugin live in the same project, region **US East** (`us-east4-eqdc4a` — same AZ class as Supabase US East).

## Services

| Service | Builder | Start | Public | Healthcheck |
|---|---|---|---|---|
| `web` | `backend/Dockerfile` | `alembic upgrade head && gunicorn -k UvicornWorker -w 1 -t 120 -b 0.0.0.0:${PORT:-8000}` (Dockerfile CMD) | yes — https://web-production-48b398.up.railway.app | `/health` |
| `worker` | `backend/Dockerfile` | `celery -A app.worker.celery_app worker --loglevel=info --queues=extractions,imports,exports,celery` (Railway custom start command — overrides Dockerfile CMD) | no | none |
| `Redis` | Railway managed plugin | n/a | private network only (`redis.railway.internal`) | n/a |

## Worker — task runner

Every Celery task in `backend/app/worker/tasks/` delegates to a single
shared runner:

```python
from app.worker._runner import run_task

@celery_app.task
def my_task(self, ...):
    async def run():
        async with AsyncSessionLocal() as db:
            ...
    return run_task(run)
```

`run_task` calls `asyncio.run(coro_factory())` — a fresh loop per task.
**Do not** cache event loops in module globals (we tried; see the
2026-05-24 incident). **Do not** cache the Supabase client at module
scope; `get_supabase_client()` returns a new instance per call, so the
httpx connection pool stays bound to the current loop.

## Observability — task-registry alerts

`LoggedTask.on_failure` emits two distinct structlog events:

| Event | Meaning | Recommended alert |
|---|---|---|
| `task_failed` | Generic task crash (business error, retry exhausted). | Aggregate; alert above baseline rate. |
| `celery.task_unregistered` | The worker received a task name it has no handler for. **P1** — always caused by `celery_app.include` drift or a routing typo. | Page on first occurrence. |

The drift guard at `backend/tests/unit/test_celery_app_task_registry.py`
prevents this in CI, but the log event is the runtime safety net.

## Environment variables

There is no tracked env template — env files match `.gitignore` line 21 (`.env.*`). This table is the canonical reference; paste the values into the Railway dashboard or use the Railway CLI to set them.

### Shared across all services

| Key | Source |
|---|---|
| `ENCRYPTION_KEY` | rotated by hand; MUST be the same value across web + worker (Zotero credentials are cross-process) |
| `SUPABASE_URL` | Supabase project settings |
| `SUPABASE_ANON_KEY` | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings |
| `DATABASE_URL` | Supabase pooler (used for app traffic) |
| `DIRECT_DATABASE_URL` | Supabase direct (used by Alembic at boot) |
| `OPENAI_API_KEY` | OpenAI dashboard |
| `OPENAI_DEFAULT_MODEL` | `gpt-4o-mini` |
| `DEBUG` | `false` |
| `RATE_LIMIT_PER_MINUTE` | `60` |
| `PROJECT_NAME` | `Prumo API` |
| `API_V1_PREFIX` | `/api/v1` |
| `SUPABASE_ENV` | `production` |

### Service-level overrides

| Service | Key | Value |
|---|---|---|
| `web` | `CORS_ORIGINS` | `https://prumo-alpha.vercel.app` |
| `web` | `REDIS_URL` | `${{Redis.REDIS_URL}}` (reference variable, resolves to private network) |
| `worker` | `REDIS_URL` | `${{Redis.REDIS_URL}}` (reference variable) |

## Migrations

Alembic runs automatically as part of the web service's Dockerfile `CMD`:

```
alembic upgrade head && gunicorn ...
```

The worker does NOT run Alembic — it boots after the web service via Celery startup. To add a migration:

1. Create it locally: `cd backend && alembic revision --autogenerate -m "description"`.
2. Test locally: `alembic upgrade head` against the local stack.
3. Open a PR, merge to `main`. Railway will autodeploy `web`, which runs Alembic before booting gunicorn.

Auth/storage migrations still go through Supabase CLI (see `docs/reference/migrations.md`).

## Rollback

If a deploy breaks production:

1. **Fast path** (≤2 min): in the Railway dashboard → `web` service → Deployments tab → find the last green deployment → ⋯ → **Redeploy**. Railway redeploys the previous image without rebuilding.
2. **Slow path** (full revert): `git revert <bad-commit> && git push origin main`. Railway auto-deploys the revert.

To roll back the frontend, change `VITE_API_URL` in Vercel back to the previous value and redeploy.

## Deploys are triggered by

Both `web` and `worker` are wired to `raphaelfh/prumo` branch `main`,
root directory `/backend`, builder `DOCKERFILE`, with **Wait for CI**
enabled (Railway holds the deploy until the GitHub Actions workflow
on the head commit passes).

- Push to `main` → Railway queues a deploy for both services. If CI
  passes, deploys promote. If CI fails or is skipped, the Railway
  deployment is marked `SKIPPED` and stays pending until a newer
  commit's CI goes green.
- Push to `dev` → no deploy. Use `dev` for staging-style integration;
  promote to `main` to ship.

### What CI gates the deploy on

The Railway "Wait for CI" gate waits for every required check on the
head commit. As of 2026-05-24 the relevant ones for backend code:

1. **`backend-lint`** — ruff lint + ruff format (mypy advisory).
2. **`fitness`** — every fitness function in `scripts/fitness/`
   (migration boundaries, layered architecture, ApiResponse envelope,
   TanStack query keys, glossary sync, RLS coverage, legacy concept
   blacklist). Baselines are empty as of 2026-05-20; any new violation
   blocks merge with no grandfathering.
3. **`backend-test`** — pytest with three coverage gates:
   - **Global ratchet** (`--cov-fail-under=62`): floor that only ever
     goes up. Current `main` coverage is **71%**. Bumped from 60→62
     on 2026-05-24 after F1/F2; next target 70% after F4 lands.
     **Never lower this once raised** — if a PR drops coverage, the
     PR adds tests, not a relaxed gate.
   - **Diff coverage** (`PRUMO_DIFF_COVERAGE_MIN`, default 80%, PR-only):
     the lines a PR introduces must be ≥80% covered. Catches "new code
     without tests" before the global ratchet notices the dip.
   - **Critical-path aggregate** (`PRUMO_CRITICAL_COVERAGE_MIN`,
     default 85%): the modules listed in `backend/.coverage_critical`
     (autosave write path, run lifecycle, HITL session opener, auth
     deps, coord coherence, run lock, review service, proposal repo)
     aggregate to ≥85%. Bug there = data loss / BOLA / HITL state
     corruption. Snapshot today is 89%.
4. **`backend-e2e`** — `pytest -m e2e`.
5. **`backend-build`** — Docker image build.
6. **`frontend-lint`** + **`frontend-build`** + the E2E gates when the
   corresponding secrets are configured.

Override the env-driven thresholds via repo variables
(`PRUMO_DIFF_COVERAGE_MIN`, `PRUMO_CRITICAL_COVERAGE_MIN`) when
deliberately experimenting; do not edit `ci.yml` for one-off tweaks.

### Manual deploy fallback

When CI is red for a known reason — e.g. a long-running migration PR
where coverage temporarily dips while the spec is in flight — manual
deploys remain available:

```bash
railway up backend --path-as-root --service web --detach -m "<msg>"
railway up backend --path-as-root --service worker --detach -m "<msg>"
```

Use this sparingly. Manual deploys bypass the gates; if you are
shipping past a red CI, document why in the deploy message.

# Deployment

Last updated: 2026-05-24.

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

Auth/storage migrations still go through Supabase CLI (see `docs/architecture/migrations.md`).

## Rollback

If a deploy breaks production:

1. **Fast path** (≤2 min): in the Railway dashboard → `web` service → Deployments tab → find the last green deployment → ⋯ → **Redeploy**. Railway redeploys the previous image without rebuilding.
2. **Slow path** (full revert): `git revert <bad-commit> && git push origin main`. Railway auto-deploys the revert.

To roll back the frontend, change `VITE_API_URL` in Vercel back to the previous value and redeploy.

## Deploys are triggered by

- Push to `main` → Railway auto-deploys `web` and `worker` (both services watch the same branch — once GitHub repo is connected to Railway services; until then deploys are manual via `railway up backend --path-as-root --service <name>`).
- Push to `dev` → no deploy. Use `dev` for staging-style integration; promote to `main` to ship.

(This mirrors the previous Render behavior — see the memory entry `reference_railway_deploys_from_main`.)

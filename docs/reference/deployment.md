---
status: stable
last_reviewed: 2026-11-21
owner: '@raphaelfh'
---

> **Status:** Stable · Owner: @raphaelfh

# Deployment

Why this topology: [ADR 0024](../adr/0024-coolify-vps-and-supabase-sa-east-1.md).

## Topology

```text
Browser
   │
   ▼
Vercel ─── (VITE_API_URL=https://prumo-api.healthnumbers.com.br) ──▶ Traefik (Coolify proxy, Let's Encrypt)
                                                              │
                                                              ▼
                                                          prumo-web (FastAPI + gunicorn)
                                                              │
                                                              │ Celery .delay()
                                                              ▼
                                                          prumo-redis (internal network)
                                                              ▲
                                                              │ broker
                                                              │
                                                          prumo-worker (Celery)
                                                              │
                                                              ▼
                                                          Supabase prumo-sa (Postgres + Auth + Storage)
                                                          (web also writes directly)
```

The backend runs on a Hostinger VPS in Campinas (Brazil) managed by
**Coolify**: project `prumo`, environment `production`, three resources.
Supabase is the managed project `prumo-sa` (ref `pwtaciozopymgcwimxxh`,
region `sa-east-1`, São Paulo). The frontend stays on Vercel at
`https://prumoai.vercel.app`.

## Services

| Service | Builder | Start | Public | Healthcheck | Limits |
| --- | --- | --- | --- | --- | --- |
| `prumo-web` | Coolify Dockerfile build of `backend/Dockerfile` (base directory `/backend`, branch `main`) | Dockerfile `CMD`: `alembic upgrade head && python -m app.seed && gunicorn -k UvicornWorker -w 1 -t 120 -b 0.0.0.0:${PORT:-8000}` | yes — `https://prumo-api.healthnumbers.com.br` (port 8000 behind Traefik) | none in Coolify (see below) | 1 GB, 1.5 CPU |
| `prumo-worker` | same build, same image | `celery -A app.worker.celery_app worker --loglevel=info --queues=extractions,imports,exports,celery`, set with the Custom Docker Option `--entrypoint` (it replaces the Dockerfile `CMD`) | no | none (Celery serves no HTTP) | 2 GB, 2 CPU |
| `prumo-redis` | Coolify database `redis:8.2` | no persistence (broker only: `task_acks_late` + `task_reject_on_worker_lost` cover a restart) | no — internal network only | Coolify default | — |

The worker's `--queues` list above is the in-repo mirror of the Coolify
entrypoint: `backend/tests/unit/test_celery_routes_drift.py` reads it from
this file and fails when a routed queue is missing. Change both together.

**Health checks.** The image has no `curl` or `wget`, which Coolify's HTTP
probe runs inside the container, so the probe is off for `prumo-web`, and the
image carries no `HEALTHCHECK` (it would mark every worker container unhealthy,
since web and worker share the image). A deploy is therefore not gated on
`/health`: read it after every deploy (deploy-release skill § Verify prod) and
let the post-deploy smoke alarm.

**Client IP.** Traefik overwrites `X-Real-Ip` with the caller's address, so
`prumo-web` sets `TRUSTED_CLIENT_IP_HEADER=X-Real-Ip`. The DNS record for the
API is DNS-only in Cloudflare; turning on Cloudflare's proxy would make
Traefik see Cloudflare's address and needs `CF-Connecting-IP` instead.

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
| --- | --- | --- |
| `task_failed` | Generic task crash (business error, retry exhausted). | Aggregate; alert above baseline rate. |
| `celery.task_unregistered` | The worker received a task name it has no handler for. **P1** — always caused by `celery_app.include` drift or a routing typo. | Page on first occurrence. |

The drift guard at `backend/tests/unit/test_celery_app_task_registry.py`
prevents this in CI, but the log event is the runtime safety net.

## Environment variables

The tracked templates are `backend/.env.example` and the root `.env.example`; real env files match `.gitignore` line 21 (`.env.*`). Two hosts, two requirement sets: the **Coolify (backend)** tables immediately below, and the **Vercel (frontend)** subsection further down (the `VITE_` prefix rule makes them genuinely different). These tables are the canonical reference; the running Coolify env is the source of truth for values.

**Where values live in Coolify.** A value both services need is an
environment-level **Shared Variable** (Project `prumo` → `production` →
Shared Variables), and each application references it as
`{{environment.KEY}}`, so web and worker cannot drift. A value only one
service needs is set on that application. A changed value reaches a container
on that application's next redeploy. `SUPABASE_URL` is currently a literal on
each application rather than a reference: the shared variable was malformed
during the cutover.

### Shared across all services

| Key | Source |
| --- | --- |
| `ENCRYPTION_KEY` | set once, never rotate (encrypted Zotero and LLM-connection keys would become unreadable); MUST be the same value across web + worker (Zotero credentials are cross-process). Both refuse to boot while it is blank or the `.env.example` placeholder, unless `SUPABASE_ENV=local` (`app/core/security.py::check_encryption_key`) |
| `SUPABASE_URL` | Supabase project settings (`https://pwtaciozopymgcwimxxh.supabase.co`) |
| `SUPABASE_ANON_KEY` | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings |
| `DATABASE_URL` | Supabase Session pooler (used for app traffic; see [Reaching prod Postgres](#reaching-prod-postgres)) |
| `DIRECT_DATABASE_URL` | Supabase direct (used by Alembic at boot) |
| `REDIS_URL` | `redis://prumo-redis:6379/0` style URL on the Coolify internal network (copy the internal URL from the `prumo-redis` resource) |
| `OPENAI_API_KEY` | OpenAI dashboard |
| `LLM_DEFAULT_MODEL` | `gpt-4o-mini` — set with `LLM_PROVIDER`; since C1b this pair is the FALLBACK for projects with no stored `llm_engine` setting (the ⚙ popover writes `projects.settings.llm_engine`, which wins). MUST still be the same value across web + worker: unset projects resolve it independently in each service (`/api/v1/extraction/models` in **web**, `/api/v1/extraction/sections` in the **worker**) — a per-service mismatch silently runs two different engines for those projects. The former `OPENAI_DEFAULT_MODEL` was defined but never read at runtime |
| `DEBUG` | `false` |
| `RATE_LIMIT_PER_MINUTE` | `60` |
| `PROJECT_NAME` | `Prumo API` |
| `API_V1_PREFIX` | `/api/v1` |
| `SUPABASE_ENV` | `production` |

`/health.commit` reads `SOURCE_COMMIT`, which Coolify passes to the build
when **Include Source Commit in Build** is on for `prumo-web`; the Dockerfile
copies it into the image env. With it off, `/health.commit` is `unknown`.

### Reaching prod Postgres

Connect only through the Session pooler:
`postgresql://postgres.pwtaciozopymgcwimxxh:<password>@<pooler-host>:5432/postgres?sslmode=require`,
where `<pooler-host>` is the `sa-east-1` pooler host shown under **Connect** in
the Supabase dashboard. The direct host `db.<project-ref>.supabase.co` is
IPv6-only and refuses IPv4 clients. The password is the one in the
`DATABASE_URL` shared variable; pass it inline (`DATABASE_URL=... uv run ...`),
never by editing `backend/.env`. Never use Supabase's "Reset database
password": `prumo-web` and `prumo-worker` both hold the current one.

### Service-level overrides

| Service | Key | Value |
| --- | --- | --- |
| `prumo-web` | `CORS_ORIGINS` | Comma-separated allow-list that **extends** the always-allowed defaults baked into [`backend/app/core/config.py`](../../backend/app/core/config.py) (already pins `prumoai.vercel.app` + localhost). The running Coolify env is the source of truth, not this table. |
| `prumo-web` | `PUBLIC_APP_URL` | Public origin of the web app, used for links in agent results (`editor_url`) and the OAuth consent page. Default `https://prumoai.vercel.app`. There is no staging environment today; one would set its own origin here. |
| `prumo-web` | `PUBLIC_API_URL` | `https://prumo-api.healthnumbers.com.br`. Turns OAuth for `/mcp` on and is its issuer (ADR 0022): changing it makes every MCP OAuth client authorize again. |
| `prumo-web` | `MCP_ALLOWED_HOSTS` | Comma-separated `Host` allow-list for the `/mcp` mount (`prumo-api.healthnumbers.com.br` in production). Default `localhost:*,127.0.0.1:*,[::1]:*,test`; a host not listed gets 421, so leaving it unset in production fails closed. |
| `prumo-web` | `MCP_ALLOWED_ORIGINS` | Comma-separated browser `Origin` allow-list for `/mcp`. Default empty: no browser origin may call it (CLI agents send no `Origin` and pass). |
| `prumo-web` | `MCP_MAX_INFLIGHT_PER_TOKEN` | Concurrent `/mcp` requests per token per process (default 4, half the default web pool of 8, so one token cannot hold every connection); over it the request gets 429 with `Retry-After: 1`. Keep it at most half of `DB_POOL_SIZE` + `DB_MAX_OVERFLOW`. |
| `prumo-web` | `DB_POOL_SIZE` | Web engine pool size (default 5; at least 1). Rule: web `DB_POOL_SIZE` + `DB_MAX_OVERFLOW` + the worker's connections stay at or below the pooler client cap. Production uses the Supabase pooler in session mode, capped at 15 clients: defaults give web 5 + 3 = 8, worker 2 children x up to 2 sessions = 4 (an assumption: no setting caps sessions per task), total 12, leaving 3 for migrations and admin sessions. Raising web or worker concurrency means re-doing this sum. |
| `prumo-web` | `DB_MAX_OVERFLOW` | Connections the web pool may open beyond `DB_POOL_SIZE` under load (default 3; 0 gives a fixed-size pool); counts toward the pooler cap above. |
| `prumo-web` | `DB_POOL_TIMEOUT` | Seconds a request waits for a pooled connection (default 10). Past it, or when the database refuses or drops the connection, `/mcp` answers 503 with `Retry-After: 2`, during the token lookup or the tool call alike. |
| `prumo-web` | `RATE_LIMIT_STORAGE_URI` | The `prumo-redis` internal URL. Unset falls back to `memory://`, which is per process: limits then reset on restart and are not shared across instances. |
| `prumo-web` | `TRUSTED_CLIENT_IP_HEADER` | `X-Real-Ip` in production. The request header every per-IP rate-limit key reads (OAuth `/register` and `/token`, unauthenticated `/mcp`, anonymous REST). Unset keys on the TCP peer, which behind Traefik is the proxy: every caller then shares one bucket. Trust assumption: Traefik overwrites a caller-supplied `X-Real-Ip`, and `prumo-web` publishes no port that bypasses Traefik. A value that is not one IP literal falls back to the peer. Never set it on a service reachable without the proxy. |
| `prumo-web` | `NCBI_EMAIL` | Optional. Contact email sent to NCBI E-utilities with `tool=prumo` on PubMed imports (NCBI asks for one). Unset, a non-dry-run PubMed import is refused with 503 `NCBI_EMAIL_NOT_CONFIGURED`; dry runs need none. |
| `prumo-worker` | `NCBI_EMAIL` | Optional. Same value as `prumo-web`: the worker's efetch calls send it with `tool=prumo`. |

### Feedback / Linear

| Key | Purpose | Used by |
| --- | --- | --- |
| `LINEAR_API_KEY` | Linear personal/workspace API key (SECRET) — used to create feedback issues via the Linear GraphQL API | `worker` (only `feedback_tasks` reads them) |
| `LINEAR_TEAM_ID` | Linear **Feedback** team UUID (key `FEE`) — in-app feedback routes here; the Prumo team is GitHub-sync/automation only, NOT the feedback target. Must be the team **UUID, not the `FEE` slug** (`issueCreate(teamId:)` requires the UUID; the slug fails). Validated at boot in `config.py`; the live value lives in the Coolify shared variable (source of truth). | `worker` (only `feedback_tasks` reads them) |
| `FEEDBACK_MEDIA_BUCKET` | Supabase Storage bucket for feedback screenshots/clips (default `feedback-media`) | `worker` |

### Vercel (frontend) — only `VITE_*` reaches the browser

The frontend is a **Vite** SPA (not Next.js). Vite exposes **only** variables prefixed
with `VITE_` to the client bundle — `vite.config.ts` does not override the default
`envPrefix`. Every other variable (`SUPABASE_URL`, `NEXT_PUBLIC_*`, `POSTGRES_*`, …) is
absent from `import.meta.env` at build time and resolves to `undefined` in the browser.

Canonical frontend vars (set in the Vercel project for Production + Preview):

| Key | Required | Notes |
| --- | --- | --- |
| `VITE_API_URL` | yes | Backend base URL (`https://prumo-api.healthnumbers.com.br`). |
| `VITE_SUPABASE_URL` | yes | Supabase project URL — same value as the integration's `SUPABASE_URL`, but it must carry the `VITE_` prefix. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase publishable (anon) key. `VITE_SUPABASE_ANON_KEY` is accepted as a fallback. |
| `VITE_SITE_URL` | yes | Auth redirect base for the sign-up-confirmation and password-reset e-mails (`getAuthRedirectBaseUrl` in `frontend/pages/Auth.tsx`; falls back to `window.location.origin` when unset). Must equal the production origin **and** be allow-listed in Supabase — see [Supabase auth redirects](#supabase-auth-redirects-the-silent-failure) below. |
| `VITE_SUPABASE_ENV` | optional | `local` points the client at the local Supabase URL; anything else (or unset) means `production`. |

#### The Supabase ↔ Vercel integration does not feed the Vite build

Installing the integration auto-syncs (and keeps fresh) these into the Vercel project:

```text
POSTGRES_URL, POSTGRES_PRISMA_URL, POSTGRES_URL_NON_POOLING, POSTGRES_USER,
POSTGRES_HOST, POSTGRES_PASSWORD, POSTGRES_DATABASE,
SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY), SUPABASE_JWT_SECRET,
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

None of them carry the `VITE_` prefix, so the Vite build ignores all of them; the app
keeps reading the manually-set `VITE_SUPABASE_*` copies. The integration is handy as a
value source and for the Studio link, but it is **not** what makes the frontend work and
it does **not** replace the `VITE_*` vars. (`frontend/config/supabase-env.ts` resolves
only `VITE_SUPABASE_*` for exactly this reason — it deliberately does not read the
non-`VITE_` names, since they are invisible to the build.)

> **Key-rotation drift — the one thing to remember.** If you rotate the Supabase
> anon/publishable key, the integration refreshes `SUPABASE_PUBLISHABLE_KEY` /
> `NEXT_PUBLIC_*` automatically but **not** `VITE_SUPABASE_PUBLISHABLE_KEY`. Update the
> `VITE_` copy by hand, or production login breaks while the integration-managed vars
> still look current.
>
> **Security trap — never widen `envPrefix`.** Do not "activate" the integration vars by
> adding `SUPABASE_`, `POSTGRES_`, or `NEXT_PUBLIC_` to `envPrefix` in `vite.config.ts`.
> That would inline `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` /
> `SUPABASE_JWT_SECRET` / `POSTGRES_PASSWORD` into the public JS bundle — a credential
> leak (the secret / service-role key bypasses RLS). Keep `VITE_` as the only prefix and
> re-expose just the two public values (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).

#### Backend secrets do not belong in the Vercel project

The Vercel project currently also holds backend-only vars (`SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_SECRET_KEY`, `DATABASE_URL`, `DIRECT_DATABASE_URL`, `ENCRYPTION_KEY`,
`OPENAI_API_KEY`, `REDIS_*`, `RAILWAY_RUN_COMMAND`, …). FastAPI runs on **Coolify**, not
Vercel, so these are unused by the static build (no `VITE_` prefix → never bundled) but
are needless secret surface on a second platform. They are safe to delete from Vercel;
keep them only in Coolify.

#### Supabase auth redirects: the silent failure

The sign-up-confirmation and password-reset e-mails carry a `redirect_to` built
from `VITE_SITE_URL`. GoTrue honours it **only** when it matches the project's
Redirect URLs allow list. On a miss it silently discards the value and sends the
user to the Site URL instead. Nothing fails loudly: the e-mail still arrives, the
link still works, the user just lands on the wrong page. There is no console
error, no failed request, and no build-time signal.

Two settings must therefore agree, in **Dashboard > Authentication > URL
Configuration**:

| Setting | Value | Why |
| --- | --- | --- |
| Site URL | `https://prumoai.vercel.app` | The fallback target. Must be a public origin: pointing it at the project-scoped `prumo-*.vercel.app` domain sends users into Vercel's Deployment Protection login wall. |
| Redirect URLs | `https://prumoai.vercel.app/**`, `http://localhost:8080/**` | The allow list. **The `/**` suffix is load-bearing** — a bare `http://localhost:8080` does not match `http://localhost:8080/auth/reset-password`. Local dev runs on 8080 (`vite.config.ts`), not Vite's default 5173. |

This has broken three times, always through domain drift
(`prumo` -> `prumo-alpha` -> `prumoai`). To check a redirect target after a
domain rename, ask GoTrue directly — a deliberately invalid token is read-only,
so no e-mail is sent and no auth state changes:

```bash
curl -sSI "https://<project-ref>.supabase.co/auth/v1/verify?token=invalid&type=recovery&redirect_to=https%3A%2F%2Fprumoai.vercel.app%2Fauth%2Freset-password" | grep -i '^location'
```

If the `location` echoes the URL and path you sent, it is allow-listed. If it
returns anything else, that something else is the Site URL and your redirect was
discarded. (`otp_expired` in the fragment is the expected response to the
invalid token; read the host and path only.)

`AuthProvider` also routes to the reset form whenever Supabase emits
`PASSWORD_RECOVERY`, so a same-origin allow-list miss degrades to a redirect
rather than to a silent sign-in. That safety net cannot cover a cross-origin
fallback: the PKCE verifier lives in the requesting origin's `localStorage`, so
a local-dev request falling back to the production Site URL still fails. Keep
both origins allow-listed.

## Migrations

Alembic runs automatically as part of `prumo-web`'s Dockerfile `CMD`,
followed by the seed, which converges the global template catalogue on
every deploy:

```text
alembic upgrade head && python -m app.seed && gunicorn ...
```

The seed is idempotent end to end — every template seeder early-returns on
an existing row and the instruction backfill is fill-if-null — so a deploy
installs newly added global templates without a manual step and never
touches existing rows. A seed or migration failure aborts the boot: the
container exits before gunicorn binds, so the new build never serves. With
Coolify's healthcheck off, read the deployment status and `/health` to see it
(§ Rollback).

The worker does NOT run Alembic or the seed — its entrypoint replaces the
`CMD`. To add a migration:

1. Create it locally: `cd backend && alembic revision --autogenerate -m "description"`.
2. Test locally: `alembic upgrade head` against the local stack.
3. Open a PR to `dev`. Once merged, promote `dev → main` via a merge-commit PR, not a fast-forward push (see the deploy-release skill runbook for the commands). Coolify then deploys `prumo-web`, which runs Alembic before booting gunicorn.

Auth/storage migrations (`supabase/migrations/`) are authored with the
Supabase CLI (see `docs/reference/migrations.md`) and deployed by the same
`main` push, through the Supabase GitHub integration on `prumo-sa`. Its
`Supabase Preview` check on the `main` commit is not a required context, so
read it after any promotion that touches `supabase/`. Never apply one through
the Supabase MCP `apply_migration`: it records a generated version that does
not match the file, and every later integration deploy fails on the mismatch.

## Rollback

If a deploy breaks production:

1. **Fast path**: in Coolify → `prumo-web` (and `prumo-worker`) →
   Deployments → **Rollback** to the previous image. Coolify keeps earlier
   images on the VPS, so this does not rebuild. A migration that already ran
   makes an older image exit at boot (`check_pending_migrations`): roll
   forward instead, or run `alembic downgrade <prev>` first.
2. **Slow path** (full revert): revert the bad commit on `dev` and promote
   it to `main` through the normal PR; Coolify deploys the revert.

To roll back the frontend, promote the previous deployment in Vercel.

## Deploys are triggered by

`prumo-web` and `prumo-worker` are wired to `raphaelfh/prumo` branch `main`
through Coolify's GitHub App, base directory `/backend`, build pack
Dockerfile.

- Push to `main` → Coolify builds and rolls out both applications, each from
  its own build of the same Dockerfile. Coolify does **not** wait for CI: the
  required checks on the `dev → main` promotion PR are the gate, so never
  push to `main` outside a promotion (bash-guard denies it).
- Push to `dev` → no deploy. Use `dev` for staging-style integration;
  promote `dev → main` to ship — via a merge-commit PR, not a
  fast-forward push (`main` carries merge commits dev lacks). See the
  deploy-release skill for the commands + runbook.
- A missed webhook (no deployment for the main SHA) is recovered by a manual
  **Deploy** of both applications in Coolify; it builds the current `main`
  head, so it ships only what was already promoted.

### What CI gates the deploy on

The required checks on the `dev → main` promotion PR are the only gate:
Coolify deploys whatever lands on `main`. As of 2026-05-24 the relevant ones
for backend code:

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
6. **`frontend-lint`** + **`frontend-build`** + the ephemeral-stack
   frontend E2E (self-provisioned, no secrets needed).
7. **`docs-ci`** — path-filtered; it gates the PR when docs change.

After a deploy, the `post-deploy-smoke` workflow (push-triggered +
every 6 hours) verifies prod in three layers; a failure emails the
owner. It is the deploy safety net, not a gate.

1. **Reachability** — `/health`, the frontend root, and a CORS preflight
   from the prod origin.
2. **Deployed commit** — `/health.commit` (Coolify's `SOURCE_COMMIT`,
   surfaced via `settings`) must equal the promoted SHA. Reachability alone
   cannot tell a fresh deploy from one stuck on an older commit or a failed
   build. **Only the 6-hourly scheduled run fails on a mismatch.** A
   push-triggered run polls (up to ~10 min) and then merely warns, because
   it races the build it is verifying; the scheduled run checks a settled
   deploy.

There is deliberately **no credentialed probe and no Playwright suite
pointed at prod**. An authenticated probe was built and then removed
(2026-08-23): beyond layer 1 it only adds the narrow delta between "JWKS
loaded at boot" (already reported by `/health.checks`) and "a freshly
minted token is accepted", which does not pay for a permanent production
password living in CI — nor for a `::warning::` on every run while it sits
without credentials, which is how a warning stops being read. The former
`remote-smoke` project dispatched a real AI extraction (LLM spend + a run
left behind per execution) and had never run in CI — no secrets were ever
provisioned — so it silently self-skipped to a green "pass".

Override the env-driven thresholds via repo variables
(`PRUMO_DIFF_COVERAGE_MIN`, `PRUMO_CRITICAL_COVERAGE_MIN`) when
deliberately experimenting; do not edit `ci.yml` for one-off tweaks.

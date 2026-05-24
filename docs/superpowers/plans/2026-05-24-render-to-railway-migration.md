# Render → Railway Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Render free-tier hosting with Railway Hobby plan so the async Celery endpoints (`articles_export`, `zotero_import`, `extraction_export`) work in production, then strip every Render reference from the repo and document the new topology.

**Architecture:** Three sequential phases. (1) **Prep PRs (A, B)** — land safe code changes on `main` before touching infra: remove a dead `beat_schedule` and bump the Dockerfile to Python 3.12, aligning its `CMD` with the gunicorn flags Render is currently using. Both prep PRs are no-ops for the live Render service (it builds from `render.yaml`, not the Dockerfile). (2) **Cutover (C, D)** — provision Railway web + worker + Redis from the same Dockerfile, validate against the ephemeral `*.up.railway.app` URL while Render still serves traffic, then flip `VITE_API_URL` in Vercel and suspend Render (rollback window: 24h). (3) **Cleanup (E)** — delete `render.yaml`, commit `railway.toml` as the IaC source of truth, write `docs/architecture/deployment.md` (which doubles as the canonical env-var reference since env files are gitignored), refresh `CLAUDE.md` Recent Changes, update the preflight gate, and rename the memory file.

**Tech Stack:** Railway (Hobby, US East — same AZ class as Supabase), Docker (existing `backend/Dockerfile`), Python 3.12 (bump from 3.11 in the image only; CI stays on 3.11), gunicorn + uvicorn workers, Celery 5.4, Railway-managed Redis, Supabase (unchanged), Vercel (unchanged).

---

## Scope notes

- This plan is **one workstream**, not five — every PR has at least one explicit ordering dependency on a previous one (B after A is optional; C requires B; D requires C; E requires D). Splitting into separate plans would lose that ordering context.
- Out of scope (already spawned as separate task): missing `app.worker.tasks.extraction_export_tasks` entry in `celery_app.include`. The Excel export Celery task won't run on the worker until that lands; fix it independently before cutover so Railway doesn't inherit a broken worker.
- Database is **not** migrating. Supabase stays put; only the FastAPI compute host changes. `DATABASE_URL` / `DIRECT_DATABASE_URL` are copied verbatim into Railway.
- Frontend stays on Vercel. Only `VITE_API_URL` changes at cutover.
- **Env files are gitignored.** `.gitignore` line 21 (`.env.*`) blocks every `.env.<anything>` file from tracking, with only `!.env.example` and `!.env.template` whitelisted. The user's local `backend/.env.render.example` is an untracked local artifact — not in git. This plan therefore does **not** track a `backend/.env.railway.example` file; instead, `docs/architecture/deployment.md` (Task 5) carries the canonical env-var table that the user pastes into the Railway dashboard. PR E does **not** `git rm backend/.env.render.example` (nothing to remove from git).

---

## File structure

### Files to create

| Path | Responsibility | PR |
|---|---|---|
| `railway.toml` (repo root) | IaC source of truth for Railway build settings — Dockerfile path, healthcheck, restart policy. Service-level overrides (queue list for the worker, CORS for the web service) live in the Railway dashboard, with this file documenting which keys exist where. | E |
| `docs/architecture/deployment.md` | One-page deployment reference: topology diagram (Vercel → Railway → Supabase), env-var table (shared vs per-service), rollback procedure, "how to add a migration" note. This is the **canonical env-var reference** — there is no tracked `.env.railway.example` (gitignored). | E |

### Files to modify

| Path | Change | PR |
|---|---|---|
| `backend/app/worker/celery_app.py:52-59` | Delete the `beat_schedule` dict (it references `app.worker.tasks.maintenance_tasks.cleanup_old_results`, which doesn't exist — module is absent from `backend/app/worker/tasks/`). Also delete the `# Beat scheduler (tarefas periodicas)` comment on line 52. | A |
| `backend/Dockerfile:2,19,27` | Bump `python:3.11-slim` → `python:3.12-slim` (build + runtime stages), update the `site-packages` copy path from `python3.11/site-packages` to `python3.12/site-packages`. | B |
| `backend/Dockerfile:45-46` | Update `HEALTHCHECK` to read `${PORT:-8000}` (via `os.environ.get` in the Python one-liner) so it follows the same port the `CMD` binds to. Without this, Railway containers — where `PORT` is injected — would show as Docker-unhealthy even though the platform-level Railway healthcheck routes correctly. Caught in code review of PR #107 and folded in. | B |
| `backend/Dockerfile:49` | Replace the `CMD ["sh", "-c", "alembic upgrade head && uvicorn ..."]` line with `CMD ["sh", "-c", "alembic upgrade head && gunicorn -k uvicorn.workers.UvicornWorker -w 1 -t 120 -b 0.0.0.0:${PORT:-8000} app.main:app"]`. Mirrors the render.yaml startCommand (line 25) — 30s uvicorn default times out on template-clone round-trips to Supabase. `${PORT:-8000}` works on Railway (which injects `PORT`) and locally (falls back to 8000). | B |
| `CLAUDE.md` (repo root) | Insert a `2026-05-24` entry at the top of "Recent Changes" describing the Railway migration. | E |
| `.claude/CLAUDE.md` | No content change required — it already points readers at `docs/architecture/` and the constitution. Skip unless a Render mention sneaks in elsewhere; verify with `grep -n Render .claude/CLAUDE.md`. | E |
| `README.md` | Add a short "Deployment" section after the existing setup section, linking to `docs/architecture/deployment.md`. | E |
| `.claude/commands/preflight.md:155,182,197,199,209,213` | Replace the `remote-deploys` gate's Render-specific check (`curl https://review-hub-backend.onrender.com/health`) with the Railway URL. Update the surrounding prose accordingly. | E |
| `/Users/raphael/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/MEMORY.md:4` | Change the line `- [Render deploys from main](reference_render_deploys_from_main.md)` to point at the renamed file. | E |

### Files to delete

| Path | Why | PR |
|---|---|---|
| `render.yaml` | No longer the source of truth. | E |
| `/Users/raphael/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/reference_render_deploys_from_main.md` | Renamed to `reference_railway_deploys_from_main.md` (rewritten content). | E |

### Files explicitly NOT modified

- `docker-compose.yml` — local dev only, unaffected by hosting choice. The "review-hub" container name is a separate cosmetic cleanup, out of scope.
- `backend/pyproject.toml` (`requires-python = ">=3.11"`, `target-version = "py311"`, `python_version = "3.11"`) — kept at 3.11. Local dev and CI run on 3.11; the production image runs 3.12. Keeping the floor at 3.11 means the test suite proves correctness on the lower bound.
- `.github/workflows/ci.yml` (`PYTHON_VERSION: "3.11"`) — kept at 3.11 for the same reason.
- `backend/README.md:112-113` (mentions `docker build -t review-hub-backend`) — the image tag is a local-dev cosmetic, leave it.

---

## Task 1 — PR A: Remove dead `beat_schedule`

**Branch:** `cleanup/celery-beat-and-env-bug` off `dev`

**Files:**
- Modify: `backend/app/worker/celery_app.py:51-59`

**Rationale:** Pure deletion of dead config — `beat_schedule` references a phantom `app.worker.tasks.maintenance_tasks.cleanup_old_results` module that doesn't exist, and Celery Beat isn't running anywhere. Lands before touching Dockerfile or infra.

**Note on scope shrinkage:** the original draft also planned to fix `backend/.env.render.example:37` (rogue `OPENAI_API_KEY` overwrite). That file is gitignored (`.gitignore:21` matches `.env.*`) and exists only as a local user artifact — not in version control. The user can fix their local copy themselves; nothing to ship via PR.

- [ ] **Step 1: Confirm the dead module really is absent**

Run: `ls backend/app/worker/tasks/ | grep -i maintenance`
Expected: empty output (only `export_tasks.py`, `extraction_export_tasks.py`, `extraction_tasks.py`, `import_tasks.py`, `__init__.py` exist).

If anything matches, STOP — the beat task isn't dead after all. Investigate before deleting.

- [ ] **Step 2: Remove the `beat_schedule` block from `celery_app.py`**

Edit `backend/app/worker/celery_app.py`, find the block at lines 51-59:

```python
    "app.worker.tasks.import_tasks.*": {"queue": "imports"},
    },
    # Beat scheduler (tarefas periodicas)
    beat_schedule={
        # Exemplo: cleanup de resultados antigos
        "cleanup-old-results": {
            "task": "app.worker.tasks.maintenance_tasks.cleanup_old_results",
            "schedule": 86400.0,  # 24 horas
        },
    },
)
```

Replace with:

```python
    "app.worker.tasks.import_tasks.*": {"queue": "imports"},
    },
)
```

(Removes lines 52-59 — the comment and the entire `beat_schedule={...},` block; closes the `update(...)` call directly after the `task_routes` dict.)

- [ ] **Step 3: Verify the module still imports**

Run: `cd backend && uv run python -c "from app.worker.celery_app import celery_app; print(sorted(celery_app.conf.beat_schedule.keys()))"`
Expected: `[]` (empty list — Celery's default for `beat_schedule` is `{}`).

- [ ] **Step 4: (deferred) ~Fix the OPENAI_API_KEY overwrite in `.env.render.example`~**

Skipped. The file is gitignored; not in version control. The user fixes their own local copy. See plan §Scope notes.

- [ ] **Step 5: Run backend lint to catch any indentation or import drift**

Run: `make lint-backend`
Expected: `All checks passed!` (ruff + format check both green).

- [ ] **Step 6: Run the backend test suite**

Run: `make test-backend`
Expected: full suite passes — no test referenced `beat_schedule`, so removing it should be invisible. If anything fails, STOP and investigate.

- [ ] **Step 7: Commit**

```bash
git add backend/app/worker/celery_app.py
git commit -m "chore(worker): drop dead beat_schedule entry

celery_app.py: remove beat_schedule referencing the non-existent
app.worker.tasks.maintenance_tasks.cleanup_old_results module.
Celery Beat is not running anywhere; this is dead config."
```

- [ ] **Step 8: Push and open PR A to `dev`**

```bash
git push -u origin cleanup/celery-beat-and-env-bug
gh pr create --base dev --title "chore(worker): drop dead beat_schedule entry" --body "$(cat <<'EOF'
## Summary
Drop the `beat_schedule` block in `celery_app.py` — its single entry references `app.worker.tasks.maintenance_tasks.cleanup_old_results`, a module that does not exist in `backend/app/worker/tasks/`. Beat isn't running anywhere so this is dead config.

## Test plan
- [x] `make lint-backend` — passes (modulo any pre-existing failures unrelated to this change)
- [x] `make test-backend` — passes (modulo any pre-existing failures unrelated to this change)
- [x] Manual: `from app.worker.celery_app import celery_app; celery_app.conf.beat_schedule == {}`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9: Merge PR A to `dev`, then merge `dev` → `main`**

`dev` → `main` is needed because Render deploys from `main` (see memory `reference_render_deploys_from_main.md`). Render won't pick up the change, but it harmlessly removes config drift between `main` and the repo.

---

## Task 2 — PR B: Bump Dockerfile to Python 3.12 + gunicorn `CMD`

**Branch:** `prep/railway-dockerfile-and-env` off `dev`

**Files:**
- Modify: `backend/Dockerfile:2,19,27,45-46,49`

**Rationale:** Before pointing Railway at the repo, the Dockerfile needs to match what's been running in Render prod (`PYTHON_VERSION=3.12.0`, gunicorn worker with -t 120) so Railway boots a known-good runtime.

**Note on scope shrinkage:** the original draft also planned to create `backend/.env.railway.example`. That file would be gitignored (`.gitignore:21` matches `.env.*`) just like `.env.render.example`. The Railway env-var reference instead lives in `docs/architecture/deployment.md` (Task 5).

- [ ] **Step 1: Bump Python from 3.11 to 3.12 in the builder stage**

Edit `backend/Dockerfile`, line 2. Change:

```dockerfile
FROM python:3.11-slim as builder
```

to:

```dockerfile
FROM python:3.12-slim as builder
```

- [ ] **Step 2: Bump Python in the runtime stage**

Edit `backend/Dockerfile`, line 19. Change:

```dockerfile
FROM python:3.11-slim as runtime
```

to:

```dockerfile
FROM python:3.12-slim as runtime
```

- [ ] **Step 3: Update the site-packages copy path**

Edit `backend/Dockerfile`, line 27. Change:

```dockerfile
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
```

to:

```dockerfile
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
```

- [ ] **Step 4: Swap the uvicorn `CMD` for the gunicorn one**

Edit `backend/Dockerfile`, line 49. Change:

```dockerfile
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
```

to:

```dockerfile
CMD ["sh", "-c", "alembic upgrade head && gunicorn -k uvicorn.workers.UvicornWorker -w 1 -t 120 -b 0.0.0.0:${PORT:-8000} app.main:app"]
```

Same `-w 1 -t 120` Render is using; the 120s worker timeout is required because template-clone round-trips to Supabase routinely exceed gunicorn's 30s default. `${PORT:-8000}` reads Railway's injected `PORT` env var in prod and falls back to 8000 locally (Docker Compose and `docker run` won't set `PORT`).

- [ ] **Step 5: Build the image locally to confirm it still compiles**

Run: `docker build -t prumo-backend:railway-test backend/`
Expected: successful build, final image tagged `prumo-backend:railway-test`. The most common failure mode is `uv pip install` choking on the new Python — if that happens, the issue is a binary wheel that lacks 3.12 support; check the failing package and either pin or upgrade in `pyproject.toml`.

- [ ] **Step 6: Confirm the runtime Python is 3.12**

Run: `docker run --rm prumo-backend:railway-test python --version`
Expected: `Python 3.12.x` (any patch version).

- [ ] **Step 7: Boot the container against the local Supabase stack and verify `/health`**

Confirm local stack is up (`make start` if not). Then:

```bash
docker run --rm -d --name prumo-railway-test \
  --env-file backend/.env.local \
  -p 8001:8000 \
  prumo-backend:railway-test
sleep 8  # wait for alembic + gunicorn boot
curl -fsS http://localhost:8001/health
docker logs prumo-railway-test | tail -30
docker stop prumo-railway-test
```

Expected: `curl` returns the `/health` JSON (200), logs show `alembic upgrade head` completed and `gunicorn` workers booted without error. If `.env.local` doesn't exist, use `backend/.env` or whatever the project's dev env file is named — check `make start` to see what it consumes.

- [ ] **Step 8: (deferred) ~Create `backend/.env.railway.example`~**

Skipped. Env files are gitignored (`.gitignore:21` matches `.env.*`). The Railway env-var reference will be added in Task 5 as a markdown table inside `docs/architecture/deployment.md`.

- [ ] **Step 9: Run the test suite again to confirm nothing broke**

Run: `make test-backend && make lint-backend`
Expected: both green (modulo any pre-existing failures unrelated to this change — note the pre-existing I001 ruff failure in `tests/unit/test_extraction_xlsx_builder.py` and the 4 pre-existing fitness-check failures already flagged separately).

- [ ] **Step 10: Commit**

```bash
git add backend/Dockerfile
git commit -m "build: bump Dockerfile to Python 3.12 + gunicorn CMD

- python:3.11-slim → python:3.12-slim (build + runtime stages);
  site-packages copy path updated. Aligns the image with what Render
  prod has been running via PYTHON_VERSION=3.12.0.
- CMD: replace uvicorn with gunicorn -k UvicornWorker -w 1 -t 120
  -b 0.0.0.0:\${PORT:-8000} to mirror render.yaml startCommand. The
  120s worker timeout is required because template-clone round-trips
  to Supabase exceed gunicorn's 30s default. \${PORT:-8000} reads
  Railway's injected PORT in prod and falls back to 8000 locally."
```

- [ ] **Step 11: Push and open PR B to `dev`**

```bash
git push -u origin prep/railway-dockerfile-and-env
gh pr create --base dev --title "build: bump Dockerfile to Python 3.12 + gunicorn CMD for Railway" --body "$(cat <<'EOF'
## Summary
- Bump `backend/Dockerfile` builder + runtime base images from `python:3.11-slim` to `python:3.12-slim` and update the `site-packages` copy path. Aligns the image with what Render prod has been running (`PYTHON_VERSION=3.12.0` in render.yaml).
- Replace the `uvicorn` `CMD` with `gunicorn -k uvicorn.workers.UvicornWorker -w 1 -t 120 -b 0.0.0.0:${PORT:-8000}` to mirror `render.yaml:25`. The 120s worker timeout prevents template-clone round-trips from being killed by gunicorn's 30s default. `${PORT:-8000}` reads Railway's injected `PORT` env var in prod and falls back to 8000 locally.

Local dev and CI continue to run on Python 3.11 (`pyproject.toml requires-python = ">=3.11"`, CI `PYTHON_VERSION: "3.11"`). Keeping the floor at 3.11 means tests prove correctness on the lower bound; prod runs on the higher bound.

## Test plan
- [x] `docker build -t prumo-backend:railway-test backend/` succeeds
- [x] `docker run --rm prumo-backend:railway-test python --version` → 3.12.x
- [x] Container boots against local Supabase, `/health` returns 200
- [x] `make test-backend` + `make lint-backend` green (modulo pre-existing failures unrelated to this change)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 12: Merge PR B to `dev`, then merge `dev` → `main`**

Required because Railway will be configured to deploy from `main` (mirroring Render's current setup).

---

## Task 3 — PR C: Provision Railway services + validate

**No code changes.** All steps are operations against the Railway dashboard, the Railway CLI, and `curl`.

**Files:** none

**Rationale:** Stand up the full Railway topology (web + worker + Redis) in parallel with Render so we can validate against the ephemeral `*.up.railway.app` URL before any cutover.

- [ ] **Step 1: Sign up and install the CLI**

```bash
brew install railway
railway login
```

Expected: browser opens, OAuth flow completes, terminal shows `Logged in as <email>`.

Manual: in the Railway dashboard, upgrade the account to **Hobby ($5/mo + usage)** if it isn't already. Free tier doesn't allow background workers + Redis together.

- [ ] **Step 2: Create the Railway project and link it to the GitHub repo**

In the Railway dashboard:
1. New Project → **Deploy from GitHub repo** → select `prumo`.
2. After project creation, open the auto-created service and configure:
   - **Branch:** `main`
   - **Root directory:** `backend`
   - **Region:** US East (Virginia equivalent — same AZ class as Supabase US East)
3. Confirm Railway detects `backend/Dockerfile` automatically (look for "Builder: Dockerfile" in the Settings tab).
4. Rename this service to **`web`** in the Railway dashboard.

Verify locally:

```bash
railway link  # select the new project
railway status
```

Expected: shows project name + linked service `web`.

- [ ] **Step 3: Set project-level shared environment variables**

In the Railway dashboard → Project Settings → Variables, paste these keys (copy values from the current Render env, NOT from the user's local `backend/.env.render.example` — that's the same source). Skip `CORS_ORIGINS` and `REDIS_URL` for now (those are service-level):

```
ENCRYPTION_KEY=<copy from current Render value>
SUPABASE_URL=https://gdfslcfeobjdxihqtcsk.supabase.co
SUPABASE_ANON_KEY=<copy from current Render value>
SUPABASE_SERVICE_ROLE_KEY=<copy from current Render value>
DATABASE_URL=<copy from current Render value>
DIRECT_DATABASE_URL=<copy from current Render value>
OPENAI_API_KEY=<copy from current Render value — NOT the LangSmith token>
DEBUG=false
RATE_LIMIT_PER_MINUTE=60
PROJECT_NAME=Prumo API
API_V1_PREFIX=/api/v1
SUPABASE_ENV=production
```

⚠️ **CRITICAL:** Copy `ENCRYPTION_KEY` from Render verbatim. If it changes, Zotero credentials encrypted by the old key become unreadable.

Verify:

```bash
railway variables
```

Expected: lists all keys above. Values are masked in output.

- [ ] **Step 4: Set the web-only `CORS_ORIGINS` override**

In the Railway dashboard → `web` service → Variables (the service-level tab, not project-level):

```
CORS_ORIGINS=https://prumo-alpha.vercel.app
```

(Keeping this service-level means a future preview deployment can override without touching shared state.)

- [ ] **Step 5: Set the web service healthcheck path**

In the Railway dashboard → `web` service → Settings → Networking, set **Health Check Path** to `/health`. Generate a public domain (Settings → Networking → Generate Domain) and copy the resulting `<service>.up.railway.app` URL.

- [ ] **Step 6: Trigger the first web deployment and watch for `alembic upgrade head`**

The web service deploys automatically when the GitHub link is created. If it didn't, click Deploy in the dashboard.

```bash
railway logs --service web
```

Expected output to contain, in order:
1. `Building Dockerfile`
2. `[1/N] Running migrations...` followed by `Running upgrade <revision>` lines (Alembic).
3. `[INFO] Booting worker with pid:` (gunicorn).
4. `[INFO] Application startup complete.`

If Alembic fails, STOP — usually means `DIRECT_DATABASE_URL` is wrong or the pooler hostname is unreachable. Fix the env var, redeploy.

- [ ] **Step 7: Validate the `/health` endpoint**

```bash
curl -fsS https://<your-service>.up.railway.app/health
```

Expected: HTTP 200 with the usual `{"status": "ok", ...}` body. If it 502s, the gunicorn workers haven't booted — check logs.

- [ ] **Step 8: Add the managed Redis plugin**

In the Railway dashboard → project canvas → `+ New` → **Database** → **Add Redis**.

Wait for status `Active`. No further config needed.

- [ ] **Step 9: Create the worker service from the same repo**

In the dashboard → `+ New` → **GitHub Repo** → select `prumo` again (yes, same repo).

Configure:
- **Branch:** `main`
- **Root directory:** `backend`
- **Builder:** Dockerfile (auto-detected)
- **Start command** (Service Settings → Deploy → Custom Start Command — overrides the Dockerfile `CMD`):

```
celery -A app.worker.celery_app worker --loglevel=info --queues=extractions,imports,celery
```

(Note: this matches `render.yaml:64`. If the separate "fix extraction_export_tasks include" task spawned earlier added a new `exports` queue, append it: `--queues=extractions,imports,celery,exports`.)

- **No public domain.** Workers don't serve HTTP.
- **No healthcheck.** Celery workers don't expose `/health`.

Rename this service to **`worker`** in the dashboard.

- [ ] **Step 10: Wire `REDIS_URL` as a reference variable on web and worker**

For each of the `web` and `worker` services, in Variables → add:

```
REDIS_URL=${{Redis.REDIS_URL}}
```

(The `${{Redis.REDIS_URL}}` syntax is a Railway "reference variable" — at runtime it expands to the Redis plugin's connection string on the private network. Confirm autocomplete suggests it as you type.)

After saving, both services should auto-redeploy. Watch logs:

```bash
railway logs --service worker
```

Expected: `celery@<hostname> ready.` followed by `Connected to redis://...`.

- [ ] **Step 11: Smoke test the async path end-to-end**

With a valid JWT for `teste@prumo.local`, hit the articles-export endpoint against the Railway URL:

```bash
TOKEN="<jwt>"  # acquire via the test account
PROJECT_ID="<an existing project id>"
curl -X POST "https://<your-service>.up.railway.app/api/v1/projects/$PROJECT_ID/articles/export" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: HTTP 202 with a task id. Then watch the worker:

```bash
railway logs --service worker | grep -i export
```

Expected: a `task_completed` log line for the export task within ~30s. Then refetch the export status endpoint and confirm it returns a signed URL.

If the task hangs in `PENDING`, the worker isn't seeing the broker. Check that the `REDIS_URL` reference variable resolved to a non-empty value on the worker:

```bash
railway run --service worker env | grep REDIS_URL
```

Expected: a `redis://default:...@<railway-private-host>:6379` URL.

- [ ] **Step 12: Confirm Alembic state matches Render**

```bash
railway run --service web alembic current
```

Expected: same revision currently reported by `https://review-hub-backend.onrender.com/health` (or whatever the most recent migration in `backend/alembic/versions/` is). If Railway's revision is *lower*, the first deploy's `alembic upgrade head` failed silently — investigate logs before cutover.

- [ ] **Step 13: Commit nothing**

PR C is infra-only. No code change. Confirm `git status` is clean.

```bash
git status
```

Expected: `nothing to commit, working tree clean`.

---

## Task 4 — PR D: Cutover (Vercel env update + Render suspend)

**No code changes in this repo.** Brief, requires precision, ~30 min total wall time.

**Files:** none

**Rationale:** Flip the frontend pointer; suspend (don't delete) Render so we have a 24h rollback window.

- [ ] **Step 1: Pre-cutover smoke test against Railway (one last time)**

From a logged-in browser session against the test account, hit the Railway URL directly via `curl`:

```bash
curl -fsS https://<railway-url>/health
curl -fsS https://<railway-url>/api/v1/projects -H "Authorization: Bearer $TOKEN"
```

Both 200. If anything's red, STOP — do not cut over.

- [ ] **Step 2: Update `VITE_API_URL` in Vercel**

In the Vercel dashboard → prumo project → Settings → Environment Variables, find `VITE_API_URL`. Note the current value (it should be the Render URL — keep this written down for rollback). Change to:

```
VITE_API_URL=https://<your-service>.up.railway.app
```

Apply to **Production** environment. Trigger a redeploy: Deployments tab → latest production deployment → ⋯ menu → **Redeploy** (uncheck "use existing build cache" so the env var actually takes effect — Vite bakes env vars into the bundle at build time).

- [ ] **Step 3: Wait for the Vercel deploy and verify `VITE_API_URL` is baked in**

Watch the deployment in Vercel. Once it shows READY (~2 min), open the production URL in a browser, open devtools → Network, refresh, and inspect any XHR. The request URL should hit `<railway-url>/api/...`, not Render.

- [ ] **Step 4: Confirm CORS_ORIGINS on Railway already lists the Vercel domain**

```bash
railway variables --service web | grep CORS_ORIGINS
```

Expected: `CORS_ORIGINS=https://prumo-alpha.vercel.app`. If empty or different, set it now (web service variables) — until this matches, the browser will block requests with a CORS error.

- [ ] **Step 5: Run a full smoke test from the browser**

Log in as `teste@prumo.local` / `Senha123`. Walk through:
1. Login completes, projects list loads.
2. Open a project, list of articles loads.
3. Trigger an article export. Confirm the badge transitions Pending → Running → Done within ~60s.
4. Trigger an extraction run. Confirm the AI proposal lands and the UI advances to REVIEW.
5. Spot-check one HITL decision (publish a value) — confirms read+write to `extraction_*` tables.

If any step fails, IMMEDIATELY revert `VITE_API_URL` in Vercel to the Render URL and redeploy (≤5 min recovery). Then debug.

- [ ] **Step 6: Suspend (don't delete) the Render service**

In the Render dashboard → `review-hub-backend` → Settings → **Suspend Service**. This stops compute but keeps the config and disk so we can resume within 24h if needed.

Confirm by curl: `curl -fsSI https://review-hub-backend.onrender.com/health` should now return 5xx or connection refused (depending on Render's behavior for suspended services).

- [ ] **Step 7: Mark cutover complete**

No commit needed. Drop a note in whatever channel tracks deploys (Slack, etc.) — "Backend cut over from Render to Railway at <timestamp>. Rollback window 24h via Render Resume Service."

---

## Task 5 — PR E: Cleanup (delete Render artifacts, commit `railway.toml`, write docs, update memory)

**Branch:** `chore/railway-cleanup` off `dev`

**Files:**
- Delete: `render.yaml`
- Create: `railway.toml`
- Create: `docs/architecture/deployment.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `.claude/commands/preflight.md`
- Rename + rewrite: `~/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/reference_render_deploys_from_main.md` → `reference_railway_deploys_from_main.md`
- Modify: `~/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/MEMORY.md`

**Rationale:** Run only after Task 4 has been stable for at least a few hours — preferably overnight (D+1). Once we delete `render.yaml`, the rollback path narrows from "resume Render service" to "redeploy from a previous commit."

- [ ] **Step 1: Verify Railway has been stable since cutover**

```bash
railway logs --service web | tail -100 | grep -i "error\|exception\|5\d\d"
```

Expected: no error spam in the last hour. If anything's red, STOP — fix forward before cleanup.

Also confirm the test account can still log in and hit at least one endpoint successfully.

- [ ] **Step 2: Delete `render.yaml`**

```bash
git rm render.yaml
```

- [ ] **Step 3: (deferred) ~Delete `backend/.env.render.example`~**

Skipped. The file is gitignored — never tracked in git. The user's local copy can stay or be deleted by them; nothing to do via PR.

- [ ] **Step 4: Create `railway.toml` at the repo root**

Write `railway.toml`:

```toml
# Railway Infrastructure as Code — prumo backend.
#
# Source of truth for build settings. Service-level overrides (worker
# start command, CORS_ORIGINS, REDIS_URL reference variables) live in
# the Railway dashboard per service; the table at the bottom of this
# file documents which keys live where.
#
# To apply this file: install the Railway CLI (`brew install railway`),
# run `railway login`, then `railway up` from the repo root.

[build]
builder = "DOCKERFILE"
dockerfilePath = "backend/Dockerfile"

[deploy]
healthcheckPath = "/health"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3

# -------------------------------------------------------------------------
# Services overview (configured in Railway dashboard, documented here)
#
#   web
#     Region:                US East
#     Builder:               Dockerfile (this file)
#     Healthcheck:           /health (from [deploy] above)
#     Start command:         Dockerfile CMD (gunicorn -k UvicornWorker -w 1 -t 120)
#     Public domain:         yes (generated *.up.railway.app)
#     Variables override:    CORS_ORIGINS=https://prumo-alpha.vercel.app
#                            REDIS_URL=${{Redis.REDIS_URL}}
#
#   worker
#     Region:                US East
#     Builder:               Dockerfile (this file)
#     Healthcheck:           none
#     Start command:         celery -A app.worker.celery_app worker --loglevel=info --queues=extractions,imports,celery
#     Public domain:         no
#     Variables override:    REDIS_URL=${{Redis.REDIS_URL}}
#
#   Redis (managed plugin)
#     Type:                  Database → Redis
#     Region:                US East
#     Exposes:               REDIS_URL on the private network
#
# Project-level shared variables (set in Project Settings → Variables):
#   ENCRYPTION_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#   DATABASE_URL, DIRECT_DATABASE_URL, OPENAI_API_KEY, DEBUG=false,
#   RATE_LIMIT_PER_MINUTE=60, PROJECT_NAME=Prumo API, API_V1_PREFIX=/api/v1,
#   SUPABASE_ENV=production.
# -------------------------------------------------------------------------
```

- [ ] **Step 5: Create `docs/architecture/deployment.md`**

Write `docs/architecture/deployment.md`. The block below uses **four** outer backticks so the nested triple-backtick fences inside the file are preserved verbatim — copy everything between the outer four-backtick markers:

````markdown
# Deployment

Last updated: 2026-05-24.

## Topology

```text
Browser
   │
   ▼
Vercel ─── (VITE_API_URL=https://<web>.up.railway.app) ──▶ Railway web (FastAPI + gunicorn)
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

All three Railway services + the Redis plugin live in the same project, region **US East** (same AZ class as Supabase US East — minimizes DB round-trip latency).

## Services

| Service | Builder | Start | Public | Healthcheck |
|---|---|---|---|---|
| `web` | `backend/Dockerfile` | `alembic upgrade head && gunicorn -k UvicornWorker -w 1 -t 120 -b 0.0.0.0:${PORT:-8000}` (Dockerfile CMD) | yes | `/health` |
| `worker` | `backend/Dockerfile` | `celery -A app.worker.celery_app worker --loglevel=info --queues=extractions,imports,celery` (Railway custom start command — overrides Dockerfile CMD) | no | none |
| `Redis` | Railway managed plugin | n/a | private network only | n/a |

## Environment variables

### Project-level (shared across all services)

| Key | Source |
|---|---|
| `ENCRYPTION_KEY` | rotated by hand; MUST be the same value across web + worker (Zotero credentials are cross-process) |
| `SUPABASE_URL` | Supabase project settings |
| `SUPABASE_ANON_KEY` | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings |
| `DATABASE_URL` | Supabase pooler (used for app traffic) |
| `DIRECT_DATABASE_URL` | Supabase direct (used by Alembic at boot) |
| `OPENAI_API_KEY` | OpenAI dashboard |
| `DEBUG` | `false` |
| `RATE_LIMIT_PER_MINUTE` | `60` |
| `PROJECT_NAME` | `Prumo API` |
| `API_V1_PREFIX` | `/api/v1` |
| `SUPABASE_ENV` | `production` |

### Service-level overrides

| Service | Key | Value |
|---|---|---|
| `web` | `CORS_ORIGINS` | `https://prumo-alpha.vercel.app` |
| `web` | `REDIS_URL` | `${{Redis.REDIS_URL}}` (reference variable) |
| `worker` | `REDIS_URL` | `${{Redis.REDIS_URL}}` (reference variable) |

There is no tracked env template — env files match `.gitignore` line 21 (`.env.*`). This table is the canonical reference; paste the keys directly into the Railway dashboard.

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

- Push to `main` → Railway auto-deploys `web` and `worker` (both services watch the same branch).
- Push to `dev` → no deploy. Use `dev` for staging-style integration; promote to `main` to ship.

(This mirrors the previous Render behavior — see the memory entry `reference_railway_deploys_from_main`.)
````

- [ ] **Step 6: Replace the existing `## 🚢 Deploy` section in `README.md`**

The README already has a `## 🚢 Deploy` section at line 212 — it's in Portuguese, mentions Netlify (we don't use it), and references `VITE_FASTAPI_BASE_URL` (the real variable is `VITE_API_URL`). Replace the entire section (lines 212-247, from `## 🚢 Deploy` through the empty line before `## 📝 Licença`) with:

```markdown
## 🚢 Deploy

Production hosting:

- **Frontend:** Vercel (auto-deploys `main`).
- **Backend (web + Celery worker):** Railway, Hobby plan, US East (auto-deploys `main`).
- **Redis:** Railway managed plugin.
- **Postgres + Auth + Storage:** Supabase.

For topology, the full env var table, migration procedure, and rollback
steps, see [`docs/architecture/deployment.md`](docs/architecture/deployment.md).

Local development uses Docker Compose — see [`docker-compose.yml`](docker-compose.yml).
The dev backend env template lives at
[`backend/.env.example`](backend/.env.example) (the only `.env.*` file
checked into git — production env vars are documented in
[`docs/architecture/deployment.md`](docs/architecture/deployment.md)).
```

Do not touch sibling sections (`## 📝 Licença`, `## 🙏 Agradecimentos`). Out of scope: translating the rest of the README to English — separate sweep.

- [ ] **Step 7: Update `CLAUDE.md` (repo root) Recent Changes**

Open `CLAUDE.md`. Find the `## Recent Changes` section. Insert at the top, before the existing `**2026-05-19**` entry:

```markdown
- **2026-05-24**: Migrated backend hosting from **Render → Railway**.
  Web (FastAPI + gunicorn) + Celery worker + managed Redis on the
  Hobby plan, US East region. The async endpoints
  (`articles_export`, `zotero_import`, `extraction_export`) now work
  in prod — previously blocked on Render free because there was no
  Redis. IaC committed at `railway.toml`. Topology and the canonical
  env-var table live at `docs/architecture/deployment.md` (env files
  are gitignored, so no `.env.railway.example` is tracked). Deletes
  `render.yaml`.
```

- [ ] **Step 8: Update `.claude/commands/preflight.md` `remote-deploys` gate**

Open `.claude/commands/preflight.md`. The `remote-deploys` sub-agent prompt around lines 155-213 currently checks Render. Update:

- Line 155 (comment about Render being indirectly checked): change `Render gate (Render's start command runs alembic upgrade head before gunicorn boots)` → `Railway gate (Railway's Dockerfile CMD runs alembic upgrade head before gunicorn boots)`.
- Line 182: change `Three checks across Vercel and Render:` → `Three checks across Vercel and Railway:`.
- Line 197: change `C. Render — backend health.` → `C. Railway — backend health.`.
- Line 199: change the URL `https://review-hub-backend.onrender.com/health` → `https://<your-service>.up.railway.app/health` (paste the actual Railway URL).
- Line 209: change the `summary:` example `Render /health 200` → `Railway /health 200`.
- Line 213: change `Render: <status code from /health>` → `Railway: <status code from /health>`.

Use exact `Edit` calls for each line — they are not unique strings, so include surrounding context (the lines above and below) to make each replacement match unambiguously.

- [ ] **Step 9: Rename the memory file**

```bash
mv /Users/raphael/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/reference_render_deploys_from_main.md \
   /Users/raphael/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/reference_railway_deploys_from_main.md
```

Then rewrite its contents (use Write, since the file's frontmatter `name:` slug and body both change):

```markdown
---
name: reference-railway-deploys-from-main
description: Railway auto-deploys the backend (web + worker) from `main`. Pushes to `dev` do not ship the backend; merge dev→main to trigger redeploy.
metadata:
  type: reference
---

Railway (Hobby plan, US East) auto-deploys both backend services from
the `main` branch:

- `web` service (FastAPI + gunicorn) — redeploys on every push to `main`.
- `worker` service (Celery) — redeploys on every push to `main`.

Pushes to `dev` do **not** ship the backend. To deploy a change:

1. Land it on `dev` (or open PR to `dev` and merge).
2. Open PR `dev → main`, merge.
3. Railway picks up the push to `main` and rolls out both services
   (web runs Alembic first, then gunicorn; worker boots after).

For the full deployment reference (topology, env vars, rollback),
see [[reference_deployment_doc]] — wait, this is `docs/architecture/deployment.md`
in the repo, not a memory.
```

(If the linker syntax `[[reference_deployment_doc]]` doesn't have a corresponding memory file, that's fine — it just marks something potentially worth memo-ising later.)

- [ ] **Step 10: Update `MEMORY.md` index**

Open `/Users/raphael/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/MEMORY.md`. Find line 4:

```markdown
- [Render deploys from main](reference_render_deploys_from_main.md) — `dev` pushes don't ship the backend; merge dev→main to trigger redeploy
```

Replace with:

```markdown
- [Railway deploys from main](reference_railway_deploys_from_main.md) — `dev` pushes don't ship the backend; merge dev→main to trigger redeploy
```

- [ ] **Step 11: Run the full backend test suite + lint one more time**

```bash
make lint-backend
make test-backend
npm run lint
npm run test:run
```

Expected: all green. None of this PR's changes touch runtime code, so failures would point at unrelated drift.

- [ ] **Step 12: Commit**

```bash
git add railway.toml docs/architecture/deployment.md README.md CLAUDE.md .claude/commands/preflight.md
git rm render.yaml
git commit -m "chore(infra): retire Render config and commit Railway topology

- Delete render.yaml (superseded by Railway after the 2026-05-24 cutover).
- Add railway.toml as IaC source of truth for build settings; document
  service-level overrides + project-level shared vars inline.
- Add docs/architecture/deployment.md with topology diagram, env var
  table (canonical reference — env files are gitignored), migration
  procedure, and rollback steps.
- README.md: refresh Deployment section pointing at the new doc.
- CLAUDE.md: log the Render → Railway migration in Recent Changes.
- .claude/commands/preflight.md: repoint the remote-deploys gate's
  health check from Render to Railway."
```

- [ ] **Step 13: Push and open PR E**

```bash
git push -u origin chore/railway-cleanup
gh pr create --base dev --title "chore(infra): retire Render config and commit Railway topology" --body "$(cat <<'EOF'
## Summary
- Delete `render.yaml` — superseded by Railway after the 2026-05-24 cutover.
- Add `railway.toml` (IaC for build settings; documents per-service overrides + project-shared vars inline).
- Add `docs/architecture/deployment.md` (topology, env var table, migrations, rollback). This is the canonical env-var reference — env files are gitignored, so no tracked `.env.railway.example` exists.
- `README.md`: refresh Deployment section.
- `CLAUDE.md`: Recent Changes entry for 2026-05-24.
- `.claude/commands/preflight.md`: repoint `remote-deploys` health check to Railway.

Run only after the Railway cutover has been stable for at least a few hours — narrows the rollback path from "resume Render service" to "redeploy from previous commit".

## Test plan
- [x] `make test-backend` + `make lint-backend` green
- [x] `npm run test:run` + `npm run lint` green
- [x] Manual: open `docs/architecture/deployment.md` in a markdown preview, confirm diagram renders
- [x] Manual: `preflight` skill loads without error (the YAML inside the markdown is unchanged in shape)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 14: Update the memory MEMORY.md index** (already in step 10, but verify the index actually changed)

```bash
grep -n "reference_railway_deploys_from_main\|reference_render_deploys_from_main" /Users/raphael/.claude/projects/-Users-raphael-PycharmProjects-prumo/memory/MEMORY.md
```

Expected: one hit on `reference_railway_deploys_from_main.md`, zero hits on `reference_render_deploys_from_main.md`.

- [ ] **Step 15: Merge PR E to `dev`, then merge `dev` → `main`**

After `dev → main` merge, Railway will auto-deploy. Since this PR has no code changes that affect runtime, the deploy should be a no-op (same Dockerfile, same `CMD`). Watch `railway logs --service web` for the boot sequence to confirm.

---

## Task 6 — Decommission Render (D+2, after PR E is merged and stable)

**No code changes.** Final step — irreversibly delete the Render service.

**Files:** none

- [ ] **Step 1: Confirm 24+ hours have passed since cutover with no rollback**

If Railway has had any reliability incidents in the past 24h, defer this task until they're resolved. No rush.

- [ ] **Step 2: Confirm `render.yaml` is gone from `main`**

```bash
git ls-tree --name-only origin/main | grep -E 'render\.yaml'
```

Expected: empty output. (`backend/.env.render.example` was always gitignored — never in `main` to begin with.)

- [ ] **Step 3: Delete the Render service**

Render dashboard → `review-hub-backend` → Settings → scroll to **Delete Service** → confirm.

- [ ] **Step 4: Revoke the GitHub deploy webhook that was pointing at Render**

In the GitHub repo Settings → Webhooks, find any webhook with URL like `https://api.render.com/...` and delete it. Railway uses its own webhook, which was installed during Task 3 step 2.

- [ ] **Step 5: Cancel any standing Render billing**

If the account was on a paid plan (Hobby/Pro), cancel under Render → Account Settings → Billing.

- [ ] **Step 6: Final smoke test**

Once more, log in to `https://prumo-alpha.vercel.app` as `teste@prumo.local`, click around, confirm everything still works. This is the moment to catch any lingering Render dependency that nobody documented.

If anything breaks, the rollback path is now "revert to a commit before PR E and provision a new Render service from scratch" — slow but possible.

---

## Self-review notes (already applied)

- **Spec coverage:** All three Tracks from the planning summary map to Tasks 1-6. Track 1 → Tasks 1, 2, 3, 4, 6. Track 2 → Task 5. Track 3 → Tasks 1 (PR A's worker cleanup), 5 (config + docs cleanup).
- **Out-of-scope items the user flagged:** the "review-hub" container name in `docker-compose.yml` is intentionally NOT in this plan — it's purely cosmetic and a separate sweep. Same for backend/README.md line 112-113.
- **One real bug found during planning:** `extraction_export_tasks` not in `celery_app.include`. Spawned as a separate task chip — fix before cutover so the Railway worker doesn't inherit a broken state.
- **Placeholder scan:** none — every code/config block has its actual content.
- **Type consistency:** service names `web` and `worker` are used identically across Tasks 3-6. The Railway URL placeholder `<your-service>.up.railway.app` is left as a placeholder because Railway generates it at provisioning time — engineer fills in once they have it.

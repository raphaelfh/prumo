---
name: deploy-release
description: Runbook for shipping prumo to production — promoting dev to main, Railway deploy mechanics (Wait-for-CI, SKIPPED-SHA recovery), Supabase auth/storage migration deploys, env-var rotation, and rollback. Invoke manually with /deploy-release when deploying, promoting, or recovering a stuck deploy.
disable-model-invocation: true
---

# Deploy & Release (prumo)

Production topology: **Railway** (FastAPI web + Celery worker + Redis,
deploys from `main`) · **Vercel** (frontend, deploys from `main`,
`VITE_API_URL` → Railway web) · **Supabase** (Postgres + Auth +
Storage). Prod URLs: backend `https://web-production-48b398.up.railway.app`,
frontend `https://prumoai.vercel.app`.

## Normal release

1. Everything lands on `dev` via squash-merged PRs behind the 8
   required checks.
2. Pre-deploy gate: run `/preflight` (read-only; probes Vercel,
   Supabase advisors, Railway health).
3. Promote: `git push origin dev:main` (fast-forward). `main` branch
   protection requires the 8 check contexts on the SHA — the dev push
   run already attached them, so a green dev HEAD promotes cleanly;
   an unverified SHA is rejected.
4. Railway (GitHub App) waits for the full Actions suite — **CI and
   docs-ci** — on the main push, then builds web + worker. The web
   container runs `alembic upgrade head` before gunicorn, so app-schema
   migrations deploy atomically with code.
5. Vercel builds the frontend from `main` independently.
6. Post-deploy: the `post-deploy-smoke` workflow (push-triggered +
   hourly) checks `/health`, the frontend, and a CORS preflight from
   the prod origin. A failure emails the owner.

## Supabase (auth/storage) migrations — NOT auto-deployed

Only Alembic runs on deploy. `supabase/migrations/*.sql` must be
pushed explicitly:

```bash
cd supabase && supabase db push   # links to the remote project
```

Never apply them via the Supabase MCP `apply_migration` (records a
non-matching version → a later `db push` re-runs and errors). This is
hook- and permission-enforced, not just convention.

## Stuck deploy: the SKIPPED-SHA failure mode

If a workflow on the main push reports SKIPPED (e.g. path-filtered
docs-ci), Railway's Wait-for-CI can wedge — and it does **not**
self-heal when you re-run the job. Recovery, in order:

1. Push any newer commit to `main` (empty commit is fine:
   `git commit --allow-empty -m "chore: nudge railway wait-for-ci"`).
2. Or deploy directly: `railway up` **from the repo root**. The
   `backend --path-as-root` form documented in older notes is broken
   (also blocked by the bash-guard hook).

Detection: the post-deploy-smoke workflow catches the symptom
(stale prod while CI is green).

## Rollback

- Fast (≤2 min): Railway dashboard → service → Deployments → Redeploy
  the last green image.
- Slow: `git revert` the offending commit on `main` and let the
  pipeline redeploy.

## Env vars

- Canonical table: `docs/reference/deployment.md`. Env files are
  gitignored — nothing to commit.
- Railway shared variables need a per-service value + service restart
  (CLI `${{shared.X}}` resolved empty — known gotcha).
- Vercel: the Supabase integration is inert for this Vite app — the
  frontend reads separate `VITE_*` copies, so key rotation requires a
  manual `VITE_*` update + prod rebuild. Never widen `envPrefix`
  (would leak service-role/JWT/POSTGRES_PASSWORD into the bundle).

## Railway CLI notes

- MCP token can expire while the CLI still works; verify the worker
  with `railway logs --service worker` (look for "Connected to
  redis://").

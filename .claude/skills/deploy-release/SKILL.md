---
name: deploy-release
description: Runbook for shipping prumo to production — promoting dev to main, Coolify deploy mechanics (builds main on push, web + worker), Supabase auth/storage migration deploys, proving the promoted build is live, env-var rotation, and rollback. Invoke manually with /deploy-release when deploying, promoting, or recovering a stuck deploy.
disable-model-invocation: true
---

# Deploy & Release (prumo)

Production topology: **Coolify** on a Hostinger VPS (`prumo-web` FastAPI,
`prumo-worker` Celery, `prumo-redis`; builds from `main`) · **Vercel**
(frontend, deploys from `main`, `VITE_API_URL` → `prumo-web`) ·
**Supabase** `pwtaciozopymgcwimxxh`, `sa-east-1` (Postgres + Auth +
Storage). Prod URLs: backend `https://prumo-api.healthnumbers.com.br`,
frontend `https://prumoai.vercel.app`. Topology, env vars and the reasons:
`docs/reference/deployment.md`, ADR 0024.

## Normal release

1. Everything lands on `dev` via squash-merged PRs behind the 8
   required checks.
2. Pre-deploy gate: run `/preflight` (read-only; probes Vercel,
   Supabase advisors, the Coolify backend).
3. Promote via a **merge-commit PR** — `dev → main` cannot fast-forward
   (`main` carries the `Merge pull request #NNN from raphaelfh/dev`
   commits dev lacks, so `git push origin dev:main` is rejected as
   non-fast-forward):

   ```bash
   gh pr create --base main --head dev --title "Promote dev to main"
   gh pr merge <n> --auto --merge   # merge commit — NOT squash, NOT fast-forward
   ```

   `main` branch protection requires the 8 check contexts green on the
   head before the merge completes; the dev HEAD already carries them.

   The PR's head is the `dev` branch, not a SHA: it ships whatever `dev`
   holds when it merges. Describe the payload as "everything on dev as of
   merge"; quote a commit count only from
   `git log --oneline <merge>^1..<merge>^2` after the merge. Every check
   listed twice on the PR means the head moved. While a peer's promotion
   PR is open, arm no `dev` PR of your own: run
   `gh pr list --state open --json number,title,autoMergeRequest` in the
   same step as `gh pr merge --auto`.

   Before promoting a column or table drop,
   `git grep -n "<column>" origin/main -- 'frontend/**'` for PostgREST
   reads. Vercel and Coolify deploy independently and cached bundles
   outlive the deploy, so the frontend stops reading it first (deploy
   Vercel before the backend, or ship the frontend change a release earlier).
4. Coolify (repository webhook) builds `backend/Dockerfile` on the main push,
   once per application: **two** deployments, `prumo-web` and
   `prumo-worker`, on the VPS. It does not wait for CI — the required
   checks already gated the promotion PR. The web container runs
   `alembic upgrade head` and the seed before gunicorn, so app-schema
   migrations deploy atomically with code.
5. Vercel builds the frontend from `main` independently (Ready within
   about a minute, long before the backend).
6. The Supabase GitHub integration deploys `supabase/migrations/*.sql`
   on the same push (next section).
7. Prove the promoted build is live (§ Verify prod).

## Supabase (auth/storage) migrations — deployed by the main push

The Supabase GitHub integration applies `supabase/migrations/*.sql` on
every `main` push. Its `Supabase Preview` check is **not** a required
context, so a red one leaves the promotion green: after a promotion
touching `supabase/`, read it on the main SHA
(`gh api repos/raphaelfh/prumo/commits/<sha>/check-runs`).

Never apply them via the Supabase MCP `apply_migration`: it stamps a
timestamp version that matches no file, and every later deploy fails on
the ledger mismatch. This is hook- and permission-enforced.

## Verify prod

The `post-deploy-smoke` workflow (job `Prod reachability` in a commit's
check-runs) proves reachability, not the build: push and
`workflow_dispatch` runs only warn on a commit mismatch, and only the
6-hourly scheduled run fails on it. Prove it yourself:

- Capture prod's `/health.commit` **before** promoting. After both
  Coolify deployments finish, `/health.commit` equals the new main SHA
  **and** differs from the captured one. It reads `SOURCE_COMMIT`;
  `unknown` means "Include Source Commit in Build" is off on `prumo-web`.
- Coolify state per application: the `coolify` MCP
  (`search_resources` query `prumo` for status, `list_deployments` +
  `get_deployment` with `include_log_summary=true` for the in-flight
  build). The dashboard shows the same per application.
- Worker: Celery logs `celery@<host> ready.` once per process, so after
  a Redis reconnect a healthy worker's tail stays silent. A log check
  cannot tell recovered from failing: ask the user to authorize a
  restart of `prumo-worker` (Coolify `control` action `restart`), then
  confirm the fresh boot block ends in `ready.`.
- Frontend: `vercel inspect <url> --cwd <main checkout>` (target
  production, Ready, prod alias) plus the GitHub `Vercel` status on the
  promoted SHA. Prove the content with a two-sided grep of the live
  chunks: the new string present **and** the replaced one absent. Copy
  lives in `assets/copy-*.js`, the minifier emits backtick strings, and
  an unknown `/assets/x.js` answers 200 with `index.html`, so check
  `content-type`. To prove the exact build, rebuild the promoted SHA and
  `cmp` its `dist/assets/index-*.css` against prod's (CSS ignores env;
  JS hashes always differ because `VITE_*` is baked in).
- Fetch `prumoai.vercel.app` a few times, never in a loop: polling earns
  the IP a 403 Security Checkpoint (`x-vercel-mitigated: challenge`),
  and a content grep then reports every string missing. Check the
  status code before reading content.
- API change: probe `/api/v1/openapi.json` for the new route.

## Stuck or failed deploy

Detection: `/health.commit` stays on the old SHA after the deploy window
(§ Verify prod); the scheduled smoke run is the alarm.

1. Read the newest `prumo-web` deployment (`list_deployments`,
   `get_deployment` with `include_log_summary=true`). A failed build or a
   boot that exits (Alembic, seed) is fixed forward with a PR.
2. No deployment started for the main SHA (webhook missed): ask the user
   to authorize a Coolify `deploy` of `prumo-web` and `prumo-worker`. It
   builds the current `main` head, so it ships only what was already promoted.

## Rollback

- No migration in the promoted range: roll each application back to
  its previous image (Coolify dashboard → application → Deployments →
  Rollback, or the MCP `list_rollback_images` + `rollback_application`
  after the user authorizes it).
- A migration ran: an older image crash-loops, because
  `check_pending_migrations` (`backend/app/main.py`) exits when the DB
  head is unknown to its code. Roll forward with a fix, or hand-run
  `alembic downgrade <prev>` first and then redeploy the old image.
- Slow: `git revert` the offending commit on `main` and let the
  pipeline redeploy.

## Env vars

- Canonical table: `docs/reference/deployment.md`. Env files are
  gitignored — nothing to commit.
- Backend values shared by web and worker are Coolify environment-level
  Shared Variables, referenced in each application as
  `{{environment.KEY}}`. A changed value reaches a container only after
  that application is redeployed.
- Vercel: the Supabase integration is inert for this Vite app — the
  frontend reads separate `VITE_*` copies, so key rotation requires a
  manual `VITE_*` update + prod rebuild. Never widen `envPrefix`
  (would leak service-role/JWT/POSTGRES_PASSWORD into the bundle).

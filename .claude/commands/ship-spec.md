---
description: Drive a spec from brainstorm to a chosen ceiling — dev (PR open + auto-merge armed) or prod (promote to main) — through plan → adversarial review → TDD execution → harden → ship, gated on green evidence. The ceiling is chosen once at invocation; prod never promotes on a red signal.
argument-hint: "<spec-ref or description> [--to dev|prod] [--from-plan <path>] [--no-worktree] [--no-automerge] [--confirm-promote] [--dry-run]"
allowed-tools:
  - Task
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - AskUserQuestion
  - Bash(git:*)
  - Bash(gh:*)
  - Bash(make:*)
  - Bash(npm run*)
  - Bash(uv run*)
  - Bash(cd backend*)
  - Bash(curl:*)
  - Bash(railway:*)
  - mcp__Claude_Preview__preview_start
  - mcp__Claude_Preview__preview_screenshot
  - mcp__Claude_Preview__preview_snapshot
---

# /ship-spec — spec → chosen ceiling

User-supplied arguments: `$ARGUMENTS`

You are running prumo's **spec-to-ship pipeline**. You do not own any
methodology yourself — you are the *orchestrator* that composes the
project's existing skills in order, injects the prumo-specific gotchas,
and enforces two things the individual skills do not:

1. **The autonomy ceiling** — `dev` or `prod`, chosen once below and
   then a hard guard, not a reminder. A `dev` run physically cannot
   touch `main`.
2. **Evidence gates** — every promotion proceeds only on fresh green
   evidence you captured and read. A red or unknown signal HALTS the
   run; it never promotes on a bad signal.

> Iron law (`verification-before-completion`): no "done", "passing", or
> "safe to ship" without fresh output you ran and read. A described gate
> is not a passed gate.

Create one todo per phase below before you start, and a sub-todo per
task in Phase 3.

---

## Phase 0 — Parse arguments and lock the ceiling

From `$ARGUMENTS` compute:

- **subject** — the first non-flag token(s): a path to a written spec
  (`docs/.../spec.md`) or an inline description. Required. If absent,
  ask the user what to build, then stop.
- **TARGET** — `prod` if `--to prod` is present, else `dev`. **If
  `--to` is absent, ask once with `AskUserQuestion`** (options: `dev`
  — recommended, stop at PR; `prod` — promote to main). Default is
  `dev`.
- `--from-plan <path>` — an approved plan already exists; skip Phases 1
  and the plan-writing half of 2, start the panel review on that plan.
- `--no-worktree` — work in the current checkout (default: isolate).
- `--no-automerge` — open the dev PR but do not arm auto-merge.
- `--confirm-promote` — even on all-green evidence, pause for one human
  OK right before `dev → main` (default: green evidence auto-proceeds).
- `--dry-run` — run every read-only gate and print what *would* happen
  at each write/promote step, but make no commit, push, PR, or deploy.

**Announce the locked plan in one line**, e.g.:

> Ceiling = prod · subject = ADR-0013 stored-markdown tier · worktree on · auto-merge armed · evidence-gated.

`TARGET` is now immutable for the rest of the run. Treat any later
instinct to "just also merge to main" on a `dev` run as a bug.

## Phase 1 — Frame (skip if `--from-plan`)

- If **subject** is not already a written, agreed spec, run
  `superpowers:brainstorming` to turn it into one. Surface ambiguous
  requirements — do not choose silently (CLAUDE.md working principle).
- Unless `--no-worktree`, create an isolated workspace with
  `superpowers:using-git-worktrees`. Remember the worktree gotchas:
  install deps from the **parent** checkout (a worktree-local
  `node_modules` duplicates React); frontend tooling runs from the
  **repo root** (no `frontend/package.json`).
- Decide slicing: one PR, or a phased stack? State the checkable goal
  and the verify step for each slice. If phased, this run ships slice 1;
  the rest queue.

## Phase 2 — Plan, then survive an adversarial panel

1. Run `superpowers:writing-plans`. Every step must carry its own
   failing test + verify step (no step is "do X" without "prove X").
2. **Adversarial multi-lens review.** Dispatch parallel `Task`
   sub-agents (`subagent_type: general-purpose`) in a single message —
   one per lens, each handed the plan and told to find what kills it:
   - **constitution / layering** — typed boundaries, no layer leak
     (`docs/reference/constitution.md`).
   - **security / RLS / BOLA** — project-membership scoping, run-state
     TOCTOU, the recurring incident classes in `code-review`.
   - **migration-safety** — any SQLAlchemy model change ⇒ Alembic
     migration; revision id ≤ 32 chars; the `test_migration_roundtrip`
     head-pin + `downgrade -1` guards break when a migration is added.
   - **simplicity / YAGNI** — could 200 lines be 50? cut speculation.
   - **test-coverage** — diff-cover 80; the **ASGI blind spot** (endpoint
     handler lines via httpx ASGITransport don't register — needs direct
     endpoint-coroutine unit tests, not just integration).
   Reconcile the verdicts, revise the plan, and only proceed when the
   panel has no blocking objection. State what changed.

## Phase 3 — Execute (loop per task, test-first)

For **each** task in the plan, in order:

- Load the right domain skill: `backend-development` (FastAPI /
  SQLAlchemy / Alembic / Celery / RLS), `frontend-development`
  (components / hooks / TanStack / stores / forms), `ui-styling` +
  `frontend-ux` (visual), `web-testing` (test patterns).
- **TDD-first** (`superpowers:test-driven-development`): write the
  failing test for this task *first*, at the right layer. Interleave
  tests at every layer — **never batch them at the end** (this is an
  explicit, repeated project correction).
- Implement the minimum that makes it pass (YAGNI).
- **Clean in the code you touch** — no new legacy grandfathered; flag
  (don't delete) unrelated dead code. If you touch a model, generate the
  Alembic migration now and bump the roundtrip head-pin in the same
  change.
- Per-task checkpoint: `superpowers:requesting-code-review` on that
  task's diff. If it's a frontend screen, also run `/design-review`.

Respect the React Compiler rule throughout: no `try/finally` / `throw`
in component bodies; IO errors go through `ErrorResult`/`toResult`; all
copy through `frontend/lib/copy/`.

## Phase 4 — Harden the whole diff (the Iron Law gate)

1. `/simplify` — reuse, dedupe, altitude cleanups (quality only).
2. `architectural-quality-loop` on the touched slice — drift + legacy
   eviction, **verified**, not a vibe. Zero legacy left for later.
3. `code-review` (full prumo checklist: BOLA, run-state TOCTOU, error
   swallowing, schema drift, ApiResponse envelope drift, stale TanStack
   cache) + `/security-review` on risk-sensitive paths.
4. `superpowers:verification-before-completion`: run the real gate and
   **read the output** —
   ```
   make quality-scan        # lint + typecheck + tests + arch fitness
   ```
   plus the backend / frontend suites the diff touches. Diff-cover 80
   ⇒ add the direct endpoint-coroutine unit tests if the diff is an
   endpoint (ASGI blind spot). **Any red here HALTS the run** — fix and
   re-verify; do not proceed on "should pass".

## Phase 5 — Ship to dev

- Commit (conventional commit) and `git push origin <branch>`. Open the
  PR → `dev`: `gh pr create --base dev ...`.
- Wait for the **8 required checks**. Unless `--no-automerge`, arm
  `gh pr merge --auto --squash`.
- **Ceiling guard:** if `TARGET == dev`, **STOP**. Report the PR URL,
  the CI state, and whether auto-merge is armed. The run is complete;
  you do **not** continue to Phase 6. (`--dry-run`: print the PR/commit
  you would create and stop here regardless of ceiling.)

## Phase 6 — Promote to prod (only if `TARGET == prod`)

1. Wait for the dev PR to actually squash-merge and `dev` to go green.
2. Run `/preflight` (read-only: Vercel, Supabase advisors, Railway
   health, local gate). **Evidence gate:** if the verdict is anything
   other than GREEN (any FAIL / UNKNOWN), **HALT and report** — do not
   promote. `--dry-run` also stops here after preflight.
3. If `--confirm-promote`, ask the user once before promoting. Otherwise
   green evidence auto-proceeds — the unattended `--to prod` you opted
   into at invocation.
4. **Promote — merge-commit PR (auto).** Only on a GREEN preflight (any
   red already HALTED in step 2), run the promotion directly:

   ```bash
   gh pr create --base main --head dev --title "Promote dev to main"
   gh pr merge <n> --auto --merge   # merge commit — NOT squash, NOT fast-forward
   ```

   `dev → main` cannot fast-forward (`main` carries merge commits dev
   lacks), so it is always a merge-commit PR — never `git push origin
   dev:main`. Then watch the Railway deploy: it waits for the **full**
   Actions suite (CI **and** docs-ci); on a SKIPPED-SHA wedge recover per
   the `deploy-release` skill (push a newer commit, or `railway up` from
   the repo root). `deploy-release` stays the source of truth for the
   recovery + rollback nuances; only the promotion command is inlined
   here so the `--to prod` run completes unattended.

## Phase 7 — Verify in prod (only if promoted)

Evidence, not assertion:

- `curl -fsS -o /dev/null -w "%{http_code}" https://web-production-48b398.up.railway.app/health` → expect 200.
- Confirm `post-deploy-smoke` is green (health + frontend + CORS
  preflight from the prod origin).
- Run the Playwright E2E smoke for the shipped feature (`web-testing`),
  but serve the frontend on a **local server** instead of loading the
  Vercel deployment in a browser. Keep the prod-targeting `remote-smoke`
  project (it exercises the prod backend with the designated test account
  and is non-destructive); only override its frontend origin to local:
  1. `npm run dev` — serve the frontend on `http://127.0.0.1:8080` (built
     from the promoted `main` commit, with the `VITE_*` env aimed at the
     prod backend + Supabase).
  2. `E2E_FRONTEND_URL=http://127.0.0.1:8080
     E2E_API_URL=https://web-production-48b398.up.railway.app
     npm run test:e2e:remote` — the browser loads the **local** frontend
     while the auth/extraction assertions run against the prod backend, so
     the deployed backend, DB, and data path are still verified end-to-end.

  Do **not** point `E2E_FRONTEND_URL` at `https://prumoai.vercel.app`:
  driving a browser against `*.vercel.app` is blocked by the org browser
  policy, and the deployed frontend bundle's reachability is already
  covered by `post-deploy-smoke` (step 2). Do **not** substitute
  `npm run test:e2e:local` — those projects self-provision and hard-reset
  fixtures, so against the prod backend they would mutate prod data.
- Finish with a `/design-review` pass on the user-facing surface if one
  changed.

## Phase 8 — Verdict

End with one block:

- `## RESULT: SHIPPED TO DEV` — PR URL + CI state + auto-merge status; or
- `## RESULT: SHIPPED TO PROD` — main SHA + Railway/Vercel deploy state +
  `/health` code + E2E result; or
- `## RESULT: HALTED AT <phase>` — the red/unknown evidence verbatim and
  exactly what to fix to resume.

Report faithfully: if a step was skipped, say so; if a gate failed, show
the output. Never assert a green you did not capture. If the work was a
phased slice, name the next slice.

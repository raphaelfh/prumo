---
status: stable
last_reviewed: 2026-09-21
owner: '@raphaelfh'
---

# prumo Development Guidelines

## Reporting

When reporting information to me, be extremely concise and sacrifice grammar for
sake of concision.

## Working principles

- **Surface ambiguity; don't choose silently.** Multiple readings or a simpler
  path → say so, push back with evidence. The call is the user's → ask.
  Otherwise act. Feature/creative work starts with `superpowers:brainstorming`.
- **YAGNI.** Minimum code for the asked problem; complexity beyond a principle
  must be justified (constitution §Governance).
- **Structural fix over minimal patch; dead code is deleted, never flagged.**
  A replacement deletes the path it replaces in the same PR. Orphans found
  outside the task go in a sibling `refactor(<area>): ...` commit — stale code
  is context agents read as live.
- **Red first, evidence before "done".** Failing test → pass; run the command
  and read the output (`verification-before-completion`).
- **AI decisions are traceable** (constitution §IX): every suggestion records
  its generation snapshot; human selections are append-only; "no information" is
  a recorded proposal, not a silent drop.

## Skills

Project skills live in `.claude/skills/` and trigger on their descriptions.
Requires the **superpowers** plugin (6.x, declared in `.claude/settings.json`);
prumo skills defer generic process to it.

## Stack

FastAPI + SQLAlchemy 2 async + Alembic + Celery/Redis on **Railway**;
Postgres/Auth/Storage on **Supabase**; React 19 + Vite + TanStack Query +
Zustand + shadcn on **Vercel**. In-house i18n at `frontend/lib/copy/` (no i18n
lib).

## Layout gotchas

- Frontend tooling runs from the **repo root** (`package.json`,
  `vite.config.ts`, `vitest.config.ts`). There is no `frontend/package.json` —
  never `cd frontend && npm ...`.
- `.claude/hooks/post-edit-format.sh` runs `ruff check --fix` / `eslint --fix`
  after every Edit/Write: add an import in the same edit as its first use (else
  it is stripped as unused); enable an eslint rule before adding
  `eslint-disable` directives for it.
- `supabase/` = **auth/storage migrations only**; app schema is Alembic
  (`backend/alembic/versions/`).

## Commands

- `make start` / `make stop` — local stack (Supabase + backend + frontend)
- `make test-backend` (needs local Supabase Docker) · `make lint-backend`
- `npm run test:run` / `npm run lint` — frontend, from repo root
- `make quality-scan` — full gate (lint + typecheck + tests + fitness)
- `make db-fresh` — migrate + seed; prefer over `make reset-db`. Both wipe the
  ONE local Supabase stack every session and worktree shares — coordinate first
  (`.claude/rules/backend.md` § Local database)

## Read before touching

Changing `extraction_*` tables, `/api/v1/runs/...`, or `/api/v1/hitl/sessions` →
read first:

- [`docs/reference/extraction-hitl-architecture.md`](docs/reference/extraction-hitl-architecture.md)
  — schema
- [`docs/reference/migrations.md`](docs/reference/migrations.md) — migrations,
  RLS conventions
- [`docs/reference/constitution.md`](docs/reference/constitution.md) — layering,
  typing

Doc index: [`docs/README.md`](docs/README.md).

## Hard rules

- **English only** — code, comments, commits, docs, copy keys.
- **Model change ⇒ Alembic migration**
  (`cd backend && alembic revision --autogenerate -m "..."`). Never apply
  app-schema DDL through the Supabase MCP.
- **Seed via `cd backend && uv run python -m app.seed`**, never in migrations.
- **No dead code ships (CI-gated).** Frontend: `npx knip` and
  `npx knip --production` both at zero; exceptions in `knip.jsonc` with a
  reason; triage `--production` per
  `.claude/skills/frontend-development/references/dead-code.md`. Copy keys:
  `scripts/fitness/check_copy_keys.py`. Backend: vulture shrink-only baseline
  (`backend/.vulture_baseline`); tighten it in the same PR as the deletion.
- **One ownership predicate, in the WHERE clause** (BOLA). Gate:
  `scripts/fitness/check_scope_guards.py`; rules:
  `.claude/rules/backend.md` § Ownership guards.
- PRs target `dev`, squash-merged, conventional commits.
- No changelogs in AGENTS.md — history is `git log` + `docs/adr/`.

## Branch & merge

- `dev` stays strict (up-to-date required) — don't relax it.
- **One armed auto-merge at a time** (`/merge-train`); arm the next only after
  the current lands. Squash with `--subject "<conventional title>"` when the
  branch tip is a merge commit.
- Unstick a `BEHIND` PR with `gh api -X PUT .../pulls/<n>/update-branch` — never
  hand-rebase, never `@dependabot rebase` a grouped PR.
- Promotion `dev → main` is hook-enforced (`.claude/hooks/bash-guard.sh`) via
  `/ship-spec` with `ceiling=prod`.

## Worktrees

- Scope concurrent agents to non-overlapping paths/worktrees.
- Never `git switch`/`checkout` in the main checkout — another session may be
  live there. Move a file out: `git -C <main> diff -- <file> > p`,
  `git worktree add <path> -b <branch> dev`, then `git apply --3way p` there.
- Subagents start in the main checkout. Name the absolute worktree path in
  every brief, require `git -C "$WT"`, translate agent-reported paths before
  editing, and confirm with `git -C "$WT" status` that edits landed there.
- Give a worktree its own `node_modules` with `npm ci`; a symlink to the main
  checkout's is emptied by the first `npm run`. Copy the gitignored root `.env`
  and `backend/.env` only for a dev server or E2E, then restart Vite.
- Remove a worktree once its PR merges, from the main checkout — else its
  skills register twice. Squash-merge makes `git branch -d` refuse and
  `git branch --merged` lie: confirm MERGED with `gh pr view <n> --json state`,
  then `git worktree remove` + `git branch -D`.

## Compaction

Preserve: active `/ship-spec` ceiling and run-state path
(`<main>/.superpowers/ship-spec/<basename>/state`); spec, plan, ledger paths;
modified files; every test/gate command with last result and SHA; open questions
and rulings. Drop raw tool output. After compaction, trust the ledger and
`git log` over recollection.

## graphify

If `graphify-out/graph.json` exists, answer symbol questions with
`graphify explain "<Symbol>"`, `graphify affected "<Symbol>"` or
`graphify path "<A>" "<B>"`, using exact node labels (functions carry `()`).
`graphify query` matches labels, not meaning — grep prose questions. No edge
crosses frontend↔backend: answer hook↔endpoint questions with grep plus
`frontend/types/api/schema.d.ts`. After code changes: `graphify update .`.
Opt-in setup:
`uv tool install graphifyy && graphify install && graphify update .`.

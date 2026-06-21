---
status: draft
last_reviewed: 2026-06-10
owner: '@raphaelfh'
---

# Dev-Workflow State-of-the-Art Plan (mid-2026)

Goal: make the entire prumo development workflow state-of-the-art for
agentic ("vibe coding") development as of mid-2026 — as robust as
possible while optimizing for simplicity and flow.

Method: 7 parallel repo audits (context engineering, skills portfolio,
hooks/permissions, CI/CD, testing, agent-readability, docs/knowledge)
cross-referenced with 4 web-research sweeps (Anthropic Claude Code
guidance, spec-driven development, agentic verification, 2026 trends),
then adversarially triaged against two lenses: simplicity/flow and
robustness (would it have prevented a real past incident?).

## Guiding principles (the justification layer)

1. **Context window is the scarcest resource.** CLAUDE.md under ~200
   lines, pointers not content, path-scoped `.claude/rules/` for the
   backend/frontend split. (Anthropic: effective-context-engineering,
   Sep 2025; code.claude.com/docs/en/memory.)
2. **Guardrails are hooks, not prose.** CLAUDE.md and skills are
   advisory; hooks fire deterministically. Every rule that has been
   violated before must become a hook or CI gate. (Anthropic
   hooks-guide; Spotify Honk: deterministic verifiers + stop hook.)
3. **Deterministic gates first, LLM judge second.** Never ask a model
   what pytest can answer; reserve LLM judgment for scope creep and
   intent match. (Spotify Honk vetoes ~25% of agent sessions; the
   repo's own architectural-quality-loop already embodies this.)
4. **Tests are the only spec that can't drift.** Integration-first;
   evidence (pasted test output, screenshots) over assertions.
   AI-authored PRs average ~68% more issues than human PRs, skewed to
   integration seams (twocents, Feb 2026).
5. **One spec system, explicit lifecycle.** Plan-mode for ~80% of
   work; superpowers brainstorm→plan only for multi-session or
   schema-touching work; archive plans on merge and fold durable
   decisions into reference docs in the same commit (OpenSpec
   delta-merge lesson).
6. **Solo dev: PR ceremony died, the gate survived.** No human second
   reviewer — CI + an automated agent reviewer is the second pair of
   eyes; auto-merge behind required checks. (2026 consensus.)
7. **Agent-legible architecture: invariants in schema/types, not
   convention.** prumo's entity-role migration (0016) is the canonical
   example — generalize it (OpenAPI-generated TS types next).
8. **Self-healing repo.** Scheduled agent routines for dependency
   bumps, doc-drift detection, memory consolidation (Claude Code
   Routines, Apr–May 2026; Copilot Automations, Jun 2026).

## Phase 0 — Context & skills cleanup (≈1 day; mostly deletion)

The audit found the always-loaded layer is ~19KB with 71% of root
CLAUDE.md an outdated changelog, contradictory pointers, and a dead
spec system still installed.

- **CLAUDE.md consolidation.** Delete the "Recent Changes" changelog
  (lines 69–174; stale since 05-24, misinforms about squashed
  migration numbers) → replace with a 3–5-line "Current state" block
  pointing at the active workstream (data-path consolidation). Delete
  the SPECKIT footer that points every session at an ARCHIVED plan
  that llms.txt forbids reading. Merge `.claude/CLAUDE.md` into root
  (≈43% is duplicated and already drifting); move backend-only rules
  (Alembic-vs-Supabase split, seeding) into `.claude/rules/backend.md`
  with `paths: backend/**` frontmatter and frontend conventions into
  `.claude/rules/frontend.md`. Fix stale facts (`docs/planos/`,
  `docs/architecture/` don't exist; Cursor frontmatter cruft; seed
  command is `cd backend && uv run python -m app.seed`). Target: one
  ~100-line root file.
- **Delete the dead speckit system.** All 9 `.claude/skills/speckit-*`
  dirs (spec-kit era formally archived 2026-05-24; descriptions can
  hijack "write a spec" prompts away from superpowers). Relocate
  `.specify/memory/constitution.md` to `docs/reference/` (it is
  load-bearing) and delete the rest of `.specify/`.
- **Version-control the skills.** `.gitignore:176` ignores
  `.claude/skills/` wholesale — ~150KB of hand-authored workflow
  knowledge has no backup/diff/CI; that is exactly how 21 references
  to the renamed `docs/architecture/` path rotted invisibly across 12
  skill files. `git add -f` the skills, then extend docs-ci link
  checking to `.claude/skills/**/*.md` and `CLAUDE.md`.
- **Skill repairs.** sed-sweep `docs/architecture/` →
  `docs/reference/`; fix backend-development's "single FastAPI
  service on Vercel" claim (it's Railway); add frontmatter to
  frontend-ux (currently no description → weak triggering); fix
  preflight's dead UUID MCP tool names (Vercel gate silently lands
  UNKNOWN every run); delete the byte-identical project copy of
  graphify (global copy covers it) and the stale `graphify-out/` stub
  (its existence biases sessions toward a never-materialized graph).
- **Permissions hygiene.** Remove `Bash(bash:*)` (arbitrary-execution
  bypass that nullifies any future deny rules) and `Bash(rm:*)` from
  the allowlists; narrow `Bash(git *)`; set
  `enableAllProjectMcpServers: false`. Promote generic safe allows
  (npm run, npx tsc, uv run, make test-backend, gh pr/run) into the
  tracked `.claude/settings.json`; delete dead one-off entries.
  Remove the phantom gitlink `.claude/worktrees/beautiful-hugle-…`
  (`git rm --cached`).
- **AGENTS.md stub** pointing at CLAUDE.md (60k+-repo cross-vendor
  standard; near-zero cost).

## Phase 1 — Deterministic enforcement layer (≈1 day)

The project currently has **zero hooks**; every past-incident class is
defended by prose only.

- **PreToolUse guards** (deny/ask): `make reset-db` / `db-fresh`
  (E2E-fixture wipe class), `mcp__supabase__apply_migration` (schema
  pollution class — deny with "use Alembic"), DDL via
  `mcp__supabase__execute_sql` (ask), `git push fabianofilho` /
  `git push --force`, `railway up` outside repo root. Normalize
  `bash -c` wrappers in the matcher script.
- **PostToolUse**: `ruff check --fix && ruff format` on edited `*.py`
  (closes the documented `make lint-backend` vs CI `ruff format
  --check` divergence — a recurring red-CI class), `eslint --fix` on
  `*.ts(x)`.
- **Stop hook**: fast gate only (`ruff format --check backend/` +
  `npx tsc --noEmit`) so the agent cannot claim "done" with format/type
  errors; full verification stays in `scripts/verify_all.sh`.
- **Makefile**: point `make test-frontend` at `npm run test:run`
  (currently launches vitest in watch mode — hangs agent sessions);
  add `make verify` as the alias for quality-scan so the canonical
  one-command green/red signal has the obvious name.

## Phase 2 — Make CI honest (≈2–3 days)

Several existing gates are theater; several real gates are missing.

- **Frontend tests in CI.** 68 vitest files / 448 tests never run in
  CI; ESLint is `|| true`. Add a blocking `frontend-test` job
  (`npm run test:run -- --coverage`, floor at current measured value,
  ratchet up); drop `|| true`.
- **E2E: real or loud.** Playwright jobs skipped 30/30 recent runs
  (secrets unset) while staying green. Either spin an ephemeral stack
  in the job (supabase CLI + uvicorn + vite preview — all already
  scripted) or add a gate job that fails loudly when E2E was skipped.
- **Branch protection.** `main` (the deploy branch!) has none — add
  it (PRs required, full check set, no force-push). dev requires only
  4 of 8 gate jobs — add Architectural Fitness, Backend E2E, Docker
  build, and the new frontend-test to required contexts.
- **Flow**: remove the `branches: [main, dev]` filter from the
  pull_request trigger (stacked PRs currently get zero CI); enable
  repo auto-merge (squash) so `gh pr merge --auto` works; add
  `concurrency` groups with cancel-in-progress on PR pushes.
- **Reproducible installs**: track `backend/uv.lock`, use
  astral-sh/setup-uv with cache, `--frozen` everywhere (this also
  un-breaks the mutation script's `--frozen` failure).
- **Delete the fake-green mutation workflow.** Baseline has been the
  0.0 placeholder since 05-20; the gate passes garbage via
  `continue-on-error`. Replace the weekly workflow with an occasional
  agent-driven mutmut loop on the crown jewels only
  (`.coverage_critical` modules), feeding surviving mutants back as
  test-writing prompts. A permanently-lying signal is worse than none.
- **AI review on every PR.** Add `anthropics/claude-code-action@v1`
  (pinned SHA, scoped permissions, same-repo PRs only) with a review
  prompt seeded from the code-review skill's incident checklist
  (BOLA, run-state TOCTOU, error swallowing, envelope drift, stale
  TanStack cache). This is the solo dev's second pair of eyes (Deriv
  case study: 700+ repos). Keep it comment-only.
- **Security & deps baseline**: dependabot.yml (pip, npm,
  github-actions, weekly), pip-audit + `npm audit --audit-level=high`
  job, CodeQL (python+javascript), GitHub secret scanning + push
  protection. Currently none of these exist — notable for a
  clinical-research platform with a BOLA history.
- **Post-deploy smoke + stuck-deploy detection.** After push to main
  (or 15-min cron): curl Railway `/health`, one authed API call, load
  the Vercel frontend; alert when deployed SHA lags main — catches the
  documented SKIPPED-SHA stuck-deploy class. Fix the known-broken
  `--path-as-root` fallback in deployment.md and railway.toml.
- **pytest skip budget**: 254 `pytest.skip` guards with no accounting;
  the suite silently skipped ~196 tests once before. Fail CI when the
  skip count exceeds a pinned number.
- **docs-ci simplification**: collapse the dual ignore lists (27
  inline globs + 24 in `.markdownlintignore`) into one
  `.markdownlint-cli2.jsonc`; make external-link checking (lychee)
  non-blocking (weekly cron that opens an issue) since it's
  documented-flaky.

## Phase 3 — Type contract + data-path consolidation (1–2 weeks; the approved workstream)

- **OpenAPI → TypeScript codegen.** Frontend types are hand-mirrored
  ("Mirrors the backend enum…" docstrings) — the structural gap behind
  the envelope-drift incident class. Generate `frontend/types/api/`
  from FastAPI's `/openapi.json` (openapi-typescript or
  @hey-api/openapi-ts), commit the output, CI check that regeneration
  is diff-clean. Close the 9 grandfathered `ApiResponse[dict[str,
  Any]]` endpoints with real Pydantic models so the generated types
  mean something.
- **Execute the data-path consolidation** (approved 2026-06-07): all
  backend calls through `frontend/integrations/api/client.ts`;
  Supabase-direct reads only on an explicit allow-list (auth/storage).
  Lock it in with a new fitness function banning
  `import.meta.env.VITE_API_URL` and `supabase.from(` outside the
  client/integration layer — the scripts/fitness harness exists for
  exactly this.
- **Frontend vocabulary cleanup**: merge `components/assessment/` +
  `components/quality/` + `hooks/qa/` into one quality-assessment
  home; rename `aiSuggestionService.ts` (named after a table dropped
  in migration 0002); extend the glossary fitness check to frontend
  names.
- **God-file ceiling**: warn-only fitness function at ~800 lines
  (seed.py 1,941; extraction_export_service 1,521; ArticlesList 1,440
  — they force whole-file reads and Edit-collision risk).

## Phase 4 — Living knowledge + self-healing routines (continuous)

- **Accuracy pass on canonical docs (urgent slice).**
  `extraction-hitl-architecture.md` claims migration head 0018 (actual
  0026) and still describes the **pre-blind-leak RLS posture** that
  migration 0025 fixed — the one doc agents must read before touching
  RLS currently teaches reintroducing the incident.
  `migrations.md` says head is 0001. Fix both; replace literal
  head/filename examples with "ls backend/alembic/versions/".
- **Constitution re-ratification.** It claims mypy-strict MUST pass
  (CI runs `|| true`) and 70% coverage (actual gate 62) — a
  "non-negotiable" doc that CI contradicts trains agents to discount
  every MUST. Re-ratify against reality; tighten §VI to the
  post-consolidation single-read-path rule.
- **Doc-update triggers, not heroic overhauls**: PR checklist items in
  the code-review/backend-development skills — new `extraction_*`
  migration ⇒ bump architecture doc head; initiative approved ⇒
  ROADMAP bullet + ADR. Write **ADR 0007 (data-path consolidation)**
  now — zero ADRs since the one-day backfill of 05-24.
- **Plan lifecycle sweep**: 11 of 24 "active" plans are shipped —
  archive them; decide on the 4 PDF-viewer phases stalled since
  04-29; add the status enum to the docs-ci frontmatter check
  ('implemented'/'in-progress' variants are escaping the vocabulary).
- **Deploy/release skill** (`disable-model-invocation: true` so it
  costs zero context and can't self-trigger): encode the
  Railway/Supabase/Alembic sequencing and recovery paths currently
  living only in auto-memory; prune those memory entries after
  promotion.
- **Scheduled routines** (guardrails: PR-only output, never merge to
  main, unit-test gate since cloud runners lack the local Supabase
  stack): nightly dependency-bump-if-green (also burns down React 19
  prep), weekly doc-drift check (diff architecture doc vs
  models/migrations), weekly memory consolidation
  (consolidate-memory skill is installed).
- **Diátaxis honesty**: seed `tutorials/` with one "first extraction
  end-to-end on local stack" doc (onboarding-from-zero is the gap the
  E2E-fixture incident exposed) or collapse the empty quadrants.

## Deliberately rejected (simplicity triage)

- **Merge queue** — train-collision risk ≈ 0 at solo concurrency;
  auto-merge behind required checks is enough.
- **Agent teams/swarms for routine work** — 58–285% token overhead;
  reserve multi-agent for review panels and competing-hypothesis
  debugging.
- **Kiro / Tessl / spec-as-source** — abandoning Claude Code or
  immature; steal only EARS-style checkable acceptance criteria in
  plans.
- **Paid per-PR judge panels ($15–25/PR)** — the local
  /code-review + /security-review skills already implement the
  pattern free.
- **High-recall third-party reviewers (Greptile-class)** — false
  positives cost solo time; tuned comment-only Claude action instead.
- **Per-PR preview environments** — overkill; a single Railway
  staging env + Supabase branch is the eventual cheap middle (Phase 4+,
  optional).
- **Expanding llms.txt** — keep as a thin index; inside the repo
  CLAUDE.md/AGENTS.md won.
- **Keeping the weekly mutation workflow as-is** — fake green is
  worse than no signal.

## Top 10 by ROI (do these first)

1. CLAUDE.md consolidation + delete speckit + fix stale pointers (P0).
2. Track `.claude/skills/` in git + sed-fix the 21 broken doc paths (P0).
3. Hooks layer: PreToolUse guards + PostToolUse format/lint + Stop fast gate (P1).
4. Permissions: remove `Bash(bash:*)`/`rm:*`, promote generic allows (P0).
5. Frontend vitest job in CI + un-silence ESLint (P2).
6. Branch protection on main + full required checks on dev + auto-merge + drop branches filter (P2).
7. Claude Code GitHub Action PR review with the incident-class prompt (P2).
8. RLS/migration-head accuracy pass on the two canonical reference docs (P4-urgent).
9. Post-deploy smoke + SKIPPED-SHA detection (P2).
10. OpenAPI→TS codegen + envelope-model closure (P3).

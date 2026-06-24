---
status: draft
last_reviewed: 2026-06-24
owner: '@raphaelfh'
---

# Consensus View Fixes — Phase B kickoff prompt

Phase A (PRs #387/#388/#389) shipped to production. Phase B is the
backend-touching remainder, already designed in
[`docs/superpowers/specs/2026-06-23-consensus-view-fixes-design.md`](../specs/2026-06-23-consensus-view-fixes-design.md)
(decisions **D5b** + **D6**, design sections **F** + **G**, "Phasing → Phase B").

Paste the block below into a clean Claude Code session in this repo to execute it.
The design is settled — no brainstorming needed; go straight to a short plan + TDD.

```text
Implement Phase B of the consensus-view rework (prumo). Phase A shipped to production
(PRs #387/#388/#389, on main). Phase B is the backend-touching remainder, fully designed.

READ FIRST for full rationale + the verified invariants:
  docs/superpowers/specs/2026-06-23-consensus-view-fixes-design.md
(sections "Decisions" D5b + D6, "Design" F + G, and "Phasing → Phase B"). Phase A is
already done; do NOT redo it.

## Scope — two independent changes, both backend + frontend, both test-backed

### F — Make the override rationale OPTIONAL
Today a consensus `manual_override` requires BOTH value and rationale, enforced in THREE
places. Relax all three so only `value` is required:
1. DB CHECK constraint `manual_override_complete` on `public.extraction_consensus_decisions`
   — backend/app/models/extraction_workflow.py (~line 362):
   change `"mode <> 'manual_override' OR (value IS NOT NULL AND rationale IS NOT NULL)"`
   -> `"mode <> 'manual_override' OR value IS NOT NULL"`.
   Requires an Alembic migration (CHECK constraints are usually NOT picked up by
   autogenerate — HAND-WRITE it: op.drop_constraint(...type_='check', schema='public')
   then op.create_check_constraint(... new expr ..., schema='public'); downgrade restores
   the old expr).
2. Service guard — backend/app/services/extraction_consensus_service.py (~line 79-80):
   `if mode_value == "manual_override" and (value is None or rationale is None): raise`
   -> require only `value is None`.
3. Frontend — frontend/components/runs/ConsensusPanel.tsx: the override submit button is
   disabled while `overrideRationale.trim() === ""` (~line 288) — remove that term.
   Copy frontend/lib/copy/consensus.ts:100 `panelRationaleLabel: 'Rationale (required)'`
   -> `'Rationale (optional)'`.
   (The API schema CreateConsensusRequest.rationale is already `str | None` — no
   api-contract regen needed; verify with `npm run generate:api-types` producing no diff.)

### G — Compare the FULL value envelope for agreement (fix the unit-conflict bug)
Today both sides strip `{value, unit}` down to the bare value when deciding agreement, so
two reviewers entering `5 mg` vs `5 g` are judged "agreed" and one unit is silently
published. Compare the whole stored value instead:
1. Backend `_agreed_unpublished_values` — backend/app/services/run_lifecycle_service.py
   (~line 341): key on the full envelope, `json.dumps(resolved, sort_keys=True,
   default=str)`, NOT `json.dumps(_unwrap_value(resolved), ...)`.
2. Frontend `decisionsAgree` — frontend/hooks/runs/useReviewerSummary.ts (~line 76-85):
   compare `a.value`/`b.value` canonicalized (stable-stringify after sorting keys), NOT
   `unwrap(...)`. Keep reject==reject -> agree, reject vs non-reject -> disagree.
   NOTE: single-key `{value: X}` must still compare equal across reviewers (it always did);
   only differing siblings like `unit` now count as divergence. Re-run the existing
   useReviewerSummary/ConsensusPanel suites and fix any fixture that relied on old
   unwrap-equality.

## TDD — write these tests
- F backend (integration, real Postgres — CHECK constraints are invisible to mocks): a
  `manual_override` consensus decision with `value` set and `rationale=None` is ACCEPTED
  post-migration (record_consensus succeeds, PublishedState written).
- F frontend: the override submit is enabled with an empty rationale; assert "(optional)".
- G backend (integration): two reviewers on one coord — `{value:"5",unit:"mg"}` vs
  `{value:"5",unit:"g"}` -> the coord is unresolved divergence; `approve_and_finalize`
  REJECTS (does not auto-publish). And `{value:"5",unit:"mg"}` from both -> agreed/published.
- G frontend: `decisionsAgree` is false for differing-unit envelopes, true for identical.

## prumo gotchas — these WILL bite if ignored
- Migrations: run from backend/ (`alembic revision -m "..."` then `alembic upgrade head`).
  Revision id <= 32 chars (alembic_version is varchar(32); overflow breaks CI + deploy).
  This touches extraction_* -> also bump the migration-head line + `last_reviewed` in
  docs/reference/extraction-hitl-architecture.md (backend.md rule).
- Adding a migration breaks `test_migration_roundtrip`'s head-pin + `downgrade -1` guards:
  bump the pinned head, and make the downgrade test target the explicit parent revision.
- Backend tests: `make test-backend` (needs local Supabase Docker + `alembic upgrade head`);
  integration over mocks; autouse SEED fixture seeds the graph; deferred-trigger tests need
  the `db_session_real` fixture. NEVER run two `make test-backend` concurrently — a
  pg_advisory_xact_lock orphan hangs every later run.
- Backend diff-coverage gate is 80%: the service change must be covered by a test that calls
  the service method directly (httpx ASGITransport endpoint lines don't register coverage).
- Frontend: run from REPO ROOT, `npm run test:run` (never bare `npm test`). React Compiler
  runs with panicThreshold all_errors — no try/finally in component/hook bodies. All copy via
  frontend/lib/copy.
- If you work in a git worktree: a copied `.env` MASKS a real CI failure — CI's Frontend
  Tests run env-less and the Supabase client throws at module load for any test reaching
  AuthContext unmocked. Re-run the suite with `.env` moved aside before trusting green.

## Verify before "done"
- `make lint-backend`, `make test-backend` (F + G integration tests green; migration applies
  + roundtrips).
- `npm run lint`, `npm run test:run` (env-less too), `npm run generate:api-types` (no diff).
- Then: PR to `dev` (squash, `gh pr merge --auto --squash`). Once green in dev, promote
  `dev -> main` via a MERGE-COMMIT PR (`gh pr create --base main --head dev` +
  `gh pr merge --auto --merge`), confirm Post-deploy Smoke + /health
  (https://web-production-48b398.up.railway.app/health) green, and delete the merged branch.

Use a worktree (superpowers:using-git-worktrees) off the latest origin/main. The design is
settled — no brainstorming needed; go straight to a short plan + TDD implementation.
```

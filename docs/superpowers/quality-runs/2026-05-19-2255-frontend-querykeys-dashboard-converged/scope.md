# Scope

**Run ID**: 2026-05-19-2255-frontend-querykeys-dashboard
**Created**: 2026-05-19T23:32:00Z
**Status**: converged
**Scope**: `frontend/pages/Dashboard.tsx`

## Why this scope

The first `check_react_query_keys.py` baseline (committed in 32b4908) listed 4 call sites with literal `queryKey: [...]` arrays. Of those, only Dashboard.tsx's two sites used the literal `['projects']` — which matches `projectKeys.all` exactly (no cache-shape change). The other two baselines (`useArticleTextBlocks.ts:41` and `hooks-runs.test.tsx:333`) use bespoke shapes that would require the factory namespaces to be extended OR all invalidators audited; they remain baselined for a follow-up run.

## Files in scope

- `frontend/pages/Dashboard.tsx` (single file, ~120 LOC)

## Source of findings (no SCAN this run)

The backlog for this run was the persistent baseline in `scripts/fitness/check_react_query_keys.baseline` (no new SCAN needed — the entries are deterministic outputs of the fitness function from a prior sweep).

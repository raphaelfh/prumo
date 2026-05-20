# Iteration 001 — f_001/f_002 (batched): Dashboard.tsx → projectKeys.all

## Findings

```
f_001 [medium/0.9] frontend/pages/Dashboard.tsx:24  queryKey: ['projects']
f_002 [medium/0.9] frontend/pages/Dashboard.tsx:66  invalidateQueries({queryKey: ['projects']})
```

Both surfaced by `scripts/fitness/check_react_query_keys.py` — a queryKey literal-array enforcement rule introduced alongside `frontend/lib/query-keys/`. Two literal `['projects']` arrays at Dashboard.tsx lines 24 + 66.

## Why batch

Same file, same shape, same fix. Cache-shape preserving (`projectKeys.all` evaluates to `['projects'] as const`), so cache continuity is untouched and no other invalidator/consumer needs updating in the same diff. A pre-commit grep confirmed Dashboard.tsx is the **only** consumer of the literal `['projects']` queryKey in the repo (other matches in `types/`, `services/`, `hooks/useProjectsList.ts` reference the `projects` table name, not a queryKey).

## PLAN

- **Files to touch (2)**: `frontend/pages/Dashboard.tsx` (import + 2 call-site edits) + `scripts/fitness/check_react_query_keys.baseline` (remove 2 grandfathered entries).
- **No new test** — the existing Dashboard tests cover the data-fetch path; cache-shape preservation means no behaviour change to assert.
- **Recurrence guard** is the fitness check itself (it will fail any future `queryKey: ['projects']` regression outside the now-shrunk baseline). `fix_must_add="fitness-rule"` satisfied implicitly by the baseline tightening.
- **LOC**: ~5 (1 new import line + 2 single-token replacements + 2 baseline deletions).

## DIFF

- `frontend/pages/Dashboard.tsx`:
  - +1: `import {projectKeys} from '@/lib/query-keys';`
  - line 24: `queryKey: ['projects']` → `queryKey: projectKeys.all`
  - line 66: `invalidateQueries({queryKey: ['projects']})` → `invalidateQueries({queryKey: projectKeys.all})`
- `scripts/fitness/check_react_query_keys.baseline`:
  - removed `frontend/pages/Dashboard.tsx:24`
  - removed `frontend/pages/Dashboard.tsx:66`

## Gate output

```
npx tsc --noEmit: OK (clean, exit 0)
python3 scripts/fitness/check_react_query_keys.py: OK (67 ms; 2 literal queryKeys found [down from 4], 2 grandfathered)
npm test -- --run: 714 PASSED in 8.50s (112 test files; no regression)
```

## Counterfactual probe

Reverting the diff (restoring the literal array AND adding the entries back to the baseline) would land us in the same state as `dev` HEAD before this iteration — `check_react_query_keys.py` exits 0 because the baseline matches; the literal arrays are tolerated. The non-vacuous proof is the tightened baseline: removing the entries while leaving the literals would fail the check at PR time. The fix is the baseline tightening + the migration that allows the tightening.

## Judge verdict

```
RESOLVES
Migrating two literal queryKeys to projectKeys.all + tightening the baseline removes both findings from the grandfathered list with zero behaviour change (cache shape preserved); 714 vitest + tsc green; the tightened baseline IS the recurrence guard (fix_must_add=fitness-rule satisfied).
```

## Reflexion (iteration 001)

**What could still go wrong:** The migration only touched Dashboard.tsx — `useArticleTextBlocks.ts:41` (shape `['article-text-blocks', id]`) and `hooks-runs.test.tsx:333` (shape `['runs', 'run-cache']`) remain baselined because their shapes don't match any current factory namespace. Extending the factory to accommodate those shapes would either dilute the convention or force a cache-shape migration that requires auditing every invalidator across the frontend.

**What I'd do differently next time:** Pre-scan the consumer graph for every baseline entry before the iteration, so the iteration plan reflects the true cost of each migration (shape-preserving vs cache-resetting). For shape-changing migrations, scope by **invariant** (every consumer + invalidator of a particular legacy shape) rather than by **file** to avoid partial migrations that leave broken cache propagation.

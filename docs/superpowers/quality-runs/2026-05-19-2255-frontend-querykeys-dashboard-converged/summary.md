# Summary — 2026-05-19-2255-frontend-querykeys-dashboard

**Status:** `converged` (2/2 findings closed in 1 iteration; deterministic gates green; baseline tightened from 4 → 2 entries).

## Scope

`frontend/pages/Dashboard.tsx` — single file, ~120 LOC. Backlog source: persistent baseline in `scripts/fitness/check_react_query_keys.baseline`.

## Findings (originally 2 of 4 baseline entries)

| ID | Severity | Confidence | Site |
|---|---|---|---|
| f_001 | medium | 0.9 | Dashboard.tsx:24 — `queryKey: ['projects']` |
| f_002 | medium | 0.9 | Dashboard.tsx:66 — `invalidateQueries({queryKey: ['projects']})` |

Both closed in **iteration 001** by replacing the literal array with `projectKeys.all` (shape-preserving — cache continuity untouched).

## Final gate state

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | OK (no errors) |
| `npm test -- --run` (vitest) | 714 PASSED in 8.50s (no regression) |
| `python3 scripts/fitness/check_react_query_keys.py` | OK (2 literal queryKeys found, 2 grandfathered; baseline reduced from 4 → 2) |

## Out-of-scope (next run candidates)

The 2 entries left in `check_react_query_keys.baseline`:
- `frontend/hooks/extraction/useArticleTextBlocks.ts:41` — shape `['article-text-blocks', id]` differs from `articleKeys.textBlocks(id)` shape `['articles', 'text-blocks', id]`. Migration requires either factory shape change OR audit of every invalidator of `['article-text-blocks', ...]`.
- `frontend/test/hooks-runs.test.tsx:333` — test asserts an invalidation pattern in some hook. Need to identify which hook emits `['runs', 'run-cache']` and migrate it (likely a sibling refactor with the `extractionKeys` namespace adding a `runs-cache` slot).

## What the loop earned

A small, scope-preserving cleanup that reduced the grandfathered queryKey-literal list by half and validated that the factory convention works for at least one real consumer. The cost was ~5 LOC of source + a baseline shrink — proof that the loop's "baseline tightening over time" model is healthy.

## Telemetry

- Wall-clock total: ≈ 10 s (typecheck + vitest + fitness; no SCAN this run).
- Iterations: 1; loopbacks: 0; quarantined: 0; tokens (LLM): ≈ 0 (deterministic-only, no subagent SCAN).

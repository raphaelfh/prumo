# Iteration 001 — f_001/f_002 (batched): the final 2 query-keys baselines

## Findings

```
f_001 [medium/0.9] useArticleTextBlocks.ts:41   queryKey: ['article-text-blocks', articleFileId]
f_002 [medium/0.9] hooks-runs.test.tsx:333      expect(invalidateSpy).toHaveBeenCalledWith({queryKey: ["runs", "run-cache"]})
```

## Pre-iteration audit (the most important step)

Last session's reflexion called out the right risk: a literal queryKey rarely lives alone — every consumer + invalidator of a given shape must move in lockstep or invalidations break silently. So before any code change, grep first:

```bash
grep -rn "article-text-blocks" frontend/ --include="*.ts" --include="*.tsx"
# → exactly one match: useArticleTextBlocks.ts:41

grep -rn "'runs'\|\"runs\"" frontend/ --include="*.ts" --include="*.tsx"
# → runsKeys factory in frontend/hooks/runs/types.ts is already used by
#   every real hook (useRun, useRunReviewers, etc.); only the TEST has a
#   literal array.
```

So:
- `article-text-blocks` is a single-consumer, no-invalidator key — safe shape change.
- `runs-cache` is a TEST artefact; the actual hook calls `runsKeys.detail(runId)` via the existing factory in `frontend/hooks/runs/types.ts`. The fix is updating the test assertion to use the same factory the hook uses.

## PLAN

1. `useArticleTextBlocks.ts`: import `articleKeys` from `@/lib/query-keys`; replace `['article-text-blocks', articleFileId]` with `articleKeys.textBlocks(articleFileId ?? '')`. The `?? ''` mirrors the existing `enabled: Boolean(articleFileId)` guard so the queryKey is stable even when disabled.
2. `hooks-runs.test.tsx`: import `runsKeys` from `@/hooks/runs/types`; replace the literal `{ queryKey: ["runs", "run-cache"] }` with `{ queryKey: runsKeys.detail("run-cache") }` — the test now asserts the same shape the hook actually emits.
3. Clear the 2 remaining entries from `check_react_query_keys.baseline`.

## DIFF

- `frontend/hooks/extraction/useArticleTextBlocks.ts`: +1 import, 1 line edit. ~3 LOC.
- `frontend/test/hooks-runs.test.tsx`: +1 import, 1 assertion edit. ~3 LOC.
- `scripts/fitness/check_react_query_keys.baseline`: emptied (comment block only).

Total: ~6 LOC of edits.

## Gate output

```
npx tsc --noEmit: OK (clean)
vitest (full suite): 714 PASSED in 12.84s (no regression — the 16 tests in hooks-runs.test.tsx still pass; the assertion now matches the factory call shape)
check_react_query_keys.py: OK (99 ms; 0 literal queryKeys found, baseline empty)
fitness/run_all.sh (7 checks): all green
```

## Counterfactual probe

For f_001: reverting the diff restores `queryKey: ['article-text-blocks', articleFileId]` AND the baseline entry. The check still passes (baseline-tolerated). The fix is the COMBINATION (the migration AND the baseline tightening). A future regression introducing the same literal shape elsewhere would now fail the check.

For f_002: reverting just the test assertion would re-introduce a divergence between the test's expected key and the hook's actual key. The test would still PASS (because the hook actually uses `runsKeys.detail` which evaluates to `["runs", "run-cache"]` for `runId="run-cache"`), but the literal would re-appear in the baseline scan. The fix re-couples test assertions to the factory — if `runsKeys.detail` shape changes, the test breaks immediately instead of silently asserting an outdated shape.

## Judge verdict

```
RESOLVES
Two literal queryKeys migrated to factory calls; baseline cleared 2 → 0; the audit step caught the test-vs-hook divergence and fixed both consistently; 714 vitest tests pass with no regression; check_react_query_keys.py now reports 0 violations.
```

## Reflexion (iteration 001)

**What could still go wrong:** The check is a regex over `queryKey\s*:\s*\[` — it does not catch literals passed via spread (`{ ...keyObj }`) or via dynamic property keys (`{ [keyName]: [...] }`). A determined contributor could ship a literal queryKey by routing through one of those shapes without tripping the check.

**What I'd do differently next time:** Promote the check from regex to TypeScript-AST-based (via a small node tree-sitter pass) so the matcher understands JS literal-array nodes regardless of how they reach the `queryKey` property. That is a Phase-3 improvement to the check itself; for now the regex is good enough — it covers the canonical pattern that every existing violation used.

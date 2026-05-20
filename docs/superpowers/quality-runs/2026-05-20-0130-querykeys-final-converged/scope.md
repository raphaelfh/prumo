# Scope

**Run ID**: 2026-05-20-0130-querykeys-final
**Status**: converged
**Scope**: `frontend/hooks/extraction/useArticleTextBlocks.ts` + `frontend/test/hooks-runs.test.tsx`

## Why this scope

The last 2 entries in `check_react_query_keys.baseline`. Audit before
work confirmed:

- `useArticleTextBlocks.ts:41` is the **only** consumer of the literal
  `['article-text-blocks', articleFileId]` queryKey — zero invalidators
  reference it elsewhere. Migrating to `articleKeys.textBlocks(...)` is
  safe (cache is invisible to other consumers; first-load miss only).
- `hooks-runs.test.tsx:333` asserts an invalidation pattern. The actual
  HOOK uses the existing `runsKeys.detail(runId)` factory in
  `frontend/hooks/runs/types.ts`; only the TEST hardcoded the shape.
  Fix is to import `runsKeys` in the test and assert against the
  factory call.

Closing both reduces query-keys baseline 2 → 0, which together with
runs 2026-05-20-0030 (envelope baseline 1 → 0) and 2026-05-20-0100
(layered-arch baseline 7 → 0) brings the full repo to ZERO grandfathered
violations across every architectural fitness check.

---
status: in_progress
last_reviewed: 2026-07-23
owner: '@raphaelfh'
---

# auto-found backlog triage

Every open `auto-found` issue as of 2026-07-23, verified against `dev` HEAD.
Drives the liquidation described in
[the routines-system cleanup spec](../specs/2026-07-23-routines-system-cleanup-design.md).

Starting count: **43 open**, median age 40 days, oldest 2026-05-18. The last
one closed before this pass was on 2026-06-06 — 47 days of pure accumulation.

## Totals

| verdict | count |
|---|---|
| OBSOLETE — closed with evidence | 31 |
| REAL — fixed in this branch | 4 |
| REAL / UNVERIFIABLE — still open | 8 |

The four fixed issues stay open on GitHub until this branch merges; the count of
open `auto-found` issues reads 12 until then, 8 after.

## OBSOLETE — closed

### Backend code already fixed at HEAD

| issue | evidence |
|---|---|
| #83 | `backend/app/repositories/hitl_config_repository.py:59-65` uses `pg_insert(...).on_conflict_do_update(...)`; the inline comment cites this issue number |
| #88 | `backend/app/services/section_extraction_service.py:384,551,982` all call `rollback_and_fail(...)` — the gap is closed at every site |
| #90 | `backend/app/services/zotero_service.py:332,359` stream via `client.stream(...)` + `aiter_bytes()` |
| #153 | `extraction_runs.py` sets `response.status_code = HTTP_200_OK` when `created` is False |

### Frontend code already fixed at HEAD

| issue | evidence |
|---|---|
| #159 | `useFullAIExtraction.ts:182,202` invoke `onSuccess()` on the early-return paths; a comment at :230 cites this issue |
| #160 | `useAISuggestions.ts:182` gates the per-item toast behind `if (!silent)`; batchAccept emits one aggregate toast at :287 |
| #205 | `useBatchAllModelsSectionsExtraction.ts:209-226` branches on `failedModels === 0` |
| #206 | `useRunAIExtraction.ts:71-76` fires success only inside `if (jobStatus === 'completed')` |
| #335 | `useSectionExtraction.ts:73` reads `jobResult?.extractionRunId`; the cited `result.data.runId` access is gone |
| #334 | `ExtractionInterface.tsx:555` invalidates `templateEntityTypesKeys.all`; `useTemplateRepublish.ts:45` invalidates `byTemplate` |
| #110 | `ProjectView.tsx:42,136-165` implements a `projectLoadRef` generation guard checked after every await |
| #101 | the local progress interfaces named in the issue no longer exist in `ModelSection.tsx` |
| #103 | `ExtractionComparisonView.tsx` was deleted; the compare view was replaced by the shared blind-review component in #318 |

### Dependency CVEs — the blocking gate is green

All twelve were closed on one piece of evidence plus a package-specific fact:
`security-audit.yml` dispatched on `dev`
([run 30059176311](https://github.com/raphaelfh/prumo/actions/runs/30059176311))
passed both jobs — **pip-audit: success**, **npm audit: success**. That workflow
runs the same auditors as the retired routine and blocks the PR instead of
filing an issue.

| issues | package-specific fact |
|---|---|
| #524, #525, #526, #527, #528, #537, #538, #540 | `pillow` is 12.3.0 in `backend/uv.lock`; the issues cite 12.2.0 |
| #536 | `torch` is 2.13.0; the issue cites 2.12.1 |
| #539 | `ecdsa` is no longer in the lock at all — it arrived via `python-jose`, removed by the PyJWT migration (#545) |
| #151 | `langsmith` is no longer in the lock at all |
| #227 | `uuid` is 14.0.1 in `package-lock.json`; the issue cites 13.0.0 |

### Meta and infrastructure

| issue | evidence |
|---|---|
| #226 | the named test ran 5/5 green on `dev`; not reproducible as flaky, and flaky-test-tracker is retired |
| #186 | flaky-test-tracker is retired; CI holds the run history natively, so the diagnostic has no consumer |
| #364 | both routines it names are retired — linear-enrich (the erroring one) and routine-watchdog (the alarm source) |
| #390, #315, #204 | system-health-check is retired; prod reachability is proven by `post-deploy-smoke.yml`, which is green |

## REAL — fixed in this branch

| issue | fix | regression test |
|---|---|---|
| #284 | `useTopLevelSectionsExtraction` claimed success whenever one section survived. Now branches success / warning / error, matching the sibling hooks. Also removed the last hardcoded English strings in that hook (#531) | `extractionPartialFailure.test.tsx` |
| #333 | `useBatchSectionExtractionChunked` called `options.onSuccess` even when every section failed. Now requires `successfulSections > 0` | `extractionPartialFailure.test.tsx` |
| #285 | `useFinalizedExtractionRun` had no generation guard, so a stale `findLatestFinalizedRun` result put another article's run behind "Reopen for revision" | `useFinalizedExtractionRun.test.tsx` |
| #406 | `useAISuggestions.loadSuggestions` had no generation guard, so article A's suggestion map could land while the form showed article B | `useAISuggestions.generation.test.tsx` |

Every test was verified to be a genuine regression test: stashing the
corresponding hook alone makes exactly its own assertions fail, with the stale
or over-optimistic value observed winning.

#285 and #406 use the generation-counter pattern `ProjectView` already
established for this class (`projectLoadRef`, the fix for #110).

## Still open — 8

Grouped by root cause. Each group is one PR in the follow-up.

### Group A — effect stability

| issue | file |
|---|---|
| #521 | `frontend/hooks/extraction/useExtractionSession.ts` — unstabilized inline functions in `useEffect` deps, reported across five sites |

Deliberately **not** fixed in this pass. It is a different class from #285/#406:
those were stale-response races with a known in-repo pattern to copy, while this
one is an effect-identity problem that interacts with the React Compiler — which
memoizes inline functions automatically and may already neutralise part of it.
Verify the loop still reproduces at HEAD before changing five call sites.

### Group B — promise chaining and cache invalidation

| issue | file |
|---|---|
| #485 | `useExtractionFormAIActions.ts:59-99` — sequential `.then()` chaining; a rejection silently skips later steps |
| #486 | `useArticleExtractionValues.ts:42-50` — `useQuery` with `staleTime: 30s` and no invalidation after accept/reject |
| #405 | `useModelExtraction.ts:101` — deliberate fire-and-forget (`// IMPORTANT: Do not await`). Re-confirm whether the Phase-2 race the issue describes still exists before changing anything |

### Group C — backend typing and schema

| issue | detail |
|---|---|
| #94 | `backend/app/models/article.py:108` — `funding: Mapped[list[dict[str, Any]]]` with `nullable=True`; the annotation should be optional. `Project.review_keywords` is already correct (`nullable=False`) |
| #95 | "four nullable columns annotated as non-Optional" — needs an exhaustive scan; the naive regex misses nested generics like `Mapped[list[dict[str, Any]]]` |
| #81 | composite FK on `extraction_consensus_decisions`. The migration does declare `FOREIGN KEY (run_id, selected_decision_id)`; the `ON DELETE` behaviour needs checking against the issue's claim. Its sibling #96 was closed NOT_PLANNED |

### Group D — unverified scope

| issue | detail |
|---|---|
| #99 | "72 copy keys missing from the extraction namespace". `FieldsTable.tsx` still exists; the count needs re-deriving against `frontend/lib/copy/extraction.ts` before acting |

## Note on issues outside the label

`bug-watch` also filed #531 and #532 with only the `bug` label, so they are not
in the 43. #531 (hardcoded English strings in `useTopLevelSectionsExtraction`)
is resolved by the same commit that fixes #284. #532 (triple success toast in
full AI extraction) is unverified and remains open.

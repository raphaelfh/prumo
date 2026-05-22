# Summary — 2026-05-20-0100-layered-arch-final

**Status:** `converged` (7/7 findings closed in 1 batched iteration; layered-arch baseline reduced 7 → **0** — invariant fully enforced repo-wide).

## Findings (all closed)

| ID | File | Forbidden import |
|---|---|---|
| f_001 | article_text_blocks.py | `app.models.article` |
| f_002 | articles_export.py | `app.repositories.unit_of_work` |
| f_003 | citations.py | `app.models.article` |
| f_004 | citations.py | `app.models.extraction` |
| f_005 | hitl_sessions.py | `app.models.extraction` (TemplateKind) |
| f_006 | project_templates.py | `app.models.extraction` (ProjectExtractionTemplate, TemplateKind) |
| f_007 | zotero_import.py | `app.repositories.unit_of_work` |

## Final gate state

| Gate | Result |
|---|---|
| ruff check + format | OK |
| backend pytest | 543 passed, 31 skipped (no regression) |
| **check_layered_arch** | **OK; 0 edges checked, baseline empty** |
| full fitness/run_all.sh (7 checks) | all green (~1 s) |

## What the loop earned (cumulative across all 4 quality-loop runs to date)

| Check | Initial baseline | Final baseline | Status |
|---|---:|---:|---|
| check_migration_split | 0 | 0 | clean since day 1 |
| check_legacy_concepts | 0 hard / 6 warn | 0 hard / 6 warn | hard tier permanently enforced |
| check_glossary_sync | n/a | OK (19/19) | new check; in sync |
| check_rls_coverage | 0 | 0 | 15/15 tables covered |
| **check_api_response_envelope** | 10 | **0** | enforced repo-wide |
| **check_layered_arch** | 13 | **0** | enforced repo-wide |
| check_react_query_keys | 4 | 2 | 2 remaining for next session |

**The two BIG architectural invariants — ApiResponse envelope and layered-architecture DAG — are now fully enforced.** Every new endpoint will be held to them automatically by CI's advisory gate.

## Reusable patterns established this run

1. **Read service per resource family** — `extraction_run_read_service`, `article_text_block_read_service`, `citation_read_service`. Each owns the inline SQL the endpoint used to do; endpoint becomes a 3-5 line orchestrator.
2. **Domain exception → HTTP translation in router** — services raise `XNotFoundError`, `InvariantError`; routers catch and `raise HTTPException(...)`. Service tests don't need FastAPI.
3. **Cross-cutting infra re-export in `app.core`** — `app.core.transactions.UnitOfWork` is the canonical path for transaction primitives that the API legitimately needs.
4. **Enum re-export in schemas** — when an enum is consumed both by the model and by request validation, re-export from the relevant schemas module so the API doesn't have to import the model.

## Telemetry

- Wall-clock total: ≈ 60 s (lint + pytest + fitness).
- Iterations: 1 (batched across 3 fix shapes); loopbacks: 0; quarantined: 0; tokens (LLM): 0 (deterministic-only).

## Out-of-scope (genuinely remaining)

- **2 query-keys baseline entries** (Bucket C — `useArticleTextBlocks.ts:41`, `hooks-runs.test.tsx:333`). Need a frontend factory shape audit OR consumer-graph migration; not in this run's scope.
- **`make quality-mutation` weekly** has not been seeded with a real baseline score yet — first mutmut run will populate `.mutation-baseline`.

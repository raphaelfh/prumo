# Phase 1C-2: HITL Endpoints + Refactor + Drop 008 Endpoints

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Expose the HITL services via `/v1/runs/...` endpoints, refactor existing extraction services to write through `ExtractionProposalService`, drop 008 endpoints. Address coordinate-coherence + `kind` parameter deferred from 1C-1.

**Tech Stack:** FastAPI, Pydantic schemas, pytest API contract tests via `db_client` fixture.

---

## Plans roadmap

| # | Status |
|---|---|
| 1A, 1B, 1C-1 | ✅ |
| 1C-2 | this plan |
| 1D, 1E, 2 | pending |

## Spec reference
`docs/superpowers/specs/2026-04-27-extraction-hitl-and-qa-design.md` §7 (endpoints), §8 (frontend shell).

---

## File structure

### Create
- `backend/app/schemas/extraction_run.py` — Pydantic request/response models
- `backend/app/api/v1/endpoints/extraction_runs.py` — `/v1/runs` endpoints
- `backend/app/services/coordinate_coherence.py` — shared validation helper
- `backend/tests/integration/test_extraction_runs_endpoints.py` — API contract tests
- `backend/tests/integration/test_coordinate_coherence.py` — coherence helper tests

### Modify
- `backend/app/services/run_lifecycle_service.py` — accept `kind` parameter
- `backend/app/services/extraction_proposal_service.py` — call coherence check
- `backend/app/services/extraction_review_service.py` — call coherence check
- `backend/app/services/extraction_consensus_service.py` — call coherence check
- `backend/app/services/model_extraction_service.py` — write proposals via `ExtractionProposalService`
- `backend/app/services/section_extraction_service.py` — write proposals via `ExtractionProposalService`
- `backend/app/api/v1/router.py` (or wherever router is wired) — register `/v1/runs` router

### Delete (drop 008 endpoints)
- `backend/app/api/v1/endpoints/evaluation_runs.py`
- `backend/app/api/v1/endpoints/evaluation_review.py`
- `backend/app/api/v1/endpoints/evaluation_consensus.py`
- `backend/app/api/v1/endpoints/evaluation_schema_versions.py`
- Their corresponding test files
- Their corresponding schema files (`backend/app/schemas/evaluation_*.py`)
- Their service stubs (`backend/app/services/evaluation_*.py`)

---

## Endpoints contract (matches spec §7)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/v1/runs` | `{project_id, article_id, project_template_id, kind?}` | 201 with full Run |
| GET | `/v1/runs/{run_id}` | — | 200 with Run + proposals + decisions + consensus + published |
| POST | `/v1/runs/{run_id}/proposals` | `{instance_id, field_id, source, proposed_value, confidence_score?, rationale?}` | 201 |
| POST | `/v1/runs/{run_id}/decisions` | `{instance_id, field_id, decision, proposal_record_id?, value?, rationale?}` | 201 |
| POST | `/v1/runs/{run_id}/consensus` | `{instance_id, field_id, mode, selected_decision_id?, value?, rationale?}` | 201 with `consensus + published` |
| POST | `/v1/runs/{run_id}/advance` | `{target_stage}` | 200 with updated Run |

Error mapping:
- `InvalidStageTransitionError` / `InvalidProposalError` / `InvalidDecisionError` / `InvalidConsensusError` → 400
- `OptimisticConcurrencyError` → 409 with current `version` and `published_by`
- `TemplateVersionNotFoundError` / `Run not found` → 404
- Coordinate-coherence violation → 422

Auth: existing `get_current_user_sub` dep. Endpoints run in caller's context (RLS applies). For now, services use service-role internally; tightening RLS deferred to Plan 1D / future.

---

## Task 1: Coordinate-coherence helper

**Files:** `backend/app/services/coordinate_coherence.py`, `backend/tests/integration/test_coordinate_coherence.py`

Single function:
```python
async def assert_coords_coherent(db, run_id, instance_id, field_id):
    """Raise CoordinateMismatchError if (instance_id, field_id) don't belong to run_id's template."""
```

Implementation: one SQL query joining `extraction_runs`, `extraction_instances`, `extraction_entity_types`, `extraction_fields`. Returns 1 row if coherent, else 0.

```sql
SELECT 1
FROM extraction_runs r
JOIN extraction_instances i ON i.id = :instance_id AND i.template_id = r.template_id
JOIN extraction_entity_types et ON et.id = i.entity_type_id
JOIN extraction_fields f ON f.id = :field_id AND f.entity_type_id = et.id
WHERE r.id = :run_id
```

Tests:
1. Coherent triplet → no exception
2. `instance_id` from different template → `CoordinateMismatchError`
3. `field_id` from different entity_type → `CoordinateMismatchError`
4. Nonexistent run → `CoordinateMismatchError`

Steps: TDD (write tests fail → impl → tests pass → ruff → commit).

---

## Task 2: Wire coherence check into proposal/review/consensus services

**Modify:** the 3 writer services. Add `await assert_coords_coherent(...)` before the existing rule validations. Add corresponding tests covering coherence violations on each writer.

Steps: write test cases that pass mismatched coords → confirm services raise → impl by adding the call → verify tests pass.

Commit: `feat(extraction): enforce coordinate coherence in proposal/review/consensus writers`

---

## Task 3: `kind` parameter on `RunLifecycleService.create_run`

**Modify:** `backend/app/services/run_lifecycle_service.py`. Read `project_extraction_templates.kind` for the supplied `project_template_id` and use that (no need for explicit param — automatic). Raise `InvalidRunCreationError` if template doesn't exist.

Test: create run with QA-flavored template (we'll seed a temporary one in the test) → assert `run.kind == "quality_assessment"`.

Commit: `feat(extraction): RunLifecycleService.create_run derives kind from template (supports QA in Phase 2)`

---

## Task 4: Pydantic schemas

**Create:** `backend/app/schemas/extraction_run.py`

Define:
- `CreateRunRequest`, `CreateRunResponse`, `RunDetailResponse`
- `CreateProposalRequest`, `ProposalRecordResponse`
- `CreateDecisionRequest`, `ReviewerDecisionResponse`
- `CreateConsensusRequest`, `ConsensusResultResponse` (consensus + published)
- `AdvanceStageRequest`, `RunSummaryResponse`

All wrap in `ApiResponse` envelope per `app/schemas/common.py`.

No tests yet (covered by endpoint tests).

Commit: `feat(extraction): add Pydantic schemas for /v1/runs endpoints`

---

## Task 5: Implement `/v1/runs` endpoints

**Create:** `backend/app/api/v1/endpoints/extraction_runs.py`

6 endpoints per the contract table above. Each:
- Reads body with Pydantic validation
- Resolves caller via `get_current_user_sub`
- Calls the corresponding service
- Catches service exceptions → maps to HTTPException with appropriate status
- Wraps response in `ApiResponse`

Register in `backend/app/api/v1/router.py` under `/runs` prefix.

Commit: `feat(extraction): /v1/runs endpoints — create/get/proposals/decisions/consensus/advance`

---

## Task 6: API contract tests

**Create:** `backend/tests/integration/test_extraction_runs_endpoints.py`

Cover for each endpoint:
- Happy path (201/200 with expected body shape)
- Auth missing (401)
- Validation error in body (422)
- Service error mapping (400/404/409/422)
- E2E: POST /runs → POST /proposals → POST /advance → POST /decisions → POST /advance → POST /consensus → GET /runs/{id} returns final state with published value

Use existing `db_client` fixture. Aim for ~25 tests.

Commit: `test(extraction): API contract tests for /v1/runs endpoints (~25 tests)`

---

## Task 7: Refactor `model_extraction_service` to use `ExtractionProposalService`

**Modify:** `backend/app/services/model_extraction_service.py`. Where it currently writes to `ai_suggestions`, replace with calls to `ExtractionProposalService.record_proposal(...)` and `RunLifecycleService.create_run(...)`. The Run goes from `pending → proposal` automatically before recording.

Update existing tests in `tests/unit/test_model_extraction_service.py` if they assert on `ai_suggestions` shape.

Commit: `refactor(extraction): model_extraction_service writes proposals via new HITL stack`

---

## Task 8: Refactor `section_extraction_service` similarly

**Modify:** `backend/app/services/section_extraction_service.py`. Same pattern as Task 7.

Update tests in `tests/unit/test_section_extraction_service.py`.

Commit: `refactor(extraction): section_extraction_service writes proposals via new HITL stack`

---

## Task 9: Drop 008 endpoints + their tests, schemas, services

**Delete:**
- `backend/app/api/v1/endpoints/evaluation_runs.py`
- `backend/app/api/v1/endpoints/evaluation_review.py`
- `backend/app/api/v1/endpoints/evaluation_consensus.py`
- `backend/app/api/v1/endpoints/evaluation_schema_versions.py`
- All `backend/app/schemas/evaluation_*.py` files
- All `backend/app/services/evaluation_*.py` files
- All `backend/tests/integration/test_evaluation_*.py` files

**Modify:** `backend/app/api/v1/router.py` to remove 008 router registrations.

Tables (`evaluation_*`) are NOT dropped here — that's Plan 1D's migration. This task is code-only.

Commit: `chore(extraction): drop 008 endpoints, services, schemas, and integration tests (tables remain for Plan 1D)`

---

## Task 10: Full suite + lint + format

```bash
cd backend && set -a && . /Users/raphael/PycharmProjects/prumo/backend/.env && set +a && uv run pytest -q
cd backend && uv run ruff check . && uv run ruff format --check .
```

Expect all tests green, ruff clean. Apply `ruff format` if needed and commit chore.

---

## Self-review checklist

- ✅ All 6 endpoints implemented with auth + validation + error mapping
- ✅ Coordinate coherence enforced in all 3 writers
- ✅ `kind` derives from template
- ✅ Existing extraction services migrated to ProposalService
- ✅ 008 endpoints + their backing files dropped (tables remain)
- ✅ ~25 API contract tests + 4 coherence tests
- ✅ Full backend suite green

# Tasks: Unified Evaluation Data Model

**Input**: Design documents from `/specs/008-unified-evaluation-model/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Include backend integration and frontend/e2e verification tasks because the spec defines mandatory independent tests and measurable acceptance outcomes.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no unresolved dependency)
- **[Story]**: User story label (`[US1]`, `[US2]`, `[US3]`) for story-phase tasks only
- Every task includes an explicit target file path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize feature scaffolding and planning traceability.

- [ ] T001 Create evaluation domain migration skeleton in `backend/alembic/versions/` for unified model rollout
- [ ] T002 Export all new evaluation domain models in `backend/app/models/__init__.py` to ensure consistent import surface across repositories/services
- [ ] T003 [P] Implement evaluation query-key factory and read hooks (`useEvaluationRun`, `useReviewQueue`) in `frontend/hooks/evaluation/useEvaluationQueries.ts`
- [ ] T004 [P] Implement concrete `apiClient` DTOs and methods for evaluation runs/review/consensus/evidence endpoints in `frontend/integrations/api/client.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core database/contracts/auth/observability prerequisites required by all stories.

**⚠️ CRITICAL**: No user story implementation begins before this phase completes.

- [ ] T005 Implement shared PostgreSQL enums and registration updates in `backend/app/models/base.py`
- [ ] T006 Implement core evaluation SQLAlchemy models in `backend/app/models/evaluation_schema.py`
- [ ] T007 [P] Implement run and proposal SQLAlchemy models in `backend/app/models/evaluation_run.py`
- [ ] T008 [P] Implement review/consensus/published/evidence SQLAlchemy models in `backend/app/models/evaluation_decision.py`
- [ ] T009 Create Alembic migration for all evaluation tables, constraints, indexes, and RLS in `backend/alembic/versions/*_unified_evaluation_data_model.py`
- [ ] T010 Implement shared evaluation Pydantic base schemas in `backend/app/schemas/evaluation_common.py`
- [ ] T011 [P] Implement evaluation repository base helpers (project scope + optimistic lock guard) in `backend/app/repositories/evaluation_repository_base.py`
- [ ] T012 [P] Register evaluation API router and dependency wiring in `backend/app/api/v1/router.py`
- [ ] T013 Implement structured evaluation log and metric helper functions in `backend/app/services/evaluation_observability_service.py`
- [ ] T053 Implement endpoint security dependency helpers (JWT `user.sub` extraction and project-scope guards) in `backend/app/api/deps/security.py`
- [ ] T054 [P] Add API contract assertion helpers for `ApiResponse` envelope and `trace_id` in `backend/tests/integration/helpers/api_contract_assertions.py`

**Checkpoint**: Foundation ready - user story work can proceed.

---

## Phase 3: User Story 1 - Execute a Unified Evaluation Run (Priority: P1) 🎯 MVP

**Goal**: Managers can create runs, attach targets, and trigger proposal generation in one run context.

**Independent Test**: Create a run with targets and verify run state + proposal kickoff lifecycle remains linked to one run.

### Tests for User Story 1

- [ ] T014 [P] [US1] Add integration test for run creation and stage progression in `backend/tests/integration/test_evaluation_runs.py`
- [ ] T015 [P] [US1] Add integration test for async proposal kickoff endpoint in `backend/tests/integration/test_evaluation_proposal_generation.py`
- [ ] T016 [P] [US1] Add frontend run-flow test for create-and-start action in `frontend/test/unified-evaluation-run.test.ts`

### Implementation for User Story 1

- [ ] T017 [P] [US1] Implement run repository and run-target persistence in `backend/app/repositories/evaluation_run_repository.py`
- [ ] T018 [P] [US1] Implement proposal repository append-only write/query methods in `backend/app/repositories/evaluation_proposal_repository.py`
- [ ] T019 [US1] Implement run lifecycle service and stage transition rules in `backend/app/services/evaluation_run_service.py`
- [ ] T020 [US1] Implement async proposal kickoff orchestration in `backend/app/services/evaluation_proposal_service.py`
- [ ] T021 [US1] Implement run request/response schemas in `backend/app/schemas/evaluation_runs.py`
- [ ] T022 [US1] Implement run endpoints (`POST /evaluation-runs`, `GET /evaluation-runs/{runId}`, `POST /evaluation-runs/{runId}/proposal-generation`) in `backend/app/api/v1/endpoints/evaluation_runs.py`
- [ ] T023 [P] [US1] Implement frontend API methods for run creation/status/proposal kickoff in `frontend/services/evaluationService.ts`
- [ ] T024 [US1] Implement run management UI and hook integration in `frontend/components/extraction/UnifiedEvaluationRunPanel.tsx`
- [ ] T055 [US1] Implement schema version repository and service for create/publish workflow in `backend/app/repositories/evaluation_schema_version_repository.py` and `backend/app/services/evaluation_schema_version_service.py`
- [ ] T056 [US1] Implement schema version endpoints for create/publish in `backend/app/api/v1/endpoints/evaluation_schema_versions.py`
- [ ] T057 [P] [US1] Add integration tests for schema version create/publish lifecycle in `backend/tests/integration/test_evaluation_schema_versions.py`

**Checkpoint**: User Story 1 is independently functional and testable (MVP slice).

---

## Phase 4: User Story 2 - Support Independent Multi-Reviewer Decisions (Priority: P2)

**Goal**: Reviewers can submit independent decisions without overwriting each other and maintain reviewer-specific current state.

**Independent Test**: Two reviewers submit different decisions for same target-item; both history entries persist and each reviewer current state resolves correctly.

### Tests for User Story 2

- [ ] T025 [P] [US2] Add integration test for independent reviewer decisions on same item in `backend/tests/integration/test_evaluation_reviewer_decisions.py`
- [ ] T026 [P] [US2] Add integration test for reviewer state materialization updates in `backend/tests/integration/test_evaluation_reviewer_state.py`
- [ ] T027 [P] [US2] Add frontend review queue interaction test in `frontend/test/unified-evaluation-review-queue.test.ts`

### Implementation for User Story 2

- [ ] T028 [P] [US2] Implement reviewer decision repository in `backend/app/repositories/evaluation_reviewer_decision_repository.py`
- [ ] T029 [P] [US2] Implement reviewer state repository in `backend/app/repositories/evaluation_reviewer_state_repository.py`
- [ ] T030 [US2] Implement reviewer decision service (append history + state upsert) in `backend/app/services/evaluation_review_service.py`
- [ ] T031 [US2] Implement review queue and reviewer decision schemas in `backend/app/schemas/evaluation_review.py`
- [ ] T032 [US2] Implement reviewer endpoints (`GET /review-queue`, `POST /reviewer-decisions`) in `backend/app/api/v1/endpoints/evaluation_review.py`
- [ ] T033 [P] [US2] Implement frontend review queue and submit decision methods in `frontend/services/evaluationReviewService.ts`
- [ ] T034 [US2] Implement reviewer queue table with accept/reject/edit actions in `frontend/components/assessment/UnifiedReviewQueueTable.tsx`

**Checkpoint**: User Story 2 works independently while preserving US1 behavior.

---

## Phase 5: User Story 3 - Publish Final Consensus with Governance Controls (Priority: P3)

**Goal**: Final decision makers publish authoritative consensus via selected reviewer decision or manual override with justification.

**Independent Test**: Publish consensus using select-existing and override modes; validate optimistic conflict handling, justification requirement, and authoritative published state updates.

### Tests for User Story 3

- [ ] T035 [P] [US3] Add integration test for consensus publish success paths in `backend/tests/integration/test_evaluation_consensus_publish.py`
- [ ] T036 [P] [US3] Add integration test for optimistic concurrency conflict (`409`) in `backend/tests/integration/test_evaluation_consensus_conflicts.py`
- [ ] T037 [P] [US3] Add integration test for evidence attachment validation constraints in `backend/tests/integration/test_evaluation_evidence_upload.py`
- [ ] T038 [P] [US3] Add frontend consensus publish flow test in `frontend/test/unified-evaluation-consensus.test.ts`

### Implementation for User Story 3

- [ ] T039 [P] [US3] Implement consensus decision repository in `backend/app/repositories/evaluation_consensus_repository.py`
- [ ] T040 [P] [US3] Implement published-state repository with optimistic lock update in `backend/app/repositories/evaluation_published_state_repository.py`
- [ ] T041 [P] [US3] Implement evidence repository and metadata persistence in `backend/app/repositories/evaluation_evidence_repository.py`
- [ ] T042 [US3] Implement consensus publication service with override rules in `backend/app/services/evaluation_consensus_service.py`
- [ ] T043 [US3] Implement evidence upload service (size/type allowlist + storage path generation) in `backend/app/services/evaluation_evidence_service.py`
- [ ] T044 [US3] Implement consensus/evidence schemas in `backend/app/schemas/evaluation_consensus.py`
- [ ] T045 [US3] Implement consensus endpoints (`POST /consensus-decisions`, `POST /evidence-attachments/presign`) in `backend/app/api/v1/endpoints/evaluation_consensus.py`
- [ ] T046 [P] [US3] Implement frontend consensus/evidence API methods in `frontend/services/evaluationConsensusService.ts`
- [ ] T047 [US3] Implement final decision + evidence upload UI in `frontend/components/assessment/UnifiedConsensusPanel.tsx`
- [ ] T058 [US3] Implement schema promotion service for version compatibility initialization and no-recopy rules in `backend/app/services/evaluation_schema_promotion_service.py`
- [ ] T059 [P] [US3] Add integration tests to preserve prior-version published outcomes after promotion in `backend/tests/integration/test_evaluation_schema_promotion_history.py`
- [ ] T060 [P] [US3] Add integration tests for new/incompatible item status initialization during promotion in `backend/tests/integration/test_evaluation_schema_promotion_initialization.py`
- [ ] T061 [P] [US3] Add integration tests enforcing item type immutability after extraction in `backend/tests/integration/test_evaluation_item_type_immutability.py`
- [ ] T062 [P] [US3] Add integration tests preventing automatic value recopy on add/remove schema evolution in `backend/tests/integration/test_evaluation_schema_no_recopy.py`

**Checkpoint**: User Story 3 is independently functional and all stories remain compatible.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end hardening, clean-slate verification, and documentation.

- [ ] T048 [P] Add end-to-end unified workflow scenario (run -> review -> publish) in `frontend/e2e/unified-evaluation-flow.e2e.ts`
- [ ] T049 Add clean-slate reset and migration verification guide in `docs/unified-evaluation-clean-slate.md`
- [ ] T050 [P] Add quickstart verification notes and command outcomes in `specs/008-unified-evaluation-model/quickstart.md`
- [ ] T051 Add observability dashboard/query examples for required metrics in `docs/extraction-e2e-observability.md`
- [ ] T052 Run full validation checklist and record execution evidence in `docs/unified-evaluation-validation.md`
- [ ] T063 Implement reviewer turnaround SLA metric/reporting pipeline for one-business-day target in `backend/app/services/evaluation_sla_metrics_service.py`
- [ ] T064 [P] Add integration tests for unauthorized read/write attempts across run/review/consensus endpoints in `backend/tests/integration/test_evaluation_authorization.py`
- [ ] T065 [P] Add integration tests for endpoint rate limiting and uniform `ApiResponse` + `trace_id` conformance in `backend/tests/integration/test_evaluation_api_contract_security.py`
- [ ] T066 Apply `@limiter.limit(...)`, `ApiResponse` envelope, and trace propagation across evaluation endpoints in `backend/app/api/v1/endpoints/evaluation_runs.py`, `backend/app/api/v1/endpoints/evaluation_review.py`, `backend/app/api/v1/endpoints/evaluation_consensus.py`, and `backend/app/api/v1/endpoints/evaluation_schema_versions.py`
- [ ] T067 Implement queue-backlog scaling trigger (`>500 items for 15 minutes`) and alert emission in `backend/app/services/evaluation_observability_service.py`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies
- **Phase 2 (Foundational)**: Depends on Phase 1; blocks all story phases
- **Phase 3 (US1)**: Depends on Phase 2; delivers MVP
- **Phase 4 (US2)**: Hybrid dependency - may start only after US1 checkpoint validates core run/proposal contracts
- **Phase 5 (US3)**: Hybrid dependency - may start after US1 checkpoint; full select-existing flow validates after US2 reviewer decisions are available
- **Phase 6 (Polish)**: Depends on completion of selected stories (minimum US1 for MVP, all stories for full release)
- **Security/API conformance closure**: `T064-T066` should run before final sign-off to satisfy constitution MUST controls

### User Story Dependencies

- **US1 (P1)**: Starts after foundational phase; no dependency on US2/US3
- **US2 (P2)**: Starts after US1 checkpoint (hybrid policy), then proceeds independently with incremental integration
- **US3 (P3)**: Starts after US1 checkpoint (hybrid policy), with final validation of select-existing consensus after US2 outputs exist

### Within Each User Story

- Tests first (should fail initially), then repositories/models, then services, then endpoints, then frontend integration.

### Parallel Opportunities

- Foundational model files (`T006`, `T007`, `T008`) can be developed in parallel.
- US1 repository tasks (`T017`, `T018`) can run in parallel.
- US2 repository tasks (`T028`, `T029`) can run in parallel.
- US3 repository tasks (`T039`, `T040`, `T041`) can run in parallel.
- Frontend service tasks in each story can run in parallel with backend schema work once contracts stabilize.
- Security verification tasks (`T064`, `T065`) can run in parallel after endpoint implementations are complete.

---

## Parallel Example: User Story 1

```bash
# Backend US1 repositories in parallel
Task: "T017 [US1] Implement run repository in backend/app/repositories/evaluation_run_repository.py"
Task: "T018 [US1] Implement proposal repository in backend/app/repositories/evaluation_proposal_repository.py"

# US1 tests in parallel
Task: "T014 [US1] Add run lifecycle integration test in backend/tests/integration/test_evaluation_runs.py"
Task: "T015 [US1] Add proposal kickoff integration test in backend/tests/integration/test_evaluation_proposal_generation.py"
```

## Parallel Example: User Story 2

```bash
# Backend US2 repositories in parallel
Task: "T028 [US2] Implement reviewer decision repository in backend/app/repositories/evaluation_reviewer_decision_repository.py"
Task: "T029 [US2] Implement reviewer state repository in backend/app/repositories/evaluation_reviewer_state_repository.py"

# US2 tests in parallel
Task: "T025 [US2] Add reviewer independence test in backend/tests/integration/test_evaluation_reviewer_decisions.py"
Task: "T026 [US2] Add reviewer state test in backend/tests/integration/test_evaluation_reviewer_state.py"
```

## Parallel Example: User Story 3

```bash
# Backend US3 repositories in parallel
Task: "T039 [US3] Implement consensus repository in backend/app/repositories/evaluation_consensus_repository.py"
Task: "T040 [US3] Implement published-state repository in backend/app/repositories/evaluation_published_state_repository.py"
Task: "T041 [US3] Implement evidence repository in backend/app/repositories/evaluation_evidence_repository.py"

# US3 validation tests in parallel
Task: "T036 [US3] Add consensus conflict integration test in backend/tests/integration/test_evaluation_consensus_conflicts.py"
Task: "T037 [US3] Add evidence validation integration test in backend/tests/integration/test_evaluation_evidence_upload.py"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2
2. Complete all US1 tasks (Phase 3)
3. Validate independent US1 tests and run flow
4. Demo/deploy MVP baseline

### Incremental Delivery

1. Build MVP with US1
2. Add US2 for independent reviewer governance
3. Add US3 for authoritative publication and evidence constraints
4. Finish with Phase 6 cross-cutting hardening and clean-slate verification

### Parallel Team Strategy

1. Team aligns on Phase 1/2 foundational contracts and migration
2. After Phase 2:
   - Developer A focuses US1 backend/frontend
   - Developer B focuses US2 backend/frontend
   - Developer C focuses US3 backend/frontend
3. Integrate at story checkpoints with full regression tests

---

## Notes

- `[P]` tasks are safe for parallel execution when dependencies are satisfied.
- Every story phase has explicit independent test criteria.
- This plan enforces development clean-slate rollout (no legacy data migration tasks).
- Commit in logical groups per phase or per story slice for easier review.

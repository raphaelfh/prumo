# Implementation Plan: AI Assessment Flow

**Branch**: `002-ai-assessment-flow` | **Date**: 2026-02-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-ai-assessment-flow/spec.md`

## Summary

Wire the existing frontend AI assessment hooks (`useSingleAssessment`, `useAIAssessmentSuggestions`) to the assessment form UI (`AssessmentFormPanel` → `AssessmentFormView` → `AssessmentItemInput`) so reviewers can trigger, accept, and reject AI quality assessment suggestions. The backend is fully functional (4 endpoints, run tracking, PDF processing). The work is frontend-only: integrate existing hooks into the form, add batch assessment orchestration, consolidate duplicated AI suggestion components (DRY), and migrate `AssessmentService` to use `apiClient`.

## Technical Context

**Language/Version**: Python 3.11+ (backend, no changes needed), TypeScript 5.8 (frontend)
**Primary Dependencies**: React 18, TanStack Query v5, Zustand, shadcn/ui, FastAPI (backend, existing)
**Storage**: PostgreSQL via Supabase (existing tables: `ai_assessment_runs`, `ai_suggestions`, `ai_assessments`)
**Testing**: Vitest + @testing-library/react (frontend)
**Target Platform**: Web application (desktop browser)
**Project Type**: Web application (frontend + backend)
**Performance Goals**: Single item suggestion < 30s, batch (15-30 items) < 5 minutes
**Constraints**: Must reuse ≥70% of extraction AI flow patterns (SC-008)
**Scale/Scope**: Typical instrument has 15-30 assessment items, articles up to 50 pages

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Layered Architecture | PASS | No backend changes. Frontend follows component → hook → service layering. |
| II. Dependency Injection | PASS | Services injected via hooks. No new singletons. |
| III. Supabase Migrations | PASS | All tables already exist. No new migrations needed. |
| IV. Security by Design | PASS | User ID from JWT (existing). BYOK API keys encrypted at rest (existing). |
| V. Typed Everything | PASS | TypeScript strict mode. All new interfaces/types defined. |
| VI. Frontend Conventions | VIOLATION → FIX | `AssessmentService` uses custom `fetchBackend()` instead of `apiClient`. Will migrate to `apiClient` as part of this feature. |
| VII. Async All The Way | PASS | All API calls are async. Backend uses async SQLAlchemy. |
| VIII. Standardized API Contract | PASS | Backend endpoints already return `ApiResponse` envelope. |

**Constitution Check Result**: PASS (1 violation being fixed as part of this feature)

## Project Structure

### Documentation (this feature)

```text
specs/002-ai-assessment-flow/
├── plan.md              # This file
├── research.md          # Phase 0: 6 research decisions
├── data-model.md        # Phase 1: 4 entities (all existing)
├── quickstart.md        # Phase 1: Integration scenarios
├── contracts/           # Phase 1: API contract definitions
│   └── api-endpoints.md # 4 existing backend endpoints
├── checklists/
│   └── requirements.md  # Spec quality validation (16/16 pass)
├── spec.md              # Feature specification
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
# Frontend (primary changes)
src/
├── components/
│   ├── assessment/
│   │   ├── AssessmentFormPanel.tsx      # MODIFY: Wire AI hooks to form
│   │   ├── AssessmentFormView.tsx       # EXISTING: Already passes AI props
│   │   ├── DomainAccordion.tsx          # EXISTING: Already passes AI props
│   │   ├── AssessmentItemInput.tsx      # EXISTING: Already accepts AI props
│   │   └── ai/
│   │       ├── AISuggestionInline.tsx   # EXISTING: Inline suggestion display
│   │       └── shared/                  # DELETE: Move to shared location
│   ├── shared/
│   │   └── ai-suggestions/             # NEW: Consolidated shared components
│   │       ├── AISuggestionActions.tsx  # MOVED from extraction + assessment
│   │       ├── AISuggestionConfidence.tsx
│   │       ├── AISuggestionValue.tsx
│   │       └── AISuggestionDetails.tsx
│   └── extraction/
│       └── ai/shared/                  # UPDATE: Import from shared location
├── hooks/
│   └── assessment/
│       ├── ai/
│       │   ├── useSingleAssessment.ts      # EXISTING: Single item trigger
│       │   ├── useAIAssessmentSuggestions.ts # EXISTING: Suggestion management
│       │   └── useBatchAssessment.ts        # NEW: Batch orchestration hook
│       └── useProjectAssessmentInstruments.ts # EXISTING
├── services/
│   ├── assessmentService.ts                # MODIFY: Migrate to apiClient
│   └── aiAssessmentSuggestionService.ts    # EXISTING: Direct Supabase queries
└── integrations/
    └── api/
        └── client.ts                       # EXISTING: Canonical API client

# Backend (NO changes needed for core flow)
backend/
└── app/
    ├── api/v1/endpoints/
    │   └── ai_assessment.py            # EXISTING: 4 routes
    ├── services/
    │   └── ai_assessment_service.py    # EXISTING: assess() + assess_batch()
    ├── models/
    │   ├── assessment.py               # EXISTING: AIAssessmentRun, AIAssessment
    │   └── extraction.py               # EXISTING: AISuggestion (shared)
    ├── schemas/
    │   └── assessment.py               # EXISTING: Request/Response schemas
    └── repositories/
        └── assessment_repository.py    # EXISTING: AI assessment repos
```

**Structure Decision**: Web application (frontend + backend). This feature is **frontend-only** — all backend infrastructure exists. Changes are concentrated in `src/components/assessment/`, `src/hooks/assessment/ai/`, `src/services/assessmentService.ts`, and a new `src/components/shared/ai-suggestions/` directory for DRY consolidation.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `AssessmentService` uses `fetchBackend()` | Constitution VI requires `apiClient` | Keeping `fetchBackend()` violates Constitution Principle VI and duplicates auth/error handling logic already in `apiClient` |

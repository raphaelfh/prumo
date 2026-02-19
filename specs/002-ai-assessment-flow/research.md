# Research: AI Assessment Flow

**Date**: 2026-02-18
**Branch**: `002-ai-assessment-flow`

## R1: Backend AI Assessment Status

**Decision**: Backend is fully functional. No backend code changes needed for core flow.

**Rationale**: The backend already implements:
- `POST /api/v1/ai-assessment/ai` - single item assessment (creates AISuggestion, not final AIAssessment)
- `POST /api/v1/ai-assessment/ai/batch` - batch assessment with memory context
- `GET /api/v1/ai-assessment/ai/suggestions` - list suggestions with filters
- `POST /api/v1/ai-assessment/ai/suggestions/{id}/review` - accept/reject/modify
- Full run tracking via `AIAssessmentRun` (pending → running → completed/failed)
- PDF preparation (direct < 32MB, file_search fallback)
- Instrument-specific prompts (PROBAST, QUADAS-2, ROB-2)
- BYOK (Bring Your Own Key) support for OpenAI

**Alternatives considered**: Building new backend endpoints was considered unnecessary since all 4 routes exist and handle the full lifecycle.

## R2: Frontend Connection Gap

**Decision**: The frontend has all building blocks but they are NOT wired together. The fix is a single integration component.

**Rationale**: Research found:
- `useSingleAssessment` hook exists - calls `AssessmentService.assessSingleItem()`
- `useAIAssessmentSuggestions` hook exists - loads/accepts/rejects suggestions
- `AssessmentItemInput` accepts `onTriggerAI`, `onAcceptAI`, `onRejectAI` props
- `AssessmentFormView` → `DomainAccordion` → `AssessmentItemInput` all pass AI props through
- **BUT**: No parent component instantiates the hooks and passes callbacks down
- `AssessmentFormPanel` is the integration point - it needs to wire hooks to the form

**Alternatives considered**: Creating new components was rejected in favor of connecting existing ones (KISS).

## R3: Shared vs Duplicated Components

**Decision**: Several AI suggestion components are identically duplicated between extraction and assessment. Consolidate to shared location.

**Rationale**:
- `AISuggestionActions.tsx` - IDENTICAL in both `extraction/ai/shared/` and `assessment/ai/shared/`
- `AISuggestionConfidence.tsx` - same pattern
- `AISuggestionValue.tsx` - same pattern
- `AISuggestionDetails.tsx` - same pattern

Moving to `src/components/shared/ai-suggestions/` follows DRY principle from spec.

**Alternatives considered**: Keeping duplicates was rejected per explicit DRY requirement in feature spec.

## R4: AssessmentService HTTP Client

**Decision**: Migrate `AssessmentService` from custom `fetchBackend()` to `apiClient`.

**Rationale**: Constitution Principle VI requires `apiClient` from `src/integrations/api/client.ts` as the canonical HTTP client. The current `AssessmentService` reimplements auth token management, error handling, and timeout logic that `apiClient` already provides.

**Alternatives considered**: Keeping `fetchBackend()` violates Constitution Principle VI (Frontend Conventions).

## R5: Batch Assessment Orchestration

**Decision**: Use frontend-orchestrated batch (sequential API calls per item) with the existing batch endpoint as an optimization.

**Rationale**: The extraction gold standard uses `useFullAIExtraction` which orchestrates multiple sequential calls with progress tracking. The assessment backend already has `POST /api/v1/ai-assessment/ai/batch` which loads PDF once and maintains memory context. Using the batch endpoint is simpler and more efficient than N individual calls.

**Alternatives considered**: Individual calls per item (extraction pattern) was rejected because assessment batch endpoint already handles PDF reuse and memory context.

## R6: Suggestion Key Format

**Decision**: Keep assessment suggestion key as `ai_suggestion_${itemId}`.

**Rationale**: This differs from extraction's `${instanceId}_${fieldId}` key format because assessment items are identified by a single ID (not a composite key). The existing `useAIAssessmentSuggestions` hook already uses this format. No change needed.

**Alternatives considered**: Unifying key format was rejected because the domain models are fundamentally different.

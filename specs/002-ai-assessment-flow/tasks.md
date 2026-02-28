# Tasks: AI Assessment Flow

**Input**: Design documents from `/specs/002-ai-assessment-flow/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in spec. Tests are omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

**Reference**: The extraction AI flow is the gold standard. All assessment AI patterns must mirror extraction equivalents:

- `frontend/pages/ExtractionFullScreen.tsx` → page-level hook wiring
- `frontend/hooks/extraction/ai/useAISuggestions.ts` → suggestion management
- `frontend/hooks/extraction/useFullAIExtraction.ts` → batch orchestration
- `frontend/components/extraction/header/HeaderAIActions.tsx` → badge + header actions
- `frontend/components/extraction/ai/AISuggestionInline.tsx` → inline display with history

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new project setup needed — all backend infrastructure exists, frontend project is already configured. Skip to Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Migrate service layer to canonical API client (Constitution VI fix) and consolidate duplicated shared AI suggestion components (DRY). These changes are prerequisites for all user stories.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T001 Migrate `AssessmentService` from `fetchBackend()` to `apiClient` in `frontend/services/assessmentService.ts`.
  Mirror how extraction uses `sectionExtractionClient()` from `frontend/integrations/api/client.ts` (lines 244-253).
  Specifically: (1) Remove the custom `fetchBackend()` function and `getAuthToken()` helper. (2) Replace all 4 methods (
  `assessSingleItem`, `assessBatch`, `listSuggestions`, `reviewSuggestion`) to use `apiClient()` with the
  `/api/v1/ai-assessment` base path. (3) Use `timeout: 120000` for AI assessment calls (same as extraction's 120s
  timeout). (4) Errors should throw `ApiError` (from client.ts) instead of custom `APIError`. (5) Preserve all existing
  method signatures and return types so hooks don't break.

- [x] T002 [P] Create consolidated shared AI suggestion components in `frontend/components/shared/ai-suggestions/`.
  Create the directory and move these 4 components from `frontend/components/extraction/ai/shared/` (the established
  versions): `AISuggestionActions.tsx`, `AISuggestionConfidence.tsx`, `AISuggestionValue.tsx`,
  `AISuggestionDetailsPopover.tsx`. Make them generic over suggestion type by accepting a minimal interface:
  `{ confidence_score: number; reasoning: string; status: string; suggested_value: unknown }`. Create
  `frontend/components/shared/ai-suggestions/index.ts` barrel export.

- [x] T003 Update extraction AI shared imports to use consolidated components. Update all files in
  `frontend/components/extraction/ai/` that import from `./shared/` or `../shared/` to import from
  `@/components/shared/ai-suggestions` instead. Replace `frontend/components/extraction/ai/shared/index.ts` to re-export
  from the shared location for backwards compatibility. Verify
  `frontend/components/extraction/ai/AISuggestionInline.tsx` still works.

- [x] T004 Update assessment AI shared imports to use consolidated components. Update all files in
  `frontend/components/assessment/ai/` that import from `./shared/` or `../shared/` to import from
  `@/components/shared/ai-suggestions` instead. Replace `frontend/components/assessment/ai/shared/index.ts` to re-export
  from the shared location for backwards compatibility. Verify
  `frontend/components/assessment/ai/AISuggestionInline.tsx` still works.

**Checkpoint**: Service layer uses canonical `apiClient`, shared AI components are deduplicated. TypeScript must compile cleanly.

---

## Phase 3: User Story 1 - Trigger AI Assessment for a Single Item (Priority: P1) MVP

**Goal**: A reviewer can click "Avaliar com IA" on any assessment item and see an AI suggestion appear inline with the suggested level, confidence score, and reasoning.

**Independent Test**: Open an article's assessment form, click "Avaliar com IA" on one item, verify a suggestion appears with level, confidence %, and reasoning text.

**Extraction Reference**: In extraction, single section extraction is triggered via hooks and results are polled using a 5-attempt polling strategy in `ExtractionFullScreen.tsx` `handleExtractionComplete()` (lines 725-809).

### Implementation for User Story 1

- [x] T005 [US1] Fix suggestion key mismatch in `frontend/components/assessment/DomainAccordion.tsx`. The hook (
  `useAIAssessmentSuggestions`) keys suggestions as `ai_suggestion_${itemId}` via `getAssessmentSuggestionKey()`, but
  `DomainAccordion` looks them up with raw `aiSuggestions?.[item.id]`. Import `getAssessmentSuggestionKey` from
  `frontend/services/aiAssessmentSuggestionService.ts` and change the lookup to
  `aiSuggestions?.[getAssessmentSuggestionKey(item.id)]`. This is the critical bug preventing any suggestion from ever
  displaying.

- [x] T006 [US1] Add polling-based suggestion refresh after AI assessment completes in
  `frontend/pages/AssessmentFullScreen.tsx`. Mirror extraction's `handleExtractionComplete()` pattern (
  ExtractionFullScreen.tsx lines 725-809): (1) After `useSingleAssessment.onSuccess` fires, wait 1.5s for backend
  sync. (2) Call `refreshSuggestions()` and check `result.count > 0`. (3) If no suggestions found, retry up to 5 times
  with 1s delay between attempts. (4) Log progress: `"Attempt X/5: Reloading suggestions..."`. (5) Run as a non-blocking
  IIFE so the UI stays responsive. Replace the current simple `await refreshSuggestions()` in the `onSuccess` callback.

- [x] T007 [US1] Verify and fix `handleTriggerAI` in `frontend/pages/AssessmentFullScreen.tsx` (lines 160-177). Ensure
  it passes all required parameters to `useSingleAssessment.assessItem()`: `projectId`, `articleId`, `instrumentId`,
  `assessmentItemId`. Add no-PDF validation: before calling `assessItem`, check if the article has a PDF file (via
  `article.files` or similar). If no PDF, show `toast.error("PDF necessário para avaliação com IA")` and abort. This
  mirrors extraction's pre-flight PDF check.

- [x] T008 [US1] Verify loading state feedback works end-to-end in
  `frontend/components/assessment/AssessmentItemInput.tsx`. With T005 fixed, the "Avaliar com IA" button should: (1)
  show spinner when `isTriggerLoading` is true; (2) be disabled during loading; (3) hide when a pending suggestion
  exists; (4) show again if suggestion is rejected. After assessment completes, the purple suggestion card should render
  with `AISuggestionInline` showing the level, confidence %, and reasoning. Test the full cycle visually.

**Checkpoint**: Clicking "Avaliar com IA" triggers the backend, polls for the suggestion, and displays it inline. User Story 1 is fully functional.

---

## Phase 4: User Story 2 - Accept or Reject AI Suggestions (Priority: P1)

**Goal**: A reviewer can accept (auto-filling the assessment response) or reject (dismissing) any AI suggestion, with the form state updating immediately.

**Independent Test**: Trigger an AI assessment (US1), then accept or reject the resulting suggestion, verify the form state updates correctly.

**Extraction Reference**: In extraction, accept calls `onSuggestionAccepted(instanceId, fieldId, value)` which calls `updateValue()` to fill the form. Reject calls `onSuggestionRejected(instanceId, fieldId)` which calls `updateValue(instanceId, fieldId, null)` to CLEAR the field. See `ExtractionFullScreen.tsx` lines 136-152.

### Implementation for User Story 2

- [x] T009 [US2] Verify `handleAISuggestionAccepted` callback in `frontend/pages/AssessmentFullScreen.tsx` (lines
  106-115). It should map the accepted suggestion's `level` to `selected_level` and `evidence_passages` to `evidence` in
  the `AssessmentResponse`, then call `updateResponse(itemId, response)`. Currently it does this — verify the mapping is
  correct: `{ selected_level: suggestionValue.level, notes: null, evidence: suggestionValue.evidence_passages || [] }`.
  Ensure `confidence` from the suggestion is also preserved if applicable.

- [x] T010 [US2] Fix `handleAISuggestionRejected` callback in `frontend/pages/AssessmentFullScreen.tsx` (lines 126-129).
  Currently it's a NO-OP (just logs). Mirror extraction's pattern (ExtractionFullScreen.tsx line 151):
  `updateValue(instanceId, fieldId, null)`. Change to:
  `updateResponse(itemId, { selected_level: '', notes: null, evidence: [] })` to clear the form field when a suggestion
  is rejected. This ensures reject actually has a visible effect, matching extraction behavior where reject clears the
  extracted value.

- [x] T011 [US2] Add suggestion history popover to `frontend/components/assessment/ai/AISuggestionInline.tsx`. Mirror
  extraction's `AISuggestionInline` (extraction/ai/AISuggestionInline.tsx lines 31-82): when a suggestion is accepted,
  show an `AISuggestionHistoryPopover` (or a simpler "IA aceita" badge with re-reject capability). Currently assessment
  shows only a plain "IA aceita" text. Add: (1) an `itemId` prop and `getHistory` optional prop to the component. (2)
  When `getHistory` is provided and suggestion is accepted, render a clickable badge that can show history or allow
  re-rejecting. (3) Pass `getSuggestionsHistory` from `useAIAssessmentSuggestions` through the component chain.

- [x] T012 [US2] Wire history popover through the component chain. In `frontend/pages/AssessmentFullScreen.tsx`, add
  `getSuggestionsHistory` to the `formViewProps` passed to `AssessmentFormPanel`. Update `AssessmentFormViewProps` in
  `frontend/components/assessment/AssessmentFormView.tsx` to accept
  `getSuggestionsHistory?: (itemId: string, limit?: number) => Promise<AIAssessmentSuggestionHistoryItem[]>`. Pass it
  through `DomainAccordion` → `AssessmentItemInput` → `AISuggestionInline`. Mirror how extraction passes
  `getSuggestionsHistory` through its component chain.

**Checkpoint**: Accept fills the form response. Reject clears it. Accepted suggestions show a history badge. All operations update the UI immediately. User Stories 1 AND 2 are fully functional.

---

## Phase 5: User Story 3 - Batch AI Assessment (Priority: P2)

**Goal**: A reviewer can click "Avaliar Tudo com IA" to process all assessment items at once, with progress tracking and partial failure handling.

**Independent Test**: Click "Avaliar Tudo com IA" on an article with a multi-item instrument and verify all items receive suggestions with progress shown.

**Extraction Reference**: `useFullAIExtraction.ts` (lines 72-279) orchestrates multi-phase extraction with parallel/sequential phases, progress state `{ stage, modelsProgress, topLevelSectionsProgress }`, and floating progress display `FullAIExtractionProgress`. Header uses `HeaderAIActions` for the trigger button.

### Implementation for User Story 3

- [x] T013 [US3] Create `useBatchAssessment` hook in `frontend/hooks/assessment/ai/useBatchAssessment.ts`. Mirror
  `useFullAIExtraction` pattern (extraction/useFullAIExtraction.ts lines 72-279). Interface:
  `useBatchAssessment(options?: { onComplete?: () => Promise<void> }): { assessBatch: (params) => Promise<void>, loading: boolean, error: string | null, progress: BatchAssessmentProgress | null }`.
  The `assessBatch` function should: (1) Accept `{ projectId, articleId, instrumentId, items, existingResponses }`. (2)
  Filter out items that already have accepted responses (from `existingResponses`). (3) Call
  `AssessmentService.assessBatch()` with remaining item IDs. (4) Track progress:
  `{ current: number, total: number, stage: 'assessing' }`. (5) On completion, fire `onComplete` callback (which should
  trigger `refreshSuggestions`). (6) Show success toast with count:
  `"Avaliação em lote concluída! X sugestões criadas"`. (7) Handle errors with toast and set `error` state.

- [x] T014 [US3] Create `AssessmentHeaderAIActions` component in
  `frontend/components/assessment/ai/AssessmentHeaderAIActions.tsx`. Mirror extraction's `HeaderAIActions` pattern (
  extraction/header/HeaderAIActions.tsx lines 26-95). Props:
  `{ suggestions: Record<string, AIAssessmentSuggestion>, onBatchAssess: () => void, batchLoading: boolean, batchProgress: BatchAssessmentProgress | null }`.
  Render: (1) "Avaliar Tudo com IA" button with `Sparkles` icon — disabled when `batchLoading`. (2) During batch:
  replace button text with progress "Avaliando X de Y". (3) Pending suggestions badge (count of `status === 'pending'`
  suggestions) — hide when 0, cap at "99+". Use `Brain` icon + `Badge` component with tooltip showing "X sugestões de IA
  pendentes". onClick scrolls to first pending suggestion.

- [x] T015 [US3] Create `BatchAssessmentProgress` floating display in
  `frontend/components/assessment/ai/BatchAssessmentProgress.tsx`. Mirror extraction's `FullAIExtractionProgress`
  pattern. Render as a fixed-position card at bottom-right (`fixed bottom-6 right-6 z-[9999] w-96`). Show: (1) Stage
  description: "Avaliando qualidade com IA". (2) Progress bar or text: "Item X de Y". (3) Close button to dismiss. (4)
  Minimize button. Only show when `batchLoading && batchProgress` is truthy.

- [x] T016 [US3] Integrate batch assessment in `frontend/pages/AssessmentFullScreen.tsx`. (1) Instantiate
  `useBatchAssessment` hook with `onComplete: refreshSuggestions`. (2) Add `AssessmentHeaderAIActions` to the page
  header area, passing `aiSuggestions`, batch handler, batch loading state, and batch progress. (3) Create
  `handleBatchAssess` function that calls
  `assessBatch({ projectId, articleId, instrumentId, items, existingResponses: responses })`. (4) Render
  `BatchAssessmentProgress` at the page level (fixed position) when batch is running, with minimize/close controls. (5)
  After batch completes, use the same polling-based refresh from T006 to load all suggestions.

**Checkpoint**: "Avaliar Tudo com IA" processes all items via batch endpoint. Floating progress shows "Item X de Y". Suggestions appear for all items. Header badge shows pending count.

---

## Phase 6: User Story 4 - Batch Accept High-Confidence Suggestions (Priority: P3)

**Goal**: A reviewer can accept all suggestions above a confidence threshold in one click. Badge updates reactively.

**Independent Test**: Run a batch assessment, click "Aceitar com alta confianca", verify all high-confidence suggestions are accepted and badge updates.

**Extraction Reference**: Extraction has suggestion count badge in `HeaderAIActions`. Assessment's `useAIAssessmentSuggestions` already exposes `batchAccept(threshold)` — just needs UI wiring.

### Implementation for User Story 4

- [x] T017 [US4] Add "Aceitar com alta confianca" button to `AssessmentHeaderAIActions` in
  `frontend/components/assessment/ai/AssessmentHeaderAIActions.tsx`. Add a new prop:
  `onBatchAccept: (threshold: number) => Promise<number>`. Show this button only when there are pending suggestions (
  count > 0). On click, call `onBatchAccept(0.80)`. Show the count of accepted suggestions in a success toast:
  `"X sugestões aceitas automaticamente"`. Disable button while processing. Use `CheckCheck` icon from lucide-react.

- [x] T018 [US4] Wire batch accept in `frontend/pages/AssessmentFullScreen.tsx`. Pass
  `useAIAssessmentSuggestions.batchAccept` to `AssessmentHeaderAIActions` as `onBatchAccept`. After `batchAccept`
  completes, the `onSuggestionAccepted` callback should fire for each accepted suggestion (this happens inside the
  hook). Verify the badge count decreases reactively as suggestions move from `pending` to `accepted`. Verify form
  responses update for all batch-accepted items.

**Checkpoint**: Badge shows pending count, "Aceitar com alta confianca" processes high-confidence suggestions. Form updates for all accepted items. Badge decreases.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and cleanup across all user stories.

- [x] T019 Verify TypeScript compilation passes with zero errors by running `npx tsc --noEmit` from project root
- [x] T020 [P] Remove obsolete shared component files. After T003 and T004, delete the original component files from
  `frontend/components/extraction/ai/shared/` and `frontend/components/assessment/ai/shared/` (keeping only the
  re-export index.ts files if needed). Verify no imports reference the old direct file paths.
- [x] T021 Run quickstart.md validation — walk through all 4 integration scenarios in `specs/002-ai-assessment-flow/quickstart.md` to verify end-to-end functionality

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Skipped — no new setup needed
- **Foundational (Phase 2)**: No dependencies — can start immediately. BLOCKS all user stories.
- **US1 (Phase 3)**: Depends on Phase 2 completion (apiClient migration + shared components)
- **US2 (Phase 4)**: Depends on Phase 3 (US1) — cannot test accept/reject without a suggestion to act on
- **US3 (Phase 5)**: Depends on Phase 2 + Phase 3 (needs key fix from T005 and polling from T006)
- **US4 (Phase 6)**: Depends on Phase 5 (US3) — uses the header component created in US3
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — no dependencies on other stories
- **US2 (P1)**: Depends on US1 (needs suggestions to exist for accept/reject testing)
- **US3 (P2)**: Depends on US1 (needs key fix and polling pattern)
- **US4 (P3)**: Depends on US3 (uses the header component created in US3)

### Within Each User Story

- Fix data layer issues first (key mismatch, service migration)
- Then fix hook integration (polling, callbacks)
- Then fix component rendering (inline display, history, header)
- Commit after each task or logical group

### Parallel Opportunities

**Phase 2 (Foundational):**
```
T001 (migrate assessmentService)  ──── independent
T002 (create shared components)   ──── independent (T003/T004 depend on T002)
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 Only)

1. Complete Phase 2: Foundational (T001-T004) — apiClient migration + DRY consolidation
2. Complete Phase 3: US1 (T005-T008) — fix key mismatch + polling + trigger verification
3. Complete Phase 4: US2 (T009-T012) — fix rejection callback + add history popover
4. **STOP and VALIDATE**: Test single-item AI assessment end-to-end
5. This delivers the core value proposition

### Incremental Delivery

1. Phase 2 (Foundational) → Service layer modernized, DRY achieved
2. Phase 3 (US1) + Phase 4 (US2) → Core AI assessment works (MVP!)
3. Phase 5 (US3) → Batch assessment + progress display + header badge
4. Phase 6 (US4) → Batch accept high-confidence
5. Phase 7 (Polish) → Final validation

### Key Extraction Patterns to Mirror

| Pattern | Extraction File | Assessment Equivalent |
|---------|----------------|----------------------|
| Page-level hook wiring | `ExtractionFullScreen.tsx` | `AssessmentFullScreen.tsx` (exists, needs fixes) |
| Suggestion management | `useAISuggestions.ts` | `useAIAssessmentSuggestions.ts` (exists, works) |
| Single item trigger | `useSectionExtraction.ts` | `useSingleAssessment.ts` (exists, works) |
| Batch orchestration | `useFullAIExtraction.ts` | `useBatchAssessment.ts` (NEW - T013) |
| Header badge + actions | `HeaderAIActions.tsx` | `AssessmentHeaderAIActions.tsx` (NEW - T014) |
| Floating progress | `FullAIExtractionProgress.tsx` | `BatchAssessmentProgress.tsx` (NEW - T015) |
| Inline suggestion + history | `AISuggestionInline.tsx` (extraction) | `AISuggestionInline.tsx` (assessment, needs history - T011) |
| Polling-based refresh | `handleExtractionComplete()` | Polling in `onSuccess` callback (NEW - T006) |
| Rejection clears field | `updateValue(id, field, null)` | `updateResponse(itemId, empty)` (FIX - T010) |
| API client | `sectionExtractionClient()` | Migrated `assessmentService` (FIX - T001) |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Backend is fully functional — all tasks are frontend-only
- The key mismatch bug (T005) is the single most impactful fix — once resolved, suggestions display
- The rejection callback (T010) is the second most impactful fix — extraction clears the field, assessment doesn't
- Polling-based refresh (T006) mirrors extraction's robust 5-attempt strategy
- History popover (T011-T012) brings assessment inline with extraction's UX
- assessmentService migration (T001) is required by Constitution Principle VI
- Shared component consolidation (T002-T004) satisfies FR-013 and SC-008 (70% reuse)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently

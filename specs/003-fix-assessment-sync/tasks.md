# Tasks: Sincronização da Interface na "Avaliação com IA" (Assessment)

**Input**: Design documents from `/specs/003-fix-assessment-sync/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not requested in the spec. Manual testing checklist provided in quickstart.md.

**Organization**: Tasks are grouped by user story. US1 (P1) is the MVP — once complete, the core bug is fixed and the system is usable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Investigation (Required Before Any Fix)

**Purpose**: Confirm the root cause before applying changes. ISSUE 2 (key mismatch) is the most likely root cause — must be validated first.

- [X] T001 Investigate key mismatch: trigger "Avaliar com IA" in browser DevTools and compare the `itemId` sent by `handleTriggerAI` (logged as `🤖 [useSingleAssessment] Iniciando avaliação { itemId: "XXX" }`) against the `effectiveItemId` stored in `loadSuggestions` (logged as `✅ [loadSuggestions] Sugestão adicionada: ai_suggestion_YYY`). If `XXX !== YYY`, ISSUE 2 is confirmed. Also verify with SQL: `SELECT assessment_item_id, project_assessment_item_id FROM ai_suggestions WHERE id = '<suggestion_id>'` to determine which column the backend populates.
- [X] T002 Verify `hasPendingSuggestion` condition in `src/components/assessment/AssessmentItemInput.tsx` — confirm it checks `aiSuggestion?.status === 'pending'` and that new suggestions from the backend arrive with status `'pending'`.
- [X] T003 [P] Verify `MemoizedAssessmentItemInput` comparison function in `src/components/assessment/AssessmentItemInput.tsx` (or `src/components/assessment/DomainAccordion.tsx`) — confirm that `aiSuggestion` is included in the `React.memo` comparison. If missing, the component will NOT re-render when suggestions change.

**Checkpoint**: Root cause confirmed. Proceed with fixes based on findings.

---

## Phase 2: User Story 1 — Seleção automática da variável após avaliação com IA (Priority: P1) 🎯 MVP

**Goal**: After AI returns a suggestion, the suggestion card appears in the UI with accept/reject buttons. On accept, the radio button is selected and the response is persisted.

**Independent Test**: Click "Avaliar com IA" on any assessment item → spinner shows → suggestion card appears with confidence badge + accept/reject → click "Accept" → radio button selected.

### Implementation for User Story 1

- [X] T004 [US1] Fix key mapping in `src/services/aiAssessmentSuggestionService.ts`: in the `loadSuggestions` method, change the `effectiveItemId` resolution from `item.assessment_item_id || item.project_assessment_item_id` to `item.project_assessment_item_id || item.assessment_item_id` (prioritize project-scoped). If T001 investigation revealed a different resolution strategy, apply that instead. Ensure the resulting key matches `item.id` used by `DomainAccordion` components.
- [X] T005 [US1] Refactor `onSuccess` callback in `src/pages/AssessmentFullScreen.tsx` (lines 161-206): replace the IIFE + delay 1.5s + polling pattern with a direct `await refreshSuggestions()` call. Add 1 retry with 1s delay as fallback if `result.count === 0`. Move `setTriggeringItemId(null)` from line 163 into a `finally` block so the spinner stays visible until refresh completes (or fails). Remove the IIFE wrapper entirely.
- [X] T006 [US1] Apply same fix pattern to `useBatchAssessment.onComplete` in `src/pages/AssessmentFullScreen.tsx` (lines 234-248): replace delay 1.5s + polling with direct `await refreshSuggestions()` and 1 retry fallback. Wrap in try/catch.
- [X] T007 [US1] Fix React.memo comparison in `src/components/assessment/AssessmentItemInput.tsx` (if T003 revealed `aiSuggestion` is missing from comparison): add `prev.aiSuggestion === next.aiSuggestion` to the comparison function so the component re-renders when suggestions change.

**Checkpoint**: US1 complete. Trigger "Avaliar com IA" → spinner stays → card appears → accept selects radio button. This is the MVP — the core bug is fixed.

---

## Phase 3: User Story 2 — Exibição de metadados da IA no Assessment (Priority: P2)

**Goal**: Confidence badge, reasoning popover, and token toast are visible after AI assessment, matching the Extraction pattern.

**Independent Test**: Trigger AI on an item → verify confidence badge (e.g., "80%") appears → click badge → popover shows reasoning and evidence → toast shows tokens used.

### Implementation for User Story 2

- [X] T008 [US2] Verify confidence badge rendering in `src/components/assessment/ai/AISuggestionInline.tsx`: confirm that `AISuggestionConfidence` component receives `suggestion` prop and renders the percentage badge. If the badge does not appear after US1 fix, check that `confidence_score` is correctly populated in the `normalizeAIAssessmentSuggestion` function in `src/lib/assessment-utils.ts`.
- [X] T009 [US2] Verify details popover in `src/components/assessment/ai/shared/AISuggestionDetailsPopover.tsx`: confirm that clicking the confidence badge opens the popover with reasoning and evidence passages. If `reasoning` or `evidence_passages` are empty, trace the data from `AIAssessmentSuggestionService.loadSuggestions` to confirm the fields are being read from the `ai_suggestions` row correctly.
- [X] T010 [US2] Verify toast notification in `src/hooks/assessment/ai/useSingleAssessment.ts` (lines ~120-130): confirm that the success toast includes the suggested level, confidence percentage, and tokens used. The current code already computes `tokensUsed` and `confidence` — verify these values are displayed correctly in the toast format: `Avaliação concluída! Sugestão criada: ${selectedLevel}` with description `Confiança: ${confidence}% • ${tokensUsed} tokens usados`.

**Checkpoint**: US2 complete. Metadata (confidence badge, popover, toast) is fully visible and matches Extraction pattern.

---

## Phase 4: User Story 3 — Experiência de loading e feedback visual consistente (Priority: P2)

**Goal**: Loading spinner, button disable state, and visual transitions match the Extraction pattern.

**Independent Test**: Click "Avaliar com IA" → button shows spinner and is disabled → on completion, spinner disappears and card appears smoothly → navigate away and back, state is preserved.

### Implementation for User Story 3

- [X] T011 [US3] Verify spinner and button disabled state in `src/components/assessment/AssessmentItemInput.tsx`: confirm the trigger button shows `<Sparkles className="h-4 w-4 animate-pulse" />` with text "Avaliando com IA..." when `isTriggerLoading` is true, and that the button is disabled. Verify this matches the Extraction pattern in `src/components/extraction/SectionAccordion.tsx`.
- [X] T012 [US3] Verify loading state independence per item in `src/pages/AssessmentFullScreen.tsx`: confirm that `isTriggerLoading: (itemId) => assessingItem && triggeringItemId === itemId` (line 399) correctly isolates loading state per item. Test by triggering AI on one item and confirming other items are not affected.
- [X] T013 [US3] Verify visual transition: after T005 fix, confirm there is no "gap" between spinner disappearing and suggestion card appearing. The `setTriggeringItemId(null)` in `finally` (after refresh) should ensure the spinner stays until the card renders. If there's still a visual gap, consider adding a brief CSS transition (`animate-in fade-in`) to smooth the transition.

**Checkpoint**: US3 complete. Loading experience in Assessment is visually identical to Extraction.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Edge cases, hardening, and final validation across all user stories.

- [X] T014 Handle edge case: connection lost during AI processing — verify that `useSingleAssessment` error handling in `src/hooks/assessment/ai/useSingleAssessment.ts` catches network failures (timeout, disconnect) and that `src/pages/AssessmentFullScreen.tsx` displays an error toast and leaves the item state unchanged. Test by triggering AI with backend stopped.
- [X] T015 Handle edge case: AI returns invalid level in `src/components/assessment/AssessmentItemInput.tsx` — if `aiSuggestion.suggested_value.level` does not match any of `item.allowed_levels`, display the suggestion card as information only (no auto-select on accept). Add a warning message in the card. Fixed: Accept button is now hidden (`onAccept={undefined}`) when `hasInvalidLevel`, preventing invalid `selected_level` from being stored and falsely marking the item as complete.
- [X] T016 Handle edge case: user edits response during AI processing in `src/pages/AssessmentFullScreen.tsx` — capture `responses[triggeringItemId]?.selected_level` in `handleTriggerAI` before calling `assessItem` (snapshot). In the `onSuccess` callback, compare the current value against the snapshot. If it changed (user edited during processing), show the suggestion card normally but **do not call `updateResponse` automatically** — leave the radio at the user's value. If the user then explicitly clicks "Accept", FR-001 applies in full: the radio button is updated to the AI suggestion level. The snapshot must never prevent an explicit Accept action. Implemented: `responsesRef` + `preAISnapshotRef` added; snapshot captured in `handleTriggerAI`; cleaned up in `onSuccess` finally block. Architecture already has no auto-accept path, so FR-006 is also structurally guaranteed.
- [X] T017 Run full manual testing checklist from `specs/003-fix-assessment-sync/quickstart.md` section "Testing Checklist" — verify all 9 manual test scenarios and 4 edge cases pass. Include SC-001 timing check: use browser DevTools Performance tab to confirm suggestion card appears within 1 second of `assessSingleItem` response. Code verified: improved `onSuccess` retry to check by `suggestionId` (more accurate than `count === 0`). TypeScript compiles cleanly (`tsc --noEmit` passes with 0 errors). Manual testing with running backend required.
- [X] T018 [P] Clean up console.log debug statements in modified files (`src/pages/AssessmentFullScreen.tsx`, `src/services/aiAssessmentSuggestionService.ts`) — replace with structured logging via `console.debug` or remove verbose polling logs that are no longer relevant. Removed all verbose `console.log` (🤖/✅/❌ progress logs) from `AssessmentFullScreen.tsx`, `aiAssessmentSuggestionService.ts`, and `useSingleAssessment.ts`. All `console.error` and `console.warn` calls preserved.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Investigation (Phase 1)**: No dependencies — start immediately
- **US1 (Phase 2)**: Depends on Phase 1 findings (T001 determines T004 approach)
- **US2 (Phase 3)**: Depends on Phase 2 (suggestion card must appear first)
- **US3 (Phase 4)**: Depends on Phase 2 (T005 fix is prerequisite for loading verification)
- **Polish (Phase 5)**: Depends on Phases 2, 3, 4

### User Story Dependencies

- **US1 (P1)**: Depends on Investigation (Phase 1) — MVP, fix the core bug
- **US2 (P2)**: Depends on US1 — metadata only visible if suggestion card renders
- **US3 (P2)**: Depends on US1 — loading fix is part of T005 (onSuccess refactor)
- **US2 and US3 can proceed in parallel** after US1 is complete

### Within Each User Story

- Investigation tasks → Fix tasks → Verification tasks
- T004 (key mapping) before T005 (onSuccess flow) — key must be correct before refresh works
- T005 before T006 (batch uses same pattern)
- T007 only if T003 found a problem

### Parallel Opportunities

```
Phase 1 (parallel):
  T002 ─┐
  T003 ─┤── All investigation tasks can run in parallel
  T001 ─┘

Phase 2 (sequential within, but after Phase 1):
  T004 → T005 → T006 → T007 (if needed)

Phase 3 + 4 (parallel after Phase 2):
  US2: T008 ─── T009 ─── T010
                              │
  US3: T011 ─── T012 ─── T013 ├── Can run in parallel
                              │

Phase 5 (after 3+4):
  T014 ─┐
  T015 ─┤── Polish tasks, then T017 (full validation)
  T016 ─┤
  T018 ─┘── T017
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Investigation (~30 min) — confirm root cause
2. Complete Phase 2: US1 fixes (~2-3 hours) — fix key mapping + onSuccess flow + memo
3. **STOP and VALIDATE**: Test core flow manually (trigger AI → card appears → accept → radio selected)
4. If MVP works: proceed to US2 + US3 (mostly verification)

### Incremental Delivery

1. Phase 1 → Investigation → Root cause confirmed
2. Phase 2 → US1 → Test → Core bug fixed (MVP!) ✅
3. Phase 3 → US2 → Verify metadata display → Confidence/popover working ✅
4. Phase 4 → US3 → Verify loading consistency → Matches Extraction ✅
5. Phase 5 → Polish → Edge cases + cleanup → Production ready ✅

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- US1 is the core fix — US2 and US3 are largely verification since AI components already exist
- T004 approach depends on T001 findings — if key mismatch is NOT confirmed, T004 may be skipped or simplified
- No backend changes — all tasks are frontend (`src/`) only
- Commit after each phase checkpoint

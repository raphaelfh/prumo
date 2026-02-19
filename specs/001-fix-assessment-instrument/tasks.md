# Tasks: Fix Assessment Instrument Configuration and Data Loading

**Input**: Design documents from `/specs/001-fix-assessment-instrument/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: No tests requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Branch and project structure — already complete

- [x] T001 Create feature branch `001-fix-assessment-instrument` from `dev`
- [x] T002 Initialize spec directory at `specs/001-fix-assessment-instrument/`

**Checkpoint**: Branch and spec structure ready.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Backend API and frontend services that both user stories depend on — already verified as existing and working

**No foundational tasks required**: All backend endpoints (`GET /{id}`, `POST /{id}/items`, `PATCH /items/{id}`, `DELETE /items/{id}`) already exist in `backend/app/api/v1/endpoints/project_assessment_instruments.py`. Frontend API services (`getInstrument`, `addItem`, `updateItem`, `deleteItem`) already exist in `src/services/projectAssessmentInstrumentService.ts`. TanStack Query hooks already exist in `src/hooks/assessment/useProjectAssessmentInstruments.ts`.

**Checkpoint**: Foundation ready — all backend and service-layer code exists. User story implementation is frontend-component-only.

---

## Phase 3: User Story 2 - Load Assessment Data for Article Quality Review (Priority: P1)

**Goal**: Fix the 406 "Cannot coerce to single JSON object" error so that selecting an article for quality assessment loads the instrument and questions correctly.

**Independent Test**: Navigate to Avaliacao tab, select an article — instrument loads, questions display, no 406 error in browser console.

### Implementation for User Story 2

- [x] T003 [US2] Replace wrong-table Supabase queries with `getInstrument()` API call in `src/hooks/assessment/useAssessmentData.ts`
  - Remove direct Supabase query to `assessment_instruments` (global table)
  - Remove direct Supabase query to `assessment_items` (global table)
  - Import and call `getInstrument(instrumentId)` from `src/services/projectAssessmentInstrumentService.ts`
  - Map `ProjectAssessmentItem` (camelCase) to `AssessmentItem` (snake_case) for downstream compatibility

**Checkpoint**: Article quality assessment page loads without 406 errors. US2 is fully functional.

---

## Phase 4: User Story 1 - Edit Imported Assessment Instrument Items (Priority: P1) MVP

**Goal**: Enable full CRUD (edit, toggle, delete, add) on assessment instrument items after import, matching the Extraction section's TemplateConfigEditor pattern.

**Independent Test**: Import an instrument, click "Configurar", verify items grouped by domain, toggle/edit/delete items, add new custom item via dialog, reload page — all changes persist.

### Implementation for User Story 1

- [x] T004 [US1] Create `InstrumentConfigEditor.tsx` with edit, toggle required, and delete functionality in `src/components/assessment/config/InstrumentConfigEditor.tsx`
  - Mirror `src/components/extraction/TemplateConfigEditor.tsx` (Accordion by domain, inline edit per item)
  - Use `useProjectInstrument()` from `src/hooks/assessment/useProjectAssessmentInstruments.ts`
  - Use `updateItem()` and `deleteItem()` from `src/services/projectAssessmentInstrumentService.ts`
  - Invalidate `projectInstrumentKeys.byId()` and `.byProject()` after mutations

- [x] T005 [US1] Wire "Configurar" button onClick and render `InstrumentConfigEditor` in `src/components/assessment/config/InstrumentManager.tsx`
  - Add `editingInstrumentId` state
  - Wire `onClick={() => setEditingInstrumentId(instrument.id)}` on Configurar button
  - Conditionally render `InstrumentConfigEditor` with "Voltar" back button when editing

- [x] T006 [US1] Add `InstrumentConfigEditor` to barrel exports in `src/components/assessment/config/index.ts`

- [x] T007 [US1] Remove misleading `GripVertical` icon from `src/components/assessment/config/InstrumentConfigEditor.tsx`
  - Remove `GripVertical` import from lucide-react
  - Remove the `<GripVertical>` element from item rows
  - Verify `npx tsc --noEmit` still passes

- [x] T008 [P] [US1] Create `AddItemDialog.tsx` in `src/components/assessment/config/AddItemDialog.tsx`
  - Follow gold-standard pattern from `src/components/extraction/dialogs/AddSectionDialog.tsx`
  - Use `react-hook-form` + `zodResolver` for form state and validation
  - Use shadcn `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage` components
  - Props interface: `{ instrumentId, existingDomains, open, onOpenChange, onItemAdded }`
  - Form fields: domain (Select + "Novo dominio" free text), itemCode (Input), question (Textarea), description (Textarea), allowedLevels (reuse `AllowedValuesList` from `src/components/extraction/dialogs/AllowedValuesList.tsx`), required (Switch)
  - Auto-compute `sortOrder` as `max(sortOrder in domain) + 1`
  - Pre-populate `allowedLevels` with the most common levels from existing items
  - Call `addItem(instrumentId, request)` from `src/services/projectAssessmentInstrumentService.ts`
  - Show loading state during submit, call `form.reset()` on close, use `toast.success()`/`toast.error()`

- [x] T009 [US1] Integrate `AddItemDialog` into `InstrumentConfigEditor` in `src/components/assessment/config/InstrumentConfigEditor.tsx`
  - Add `showAddItemDialog` state
  - Compute `existingDomains` from `itemsByDomain` keys
  - Compute `defaultAllowedLevels` from instrument items
  - Add centered Card with "Adicionar Item" button below the Accordion (and in empty-state Card)
  - Render `AddItemDialog` at bottom of component with query invalidation on success
  - Add `Plus` to lucide-react imports

- [x] T010 [US1] Add `AddItemDialog` to barrel exports in `src/components/assessment/config/index.ts`

**Checkpoint**: Full CRUD on instrument items works. US1 is fully functional and independently testable.

---

## Phase 5: User Story 3 - Consistent UX Between Extraction and Assessment (Priority: P2)

**Goal**: Ensure the assessment section's import-configure-use workflow matches the Extraction section's patterns.

**Independent Test**: A user familiar with Extraction can perform the assessment workflow without encountering unexpected UX differences.

### Implementation for User Story 3

No dedicated tasks — US3 is satisfied by the implementation patterns used in US1 and US2:

- T004 mirrors `TemplateConfigEditor.tsx` (Accordion grouping, inline editing)
- T008 mirrors `AddSectionDialog.tsx` (react-hook-form + zod, Dialog pattern)
- T003 uses `apiClient` instead of direct Supabase queries (matching Extraction's data loading pattern)
- T008 reuses `AllowedValuesList.tsx` from Extraction dialogs

**Checkpoint**: Assessment section follows Extraction section patterns. US3 acceptance scenarios met.

---

## Phase 6: Bug 3 - Fix FK Constraint Violation on Assessment Response Save (Priority: P0 — Blocker)

**Goal**: Fix the FK constraint violation that occurs when saving assessment responses through the `assessments` compatibility VIEW. The INSTEAD OF triggers must detect whether the `instrument_id` from the frontend is a global or project-scoped instrument and route to the correct FK column.

**Independent Test**: Navigate to Avaliacao tab, select an article, answer a question — auto-save succeeds without FK error. Navigate away and back — responses load correctly.

**Context**: Bug discovered during T012 verification. The root cause is documented in `specs/001-fix-assessment-instrument/research.md` and the fix plan in `specs/001-fix-assessment-instrument/plan.md`.

### Implementation for Bug 3

- [x] T013 Write migration `supabase/migrations/20260218000000_fix_assessments_view_project_instruments.sql` — Part 0+1: Alter `assessment_responses` table (XOR pattern for project items) + Update the `assessments` VIEW definition
  - Change `JOIN assessment_instruments i ON i.id = ai.instrument_id` to `LEFT JOIN` both instrument tables
  - Add `LEFT JOIN project_assessment_instruments pi ON pi.id = ai.project_instrument_id`
  - Use `COALESCE(ai.instrument_id, ai.project_instrument_id) AS instrument_id` so frontend sees a single `instrument_id`
  - Use `COALESCE(gi.tool_type, pi.tool_type) AS tool_type` to get tool_type from whichever instrument is referenced
  - Update response aggregation subquery to also search `project_assessment_items` (not just `assessment_items`)
  - Keep all other VIEW columns unchanged

- [x] T014 Write migration `supabase/migrations/20260218000000_fix_assessments_view_project_instruments.sql` — Part 2: Update INSERT trigger (`assessments_insert_trigger()`)
  - Add instrument type detection: `IF EXISTS (SELECT 1 FROM project_assessment_instruments WHERE id = NEW.instrument_id) THEN`
  - For project instruments: INSERT with `instrument_id = NULL, project_instrument_id = NEW.instrument_id`
  - For global instruments: INSERT with `instrument_id = NEW.instrument_id, project_instrument_id = NULL` (legacy path)
  - Update item lookup in response loop: search `project_assessment_items` (by `project_instrument_id`) for project instruments, `assessment_items` (by `instrument_id`) for global instruments
  - Preserve all existing columns and metadata handling

- [x] T015 Write migration `supabase/migrations/20260218000000_fix_assessments_view_project_instruments.sql` — Part 3: Update UPDATE trigger (`assessments_update_trigger()`)
  - Add same instrument type detection logic as INSERT trigger
  - Update response recreation loop to search correct items table based on instrument type
  - Detect instrument type from the existing `assessment_instances` row (check `project_instrument_id IS NOT NULL`)
  - Preserve all existing update behavior for instance metadata and status

- [x] T016 Write migration `supabase/migrations/20260218000000_fix_assessments_view_project_instruments.sql` — Part 4: Re-grant permissions and add verification block
  - `GRANT SELECT, INSERT, UPDATE, DELETE ON assessments TO authenticated;`
  - `GRANT SELECT, INSERT, UPDATE, DELETE ON assessments TO service_role;`
  - Add verification `DO $$` block matching the pattern in the existing restore migration
  - Add `COMMENT ON VIEW assessments` noting project instrument support

**Note**: T013-T016 are parts of a single migration file. They are listed separately for clarity but MUST be implemented as one atomic SQL file.

**Checkpoint**: Assessment response save works for both project and global instruments. FK constraint violation resolved.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verification and cleanup

- [x] T011 Run `npx tsc --noEmit` to verify no TypeScript errors across all changes
- [x] T017 Run `supabase db reset` locally to apply migration and verify it applies cleanly (renamed to 20260218000000 to sort after restore migration)
- [x] T018 Fix AI Assessment 404 — router prefix mismatch in `backend/app/api/v1/router.py` (`/assessment` → `/ai-assessment`)
- [x] T019 Fix response persistence — VIEW triggers match items by UUID (id::text) with fallback to item_code; VIEW SELECT returns UUID keys instead of item_code keys
- [x] T020 Re-apply migration via `supabase db reset` + `supabase stop && supabase start` to restore all services
- [ ] T012 Run verification scenarios:
  - **V1 (FK Fix)**: Navigate to Avaliacao tab, select an article, answer a question — response saves without FK error
  - **V2 (Read)**: Navigate away and back to the same article — previous responses load correctly
  - **V3 (Update)**: Change a response — auto-save succeeds, reload confirms change persisted
  - **V4 (Global instruments)**: If a global instrument is used, the same flow still works (backward compatibility)
  - **V5 (VIEW query)**: `supabase.from('assessments').select('*').eq('instrument_id', projectInstrumentId)` returns the correct assessment
  - **V6 (Configurar)**: Import instrument, click Configurar, edit/toggle/delete/add items — all persist on reload
  - **V7 (Data load)**: Select article for assessment — instrument loads without 406 error

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Complete
- **Foundational (Phase 2)**: Complete (all backend/service code pre-exists)
- **US2 (Phase 3)**: Complete (Bug 2 fix applied)
- **US1 (Phase 4)**: Complete (T004-T010 all done)
- **US3 (Phase 5)**: Satisfied by US1 + US2 implementation patterns
- **Bug 3 (Phase 6)**: Depends on US2 completion (Bug 2 fix exposed Bug 3); T013-T016 are sequential parts of one file
- **Polish (Phase 7)**: T017 depends on T013-T016; T012 depends on T017

### Bug 3 Task Dependencies

- **T013** (VIEW definition): Must be written first — establishes the new LEFT JOIN structure
- **T014** (INSERT trigger): Depends on T013 — uses same detection pattern, must be in same file after VIEW
- **T015** (UPDATE trigger): Depends on T014 — same detection pattern applied to UPDATE path
- **T016** (Permissions): Depends on T013-T015 — final section of migration file
- **T017** (db reset): Depends on T013-T016 — validates the migration applies cleanly
- **T012** (verification): Depends on T017 — end-to-end manual testing

**Note**: T013-T016 are parts of a single SQL file and will be implemented together as one atomic task in practice.

### Parallel Opportunities

```
# Bug 3 tasks are strictly sequential (single file, each part depends on previous):
T013 → T014 → T015 → T016 (single migration file)

# After migration file is written:
T017: Apply migration via supabase db reset

# After migration applied:
T012: Manual verification (all V1-V7 scenarios)
```

---

## Implementation Strategy

### Current State

T001-T011 are complete. US1 and US2 are fully functional. Bug 3 was discovered during T012 verification — saving assessment responses fails with FK constraint violation because the compatibility VIEW triggers don't handle project instrument IDs.

### Remaining Work (5 tasks)

1. **T013-T016 (single file)**: Write migration `0036_fix_assessments_view_project_instruments.sql` with 4 parts:
   - VIEW definition with LEFT JOINs for both instrument tables
   - INSERT trigger with instrument type detection
   - UPDATE trigger with instrument type detection
   - Permissions and verification
2. **T017**: Apply migration via `supabase db reset`
3. **T012**: End-to-end verification (V1-V7)

### MVP Scope

Bug 3 fix (T013-T016) is the final blocker. Once the migration is applied and verified, the entire feature (US1 + US2 + US3) will be fully functional end-to-end.

---

## Summary

| Metric | Value |
|--------|-------|
| Total tasks | 17 |
| Completed | 11 (T001-T011) |
| Remaining | 6 (T012-T017) |
| Tasks per US1 | 7 (T004-T010) |
| Tasks per US2 | 1 (T003) |
| Tasks per US3 | 0 (cross-cutting, satisfied by US1+US2) |
| Tasks per Bug 3 | 4 (T013-T016, single migration file) |
| Infrastructure | 2 (T017 db reset, T012 verification) |
| Parallel opportunities | None in remaining tasks (all sequential) |

---

## Notes

- No test tasks generated (not requested in feature specification)
- T013-T016 are conceptual sub-parts of a single migration file — they MUST be written together as one atomic `.sql` file
- Bug 3 is database-only — no frontend or backend Python changes required
- The `useAssessmentResponses.ts` direct Supabase usage is pre-existing tech debt (noted in constitution check) — not addressed in this fix
- [P] tasks = different files, no dependencies
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently

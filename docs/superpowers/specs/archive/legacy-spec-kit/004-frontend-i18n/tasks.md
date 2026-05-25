# Tasks: Aplicação em Inglês e Código Limpo (Frontend i18n)

**Input**: Design documents from `specs/004-frontend-i18n/`  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not requested in spec — no test tasks included.

**Organization**: Tasks grouped by user story for independent implementation and validation.

**Outcome**: Full translation of all UI from Portuguese to English; refactor so that **only English is retained** — no
Portuguese in the UI or in `frontend/lib/copy/`; all former PT literals are removed and replaced by English copy keys.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story (US1, US2, US3)
- File paths are in `frontend/` per plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create copy module structure and typed API

- [x] T001 Create directory `frontend/lib/copy/` and placeholder namespace files (common.ts, pages.ts, extraction.ts,
  assessment.ts, articles.ts, project.ts, user.ts, navigation.ts, layout.ts, patterns.ts, ui.ts, shared.ts; optionally
  contexts.ts if context strings will not live in common) with empty exported objects per data-model.md
- [x] T002 Implement typed `t()` or `getCopy()` helper and export in `frontend/lib/copy/index.ts` per
  contracts/copy-api.md
- [x] T003 [P] Populate `frontend/lib/copy/common.ts` with shared English strings (e.g. save, cancel, loading, error,
  success) used across areas

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Copy API ready and locale consistent; no user story migration can start without this

**⚠️ CRITICAL**: No area migration (US1) can begin until this phase is complete

- [x] T004 Replace all date-fns and Intl `pt-BR` / `ptBR` usage with `en-US` or `enUS` in `frontend/` (see research.md;
  files include HeaderStatusBadges.tsx, AISuggestionHistoryPopover.tsx, formatters.ts, Dashboard.tsx,
  ApiKeysSection.tsx, etc.)
- [x] T005 Add error-message copy and map known API/backend error codes to English strings in
  `frontend/lib/copy/common.ts` (e.g. under keys like common.errors.unauthorized) per data-model.md and FR-006; use
  dedicated errors.ts only if the set grows large
- [x] T006 Export all namespaces from `frontend/lib/copy/index.ts` and ensure TypeScript types for keys (per contract)

**Checkpoint**: Copy module is usable; date/number locale is English; error mapping in place. Area migrations can start.

---

## Phase 3: User Story 1 — Aplicação exibida inteiramente em inglês (P1) 🎯 MVP

**Goal**: User sees all UI text (titles, buttons, labels, placeholders, messages, aria-labels) in English on every page
and flow.

**Independent Test**: Navigate all pages and main flows; confirm no Portuguese visible; 404 and empty/error states in
English.

### Implementation for User Story 1

- [x] T007 [P] [US1] Add `frontend/lib/copy/pages.ts` strings and replace all UI literals in `frontend/pages/*.tsx` (
  Dashboard, ProjectView, Auth, UserSettings, AddArticle, EditArticle, ExtractionFullScreen, AssessmentFullScreen,
  NotFound, Index, ResetPassword)
- [x] T008 [P] [US1] Add `frontend/lib/copy/extraction.ts` strings and replace all UI literals in
  `frontend/components/extraction/**` (lists, headers, forms, dialogs, AI)
- [x] T009 [P] [US1] Add `frontend/lib/copy/assessment.ts` strings and replace all UI literals in
  `frontend/components/assessment/**` (tables, headers, config, AI, instruments)
- [x] T010 [P] [US1] Add `frontend/lib/copy/articles.ts` strings and replace all UI literals in
  `frontend/components/articles/**` (forms, lists, RIS/Zotero import)
- [x] T011 [P] [US1] Add `frontend/lib/copy/project.ts` strings and replace all UI literals in
  `frontend/components/project/**` (settings, PICOTS, members, review, Zotero)
- [x] T012 [P] [US1] Add `frontend/lib/copy/user.ts` strings and replace all UI literals in
  `frontend/components/user/**` (profile, security, integrations, API keys)
- [x] T013 [P] [US1] Add `frontend/lib/copy/navigation.ts` strings and replace all UI literals in
  `frontend/components/navigation/**` (Topbar, search, notifications, profile menu)
- [x] T014 [P] [US1] Add `frontend/lib/copy/layout.ts` strings and replace all UI literals in
  `frontend/components/layout/**` (sidebar, mobile sidebar, app layout)
- [x] T015 [P] [US1] Add `frontend/lib/copy/patterns.ts` strings and replace all UI literals in
  `frontend/components/patterns/**` (PageHeader, ErrorState, EmptyState, DetailSheet, etc.)
- [x] T016 [P] [US1] Add `frontend/lib/copy/ui.ts` strings for components with fixed text only and replace in
  `frontend/components/ui/**` (placeholders, aria-labels where present)
- [x] T017 [P] [US1] Add `frontend/lib/copy/shared.ts` strings and replace all UI literals in
  `frontend/components/shared/**` (comparison, AI suggestions)
- [x] T018 [US1] Add `frontend/lib/copy/contexts.ts` (or use common) and replace all UI literals in
  `frontend/contexts/*.tsx` (error/message text exposed to UI)

**Checkpoint**: All areas use copy module; app displays only in English. US1 independently verifiable.

---

## Phase 4: User Story 2 — Código sem strings de UI hardcoded (P1)

**Goal**: No Portuguese or other UI string literals in components/pages/contexts; all text from copy module.

**Independent Test**: Grep for common PT UI words in `frontend/components/`, `frontend/pages/`, `frontend/contexts/`; no
matches except comments or copy definitions.

### Implementation for User Story 2

- [x] T019 [US2] Audit `frontend/` for remaining Portuguese UI strings (grep/lint); replace every occurrence with copy
  key in `frontend/lib/copy/` and component/page/context files
- [x] T020 [US2] Ensure toasts, success/error messages, and API error display use copy in `frontend/` (e.g. sonner,
  error boundaries, API error handlers)

**Checkpoint**: Zero hardcoded UI strings in Portuguese; US2 independently verifiable.

---

## Phase 5: User Story 3 — Estrutura mantível e sem duplicação (P2)

**Goal**: Single place for each UI string; no duplicate definitions of the same visible text.

**Independent Test**: Review copy modules; no two keys with identical English value unless intentional; new strings
added via quickstart flow.

### Implementation for User Story 3

- [ ] T021 [US3] Deduplicate copy: find identical string values across `frontend/lib/copy/*.ts`, consolidate to one key
  and reuse in components
- [ ] T022 [US3] Document how to add and verify copy in `specs/004-frontend-i18n/quickstart.md` (or link from README)
  and ensure checklist for “no PT in UI” is actionable

**Checkpoint**: Copy is single source of truth; no unnecessary duplication; US3 independently verifiable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and optional automation (including SC-004 runbook)

- [ ] T023 Run full app smoke test: all routes and main flows display in English; fix any remaining Portuguese or
  missing copy in `frontend/`
- [ ] T024 [P] Optionally add lint rule or script in `frontend/` to flag Portuguese string literals in TSX/TS (allowlist
  copy and tests) per quickstart.md
- [ ] T025 [P] Optionally add verification runbook (2h, 20% sample of screens) to
  `specs/004-frontend-i18n/quickstart.md` for SC-004 validation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Phase 2 — can start when T004–T006 are done.
- **User Story 2 (Phase 4)**: Depends on Phase 3 (US1) — audit and fix remaining PT.
- **User Story 3 (Phase 5)**: Depends on Phase 4 — deduplicate and document.
- **Polish (Phase 6)**: Depends on Phase 5.

### User Story Dependencies

- **US1 (P1)**: After Foundational only — no dependency on US2/US3.
- **US2 (P1)**: After US1 (needs copy and replacements done to audit).
- **US3 (P2)**: After US2 (deduplicate once all strings are in copy).

### Within Each User Story

- US1: Area tasks T007–T018 can run in parallel (different namespaces and directories).
- US2: T019 then T020 (audit then toasts/errors).
- US3: T021 and T022 can be parallel (dedupe vs document).

### Parallel Opportunities

- T003 is [P] after T001–T002.
- T007–T017 and T018 (by area) are [P] within Phase 3 once Foundational is done.
- T024 is [P] in Polish.
- T025 (optional runbook) supports SC-004.

---

## Parallel Example: User Story 1

```bash
# After Phase 2, run these in parallel (different areas):
T007: pages copy + frontend/pages/*.tsx
T008: extraction copy + frontend/components/extraction/**
T009: assessment copy + frontend/components/assessment/**
T010: articles copy + frontend/components/articles/**
T011: project copy + frontend/components/project/**
T012: user copy + frontend/components/user/**
T013: navigation copy + frontend/components/navigation/**
T014: layout copy + frontend/components/layout/**
T015: patterns copy + frontend/components/patterns/**
T016: ui copy + frontend/components/ui/**
T017: shared copy + frontend/components/shared/**
# T018 (contexts) can run after or in parallel with any of the above
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003).
2. Complete Phase 2: Foundational (T004–T006).
3. Complete Phase 3: User Story 1 (T007–T018); can parallelize by area.
4. **STOP and VALIDATE**: Navigate app; all English; no PT on screen.
5. Demo/deploy MVP.

### Incremental Delivery

1. Setup + Foundational → copy API and locale ready.
2. US1 (all areas) → app in English (MVP).
3. US2 → code clean (no PT in source).
4. US3 → no duplication, docs updated.
5. Polish → smoke test and optional lint.

### Parallel Team Strategy

- One developer: Phase 1 → 2 → 3 (areas in any order) → 4 → 5 → 6.
- Multiple developers: After Phase 2, assign areas (T007–T017) in parallel; one person can do T018 and another start
  T019 after US1 areas are done.

---

## Notes

- [P] = different files, no shared state.
- [USn] maps task to user story for traceability.
- Each user story is independently testable per spec.
- No test tasks (spec did not request tests).
- Commit after each task or logical group; validate at checkpoints.

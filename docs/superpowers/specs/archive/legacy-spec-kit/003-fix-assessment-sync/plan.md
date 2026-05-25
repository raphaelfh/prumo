# Implementation Plan: Sincronização da Interface na "Avaliação com IA" (Assessment)

**Branch**: `003-fix-assessment-sync` | **Date**: 2026-02-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-fix-assessment-sync/spec.md`

## Summary

Corrigir o bug de sincronização de estado no frontend do Assessment onde a sugestão da IA não aparece na interface após o backend retornar sucesso. A abordagem é alinhar o fluxo do Assessment ao padrão já validado da Extração: após a IA retornar, exibir o card de sugestão com confiança + aceitar/rejeitar; ao aceitar, selecionar o radio button e persistir a resposta. Os componentes de UI para metadados da IA já existem no Assessment (adaptados da Extração) — o problema está na camada de estado/hooks, especificamente no ciclo refresh → render do card de sugestão.

## Technical Context

**Language/Version**: TypeScript 5.8 (frontend React 18)
**Primary Dependencies**: React 18, TanStack Query v5, shadcn/ui (Radix), Zustand, react-hook-form, Zod
**Storage**: Supabase (PostgreSQL) via FastAPI backend API (leitura/escrita de `ai_suggestions`, `assessment_responses`)
**Testing**: Vitest + @testing-library/react + MSW
**Target Platform**: Web (SPA, Vite dev server, port 8080)
**Project Type**: Web application (frontend + backend)
**Performance Goals**: Card de sugestão aparece em < 1s após resposta do backend (SC-001)
**Constraints**: Frontend-only fix — backend não será alterado. Reutilizar componentes AI existentes do Assessment.
**Scale/Scope**: ~6-8 arquivos frontend a modificar/ajustar; 0 arquivos backend.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Layered Architecture | ✅ N/A | Frontend-only fix, backend layers unchanged |
| II. Dependency Injection | ✅ Pass | Hooks recebem dependências via props/callbacks |
| III. Supabase Migrations | ✅ N/A | Sem alteração de schema |
| IV. Security by Design | ✅ Pass | JWT auth preservado, `user_id` via `user.sub` |
| V. Typed Everything | ✅ Pass | TypeScript strict mode, tipos existentes |
| VI. Frontend Conventions | ✅ Pass | apiClient, TanStack Query patterns, shadcn/ui |
| VII. Async All The Way | ✅ Pass | Todas as operações já são async |
| VIII. Standardized API Contract | ✅ N/A | Backend endpoints não mudam |

**Gate Result**: ✅ PASS — Nenhuma violação. Prosseguir para Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/003-fix-assessment-sync/
├── plan.md              # This file
├── research.md          # Phase 0: Root cause analysis
├── data-model.md        # Phase 1: State/entity model
├── quickstart.md        # Phase 1: Implementation guide
├── contracts/           # Phase 1: API contracts (existing, documented)
└── tasks.md             # Phase 2: Task breakdown (NOT created by /speckit.plan)
```

### Source Code (files to modify)

```text
src/
├── pages/
│   └── AssessmentFullScreen.tsx          # Orchestrator: fix onSuccess → refresh → render flow
├── hooks/
│   └── assessment/
│       ├── ai/
│       │   ├── useAIAssessmentSuggestions.ts  # Fix: refresh returns correct data, key mapping
│       │   └── useSingleAssessment.ts         # Verify: onSuccess callback chain
│       └── useAssessmentResponses.ts          # Verify: updateResponse on accept
├── components/
│   └── assessment/
│       ├── AssessmentItemInput.tsx             # Verify: suggestion card rendering conditions
│       ├── DomainAccordion.tsx                 # Verify: props forwarding
│       └── ai/
│           ├── AISuggestionInline.tsx          # Already exists ✅
│           ├── AISuggestionEvidence.tsx        # Already exists ✅
│           ├── AISuggestionBadge.tsx           # Already exists ✅
│           └── shared/
│               ├── AISuggestionConfidence.tsx  # Already exists ✅
│               └── AISuggestionDetailsPopover.tsx # Already exists ✅
└── services/
    └── assessmentService.ts                   # Verify: API response parsing
```

**Structure Decision**: Web application structure. All changes are in `frontend/`. The Assessment already has a parallel
component structure to Extraction — the fix targets the hooks/state layer, not the UI component layer.

## Complexity Tracking

> No violations found. No complexity justifications needed.

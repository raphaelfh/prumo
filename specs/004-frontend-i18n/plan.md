# Implementation Plan: Aplicação em Inglês e Código Limpo (Frontend i18n)

**Branch**: `004-frontend-i18n` | **Date**: 2026-03-04 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/004-frontend-i18n/spec.md`

## Summary

Entregar a aplicação frontend exibida **somente em inglês** e com **código limpo**: **tradução inteira** do que hoje
está em português para inglês, com **refatoração** para que ao final só reste inglês — repositório de copy apenas em
inglês, componentes sem literais em PT (removidos e substituídos por copy). Todas as strings de UI externalizadas em
`frontend/lib/copy/` (inglês), sem duplicação. Abordagem técnica: ver research.md (mecanismo de copy/translations).

## Technical Context

**Language/Version**: TypeScript (strict), React 18.3  
**Primary Dependencies**: Vite, TanStack Query, Zustand, shadcn/Radix, react-hook-form, Zod; **i18n/copy**: módulo
customizado em `frontend/lib/copy/` (namespaces por área, sem lib externa); ver research.md  
**Storage**: N/A (strings estáticas em arquivos TS/JSON no frontend)  
**Testing**: Vitest, @testing-library/react; lint/grep para ausência de PT em UI  
**Target Platform**: Web (browser)  
**Project Type**: Web application (frontend-only for this feature)  
**Performance Goals**: N/A (sem impacto relevante; bundle pode crescer levemente com módulo de copy)  
**Constraints**: Nenhuma string de UI em português no código; um único repositório de textos; datas/números formatados
em locale consistente (en-US) onde aplicável  
**Scale/Scope**: Todas as páginas e áreas (extraction, assessment, articles, project, user, navigation, layout,
patterns, ui, shared, contexts); ~235 TSX + 160 TS (subset com UI)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle                       | Applicability                                                     | Status                                                                                         |
|---------------------------------|-------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| I. Layered Architecture         | Backend only; this feature is frontend-only                       | N/A                                                                                            |
| II. Dependency Injection        | No new backend services                                           | N/A                                                                                            |
| III. Split Migration Ownership  | No migrations                                                     | N/A                                                                                            |
| IV. Security by Design          | No auth/API changes                                               | N/A                                                                                            |
| **V. Typed Everything**         | Frontend: TypeScript strict, Zod for forms                        | **PASS** — translation keys/copy will be typed                                                 |
| **VI. Frontend Conventions**    | apiClient, TanStack Query, Zustand, shadcn, react-hook-form + Zod | **PASS** — new copy/translations module consumed by components; no new API client or state lib |
| VII. Async All The Way          | Backend only                                                      | N/A                                                                                            |
| VIII. Standardized API Contract | Backend only                                                      | N/A                                                                                            |

**Result**: No violations. Gate **PASS**.

## Project Structure

### Documentation (this feature)

```text
specs/004-frontend-i18n/
├── plan.md              # This file
├── research.md          # Phase 0: i18n approach decision
├── data-model.md        # Phase 1: copy/translations structure
├── quickstart.md        # Phase 1: how to add strings and verify
├── contracts/           # Phase 1: translation/copy API contract
└── tasks.md             # Phase 2 (speckit.tasks)
```

### Source Code (repository root)

```text
frontend/
├── components/          # extraction, assessment, articles, project, user, navigation, layout, patterns, ui, shared
├── pages/
├── contexts/
├── hooks/
├── lib/                 # + new: copy/ or i18n/ (translations module)
├── services/
└── ... (existing)

# Backend unchanged for this feature
backend/
└── ...
```

**Structure Decision**: Single Vite app at repo root; frontend code under `frontend/`. New translation/copy module under
`frontend/lib/` (e.g. `frontend/lib/copy/` or `frontend/lib/translations/`) to hold namespaced English strings and typed
accessor; no new top-level packages.

## Complexity Tracking

No constitution violations. Table left empty.

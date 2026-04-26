# Implementation Plan: Unified Evaluation Data Model

**Branch**: `008-unified-evaluation-model` | **Date**: 2026-04-26 | **Spec**: `/specs/008-unified-evaluation-model/spec.md`
**Input**: Feature specification from `/specs/008-unified-evaluation-model/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Deliver a unified evaluation lifecycle that joins extraction proposals, independent multi-reviewer decisions, and auditable final consensus publication under one run context, with immutable history and schema-version safety. Implementation uses append-only domain tables, optimistic concurrency for consensus publication, strict authorization boundaries, and operational observability (structured logs + core metrics). Delivery target is a clean and fully tested development baseline, with reset/deletion of dev data allowed and no legacy data migration requirement.

## Technical Context

**Language/Version**: Python 3.11+ (backend), TypeScript strict (frontend)  
**Primary Dependencies**: FastAPI, SQLAlchemy 2.0 async, Alembic, Celery + Redis, Pydantic, structlog, React 18, TanStack Query, Zustand  
**Storage**: PostgreSQL (`public` schema, Alembic-managed), Supabase Storage for evidence binaries  
**Testing**: pytest (unit/integration), Vitest + Testing Library, Playwright for end-to-end flows  
**Target Platform**: Linux containerized backend + modern desktop browsers  
**Project Type**: Full-stack web application (FastAPI backend + React frontend)  
**Performance Goals**: Non-blocking run progression with asynchronous proposal generation; observability must expose run duration, stage failures, publish conflicts, and queue backlog for every run; trigger a scale alert when backlog remains above 500 items for 15 consecutive minutes  
**Constraints**: Immutable append-only proposal/decision/consensus history; optimistic locking for consensus publish; 25 MB evidence cap with PDF/PNG/JPG/JPEG/TXT only; item type locked after first extraction in schema version; dev-mode clean-slate rollout (no legacy data migration); scaling trigger threshold fixed at backlog >500 for 15 minutes  
**Scale/Scope**: Multi-project evaluation workflows with append-only growth, reviewer concurrency on the same item, and schema version evolution without mutating historical outcomes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status (Pre-Research) | Notes |
|------|------------------------|-------|
| Layered Architecture | PASS | Plan separates models, repositories, services, and endpoints for new evaluation modules. |
| Dependency Injection First | PASS | Services will receive db/user/request context through FastAPI dependencies and constructors. |
| Split Migration Ownership | PASS | New application schema changes stay in Alembic `backend/alembic/versions`; no Supabase auth/storage crossover. |
| Security by Design | PASS | Authz scoped by project, no user_id from payload, rate-limited endpoints, auditable actor identity. |
| Typed Everything | PASS | Pydantic contracts + strict TS types for API/client integration. |
| Frontend Conventions | PASS | FastAPI integration via canonical `apiClient` + TanStack Query. |
| Async All The Way | PASS | Proposal generation and long-running processing routed through async/Celery flows. |
| Standardized API Contract | PASS | API contracts keep uniform `ApiResponse` envelope and trace IDs. |

## Project Structure

### Documentation (this feature)

```text
specs/008-unified-evaluation-model/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── api/v1/endpoints/
│   ├── models/
│   ├── repositories/
│   ├── schemas/
│   ├── services/
│   └── worker/tasks/
├── alembic/versions/
└── tests/
    ├── integration/
    └── unit/

frontend/
├── components/
├── hooks/
├── integrations/api/
├── pages/
├── services/
└── tests/
```

**Structure Decision**: Use the existing web application structure (`backend/` + `frontend/`) and add evaluation-domain modules in the layered backend architecture plus feature UI under domain-aligned frontend components/services.

## Phase 0: Research

Research output is documented in `/specs/008-unified-evaluation-model/research.md` and resolves technical choices around concurrency control, schema evolution strategy, evidence handling, observability baseline, and migration boundaries.

## Phase 1: Design & Contracts

- Data model documented in `/specs/008-unified-evaluation-model/data-model.md`
- API contracts documented in `/specs/008-unified-evaluation-model/contracts/unified-evaluation.openapi.yaml`
- Implementation onboarding documented in `/specs/008-unified-evaluation-model/quickstart.md`
- Agent context updated via `.specify/scripts/bash/update-agent-context.sh claude`

## Post-Design Constitution Check

| Gate | Status (Post-Design) | Notes |
|------|-----------------------|-------|
| Layered Architecture | PASS | Data model and contracts map cleanly to endpoint/service/repository/model responsibilities. |
| Dependency Injection First | PASS | Contract and quickstart explicitly rely on dependency-injected db/auth context and trace propagation. |
| Split Migration Ownership | PASS | Design constrains application tables/enums/indexes to Alembic only. |
| Security by Design | PASS | Contract enforces role-based actions, auditable overrides, and project-scoped access patterns. |
| Typed Everything | PASS | Schemas and OpenAPI definitions specify strong typing and constrained enums. |
| Frontend Conventions | PASS | Quickstart mandates `apiClient` + TanStack Query integration points. |
| Async All The Way | PASS | Long-running proposal generation modeled as asynchronous run stage. |
| Standardized API Contract | PASS | Contract responses use the uniform success/failure envelope with trace IDs. |

## Complexity Tracking

No constitution violations identified for this planning scope.

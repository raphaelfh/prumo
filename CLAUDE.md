# Review Hub - AI Assistant Guide (CLAUDE.md)

> **Purpose**: This file provides comprehensive context about the Review Hub codebase architecture, patterns, and conventions to help AI assistants provide accurate and consistent help.

## Project Overview

**Review Hub** is a complete systematic review and meta-analysis management platform built with:
- **Frontend**: React 18 + TypeScript 5.8 + Vite + Tailwind CSS + shadcn/ui
- **Backend**: FastAPI (Python 3.11+) + Supabase (PostgreSQL)
- **AI Integration**: OpenAI GPT-4o + Anthropic Claude for automated quality assessment
- **Task Queue**: Celery + Redis for background processing

**License**: AGPL-3.0 with dual licensing model (commercial licenses available)

## Repository Structure

```
review-ai-hub/
├── src/                          # Frontend React application
│   ├── components/              # React components
│   ├── hooks/                   # Custom React hooks
│   ├── services/                # API client services
│   ├── pages/                   # Route pages
│   ├── contexts/                # React contexts (Auth, Theme, etc.)
│   ├── config/                  # App configuration
│   ├── lib/                     # Utilities and helpers
│   └── integrations/            # External API integrations
│
├── backend/                     # FastAPI backend
│   ├── app/
│   │   ├── api/v1/             # REST API endpoints
│   │   │   ├── endpoints/      # Domain-specific endpoints
│   │   │   └── router.py       # Route aggregator
│   │   ├── core/               # Core configurations
│   │   │   ├── config.py       # Environment variables
│   │   │   ├── deps.py         # FastAPI dependencies
│   │   │   ├── security.py     # JWT validation
│   │   │   ├── factories.py    # Factory functions
│   │   │   ├── logging.py      # Structured logging
│   │   │   ├── middleware.py   # Custom middlewares
│   │   │   └── error_handler.py
│   │   ├── models/             # SQLAlchemy ORM models
│   │   ├── repositories/       # Data access layer
│   │   ├── schemas/            # Pydantic schemas (validation)
│   │   ├── services/           # Business logic layer
│   │   ├── infrastructure/     # External integrations
│   │   │   └── storage/        # Storage adapters
│   │   ├── domain/             # Domain events and handlers
│   │   │   └── events/         # Event-driven patterns
│   │   ├── worker/             # Celery workers
│   │   │   └── tasks/          # Background tasks
│   │   ├── utils/              # Utilities
│   │   └── main.py             # FastAPI entry point
│   ├── tests/                  # Backend tests
│   │   ├── unit/
│   │   └── integration/
│   └── pyproject.toml          # Python dependencies (uv)
│
├── supabase/
│   └── migrations/             # Database migrations (source of truth)
│
├── docs/                       # Documentation
│   ├── guias/                  # Development guides (Portuguese)
│   ├── estrutura_database/     # Database schema docs
│   ├── tecnicas/               # Technical docs
│   └── legal/                  # Legal documents
│
├── scripts/                    # Automation scripts
├── Makefile                    # Development commands
├── package.json                # Frontend dependencies
└── .env.example                # Environment variables template
```

## Architecture Principles

### Backend Architecture (Layered + Clean Architecture)

The backend follows a **layered architecture** with clear separation of concerns:

```
┌──────────────────────────────────────────┐
│         API Layer (Endpoints)            │  ← HTTP, Request validation
├──────────────────────────────────────────┤
│       Service Layer (Business Logic)     │  ← Orchestration, Use cases
├──────────────────────────────────────────┤
│      Repository Layer (Data Access)      │  ← Database operations
├──────────────────────────────────────────┤
│         Models (SQLAlchemy ORM)          │  ← Database tables
└──────────────────────────────────────────┘
         ↓                    ↓
    Supabase DB         External APIs
   (PostgreSQL)      (OpenAI, Anthropic)
```

**Key Principles**:
1. **Dependency Flow**: API → Service → Repository → Models
2. **Dependency Injection**: All dependencies are injected via FastAPI's `Depends()`
3. **No Shortcuts**: Services should NEVER directly import endpoints; Repositories should NEVER know about HTTP
4. **Single Responsibility**: Each layer has ONE clear purpose

### Layer Responsibilities

#### 1. API Layer (`app/api/v1/endpoints/`)
- **Purpose**: HTTP interface
- **Responsibilities**:
  - Receive HTTP requests
  - Validate input with Pydantic schemas
  - Extract JWT user from Supabase Auth
  - Create service instances
  - Return standardized `ApiResponse`
  - Apply rate limiting (`@limiter.limit()`)

**Pattern**:
```python
@router.post("", response_model=ApiResponse)
@limiter.limit("10/minute")
async def endpoint_name(
    request: RequestSchema,
    db: DbSession,              # Injected
    user: CurrentUser,          # JWT validated
    supabase: SupabaseClient,   # Injected
) -> ApiResponse:
    """Endpoint docstring."""
    service = ServiceClass(db=db, user_id=user.sub, ...)
    result = await service.method_name(...)
    return ApiResponse(ok=True, data=result)
```

#### 2. Service Layer (`app/services/`)
- **Purpose**: Business logic and orchestration
- **Responsibilities**:
  - Orchestrate complex operations
  - Call multiple repositories
  - Integrate with external APIs (OpenAI, PDF processing)
  - Handle domain events
  - Transaction management (via UnitOfWork pattern when needed)
  - **Independent of HTTP** (no Request/Response objects)

**Pattern**:
```python
class ExampleService:
    """Service for [domain] operations."""

    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        storage: StorageAdapter,
        trace_id: str | None = None,
    ):
        self.db = db
        self.user_id = user_id
        self.storage = storage
        self.trace_id = trace_id

        # Initialize repositories
        self._repo1 = Repository1(db)
        self._repo2 = Repository2(db)

    async def business_method(self, ...) -> ResultType:
        """Execute business operation."""
        # 1. Fetch data via repositories
        # 2. Apply business rules
        # 3. Call external services if needed
        # 4. Save changes via repositories
        # 5. Return domain object (not HTTP response)
        ...
```

#### 3. Repository Layer (`app/repositories/`)
- **Purpose**: Data access abstraction
- **Responsibilities**:
  - CRUD operations
  - Complex queries
  - Data filtering
  - **No business logic**
  - Return SQLAlchemy models or None

**Pattern**:
```python
class ExampleRepository(BaseRepository[ModelType]):
    """Repository for [entity] data access."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ModelType)

    async def get_by_id(self, id: UUID) -> ModelType | None:
        """Get entity by ID."""
        result = await self.db.execute(
            select(self.model).where(self.model.id == id)
        )
        return result.scalar_one_or_none()

    async def find_by_criteria(self, criteria: ...) -> list[ModelType]:
        """Find entities matching criteria."""
        ...
```

#### 4. Models Layer (`app/models/`)
- **Purpose**: Database schema representation
- **Responsibilities**:
  - Map to PostgreSQL tables
  - Define relationships
  - Inherit from `BaseModel` (provides `id`, `created_at`, `updated_at`)

**Pattern**:
```python
class ExampleModel(BaseModel):
    """Example entity model."""

    __tablename__ = "example_table"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="examples")
```

### Schemas (`app/schemas/`)

Pydantic schemas for:
- **Request validation** (incoming HTTP data)
- **Response formatting** (outgoing HTTP data)
- **Internal DTOs** (data transfer between layers)

**Common Schemas**:
```python
# app/schemas/common.py

class ApiResponse(BaseModel):
    """Standardized API response."""
    ok: bool
    data: Any | None = None
    error: ErrorDetail | None = None
    trace_id: str | None = None

class ErrorDetail(BaseModel):
    """Error information."""
    message: str
    code: str | None = None
```

## Important Patterns

### 1. Dependency Injection

**FastAPI Dependencies** (`app/core/deps.py`):
```python
from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from supabase import Client

# Type aliases for clean annotations
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]
SupabaseClient = Annotated[Client, Depends(get_supabase_client)]

# Usage in endpoints
async def my_endpoint(
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
):
    ...
```

### 2. Storage Adapter Pattern

For Supabase Storage operations:
```python
# app/infrastructure/storage/base.py
class StorageAdapter(Protocol):
    """Storage operations interface."""
    async def upload(self, bucket: str, path: str, file: bytes) -> str: ...
    async def download(self, bucket: str, path: str) -> bytes: ...
    async def delete(self, bucket: str, path: str) -> None: ...

# app/core/factories.py
def create_storage_adapter(supabase: Client) -> StorageAdapter:
    """Factory for creating storage adapter."""
    return SupabaseStorageAdapter(supabase)
```

### 3. Unit of Work Pattern

Used for transactions spanning multiple repositories:
```python
# app/repositories/unit_of_work.py
class UnitOfWork:
    """Manages database transactions."""

    def __init__(self, session: AsyncSession):
        self.session = session
        # Initialize all repositories
        self.articles = ArticleRepository(session)
        self.projects = ProjectRepository(session)

    async def commit(self) -> None:
        await self.session.commit()

    async def rollback(self) -> None:
        await self.session.rollback()
```

### 4. Domain Events

For decoupled async operations:
```python
# app/domain/events/base.py
class DomainEvent:
    """Base domain event."""
    event_id: str
    event_type: str
    occurred_at: datetime

# app/domain/events/handlers.py
async def handle_event(event: DomainEvent) -> None:
    """Process domain event (e.g., trigger Celery task)."""
    ...
```

## Database Guidelines

### Source of Truth
**Supabase migrations** in `supabase/migrations/` are the **single source of truth** for database schema.

### Row Level Security (RLS)
All tables use Supabase RLS policies that check `auth.uid()`. The backend authenticates users via JWT tokens from Supabase Auth.

### Migration Flow
1. Create migration: `supabase migration new <name>`
2. Write SQL in generated file
3. Apply locally: `supabase db reset` (drops + recreates)
4. Push to remote: `supabase db push`

**See**: [docs/guias/FLUXO_ALTERACAO_DATABASE.md](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/docs/guias/FLUXO_ALTERACAO_DATABASE.md?type=file&root=%252F)

## API Conventions

### Endpoint Structure
```
/api/v1/{resource}/{action}
```

Example: `/api/v1/ai-assessment/assess`

### Standard Response Format
```json
{
  "ok": true,
  "data": { ... },
  "error": null,
  "trace_id": "uuid"
}
```

### Rate Limiting
All endpoints use `@limiter.limit("X/minute")` decorator.

### Authentication
- JWT token from Supabase Auth in `Authorization: Bearer <token>` header
- Validated in `get_current_user()` dependency
- User ID extracted from `user.sub`

## Testing Strategy

### Backend Tests
- **Unit tests**: `backend/tests/unit/` - Test services and repositories in isolation
- **Integration tests**: `backend/tests/integration/` - Test full request/response cycle
- **Coverage**: Currently omits `app/schemas/read_models/*` and `app/worker/*` (see `pyproject.toml`)

### Running Tests
```bash
cd backend
uv run pytest                    # All tests
uv run pytest tests/unit/        # Unit only
uv run pytest --cov=app          # With coverage
```

## Development Workflow

### Setting Up Local Environment

**Quick Start** (recommended):
```bash
make setup    # First time: install deps, start Supabase
make start    # Start all services
make status   # Check status
make urls     # View important URLs
```

**Manual Setup**:
```bash
# 1. Install frontend deps
npm install

# 2. Install backend deps
cd backend && uv sync && cd ..

# 3. Start Supabase
cd supabase && supabase start && cd ..

# 4. Start backend (terminal 1)
cd backend && uv run uvicorn app.main:app --reload --port 8000

# 5. Start frontend (terminal 2)
npm run dev
```

### Available URLs
- Frontend: http://localhost:8080
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/api/v1/docs
- Supabase Studio: http://127.0.0.1:54323

### Makefile Commands
- `make start` - Start all services
- `make stop` - Stop all services
- `make restart` - Restart all services
- `make health` - Health check
- `make logs` - View logs
- `make help` - List all commands

## Adding New Features

### Adding a New Endpoint

**Flow**: [docs/guias/FLUXO_ADICIONAR_ENDPOINT.md](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/docs/guias/FLUXO_ADICIONAR_ENDPOINT.md?type=file&root=%252F)

**Steps**:
1. Define Pydantic schemas in `app/schemas/`
2. Create service in `app/services/`
3. Create endpoint in `app/api/v1/endpoints/`
4. Register route in `app/api/v1/router.py`
5. Add tests

### Adding a New Feature

**Flow**: [docs/guias/FLUXO_ADICIONAR_FEATURE.md](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/docs/guias/FLUXO_ADICIONAR_FEATURE.md?type=file&root=%252F)

**Steps**:
1. Design database schema (if needed)
2. Create migration
3. Create models
4. Create repositories
5. Create services
6. Create endpoints
7. Add frontend integration
8. Add tests

## Code Style and Linting

### Backend (Python)
- **Tool**: Ruff (linter + formatter)
- **Config**: `backend/pyproject.toml`
- **Target**: Python 3.11+
- **Line length**: 100 characters
- **Type checking**: mypy (strict mode)

**Run**:
```bash
cd backend
uv run ruff check .      # Lint
uv run ruff format .     # Format
uv run mypy app/         # Type check
```

### Frontend (TypeScript)
- **Tool**: ESLint
- **Config**: `eslint.config.js`
- **Target**: ES2020+

**Run**:
```bash
npm run lint
```

## Environment Variables

### Frontend (`.env`)
```env
VITE_SUPABASE_ENV=local|production
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key
VITE_FASTAPI_BASE_URL=http://localhost:8000
```

### Backend (`backend/.env`)
```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0
```

## Common Pitfalls

### ❌ Don't Do This
```python
# DON'T: Import endpoint in service
from app.api.v1.endpoints import some_endpoint

# DON'T: Handle HTTP in service
async def service_method() -> Response:
    return JSONResponse(...)

# DON'T: Business logic in endpoint
@router.post("/")
async def endpoint():
    # Complex business logic here...

# DON'T: Direct database access in endpoint
@router.post("/")
async def endpoint(db: DbSession):
    result = await db.execute(...)  # Should use repository

# DON'T: Hardcode user_id
user_id = "123"  # Always use user.sub from JWT
```

### ✅ Do This Instead
```python
# DO: Service handles business logic
class MyService:
    async def do_something(self) -> DomainObject:
        # Business logic here
        return result

# DO: Endpoint delegates to service
@router.post("/")
async def endpoint(user: CurrentUser, db: DbSession):
    service = MyService(db=db, user_id=user.sub)
    result = await service.do_something()
    return ApiResponse(ok=True, data=result)

# DO: Use repositories for data access
class MyService:
    def __init__(self, db: AsyncSession):
        self._repo = MyRepository(db)

    async def get_data(self):
        return await self._repo.find_by_criteria(...)
```

## Useful References

### Documentation
- [Architecture Guide](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/docs/guias/ARQUITETURA_BACKEND.md?type=file&root=%252F)
- [Database Schema](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/docs/estrutura_database/DATABASE_SCHEMA.md?type=file&root=%252F)
- [Database Quick Guide](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/docs/estrutura_database/GUIA_RAPIDO.md?type=file&root=%252F)
- [Contributing Guide](fleet-file://fcrd10ohldn5524f0egu/Users/raphaelhaddad/PycharmProjects/review-ai-hub/.github/CONTRIBUTING.md?type=file&root=%252F)

### External Docs
- [FastAPI](https://fastapi.tiangolo.com/)
- [Supabase](https://supabase.com/docs)
- [SQLAlchemy 2.0](https://docs.sqlalchemy.org/en/20/)
- [Pydantic](https://docs.pydantic.dev/)
- [React Query (TanStack)](https://tanstack.com/query/latest)

## Git Workflow

### Branches
- `main` - Production (protected)
- `dev` - Development (current branch)
- `feature/*` - Feature branches
- `fix/*` - Bug fix branches

### Commit Convention
```
feat: add new feature
fix: fix bug
docs: update documentation
refactor: refactor code
test: add tests
chore: maintenance tasks
```

### Current Git Status
```
Branch: dev
Modified:
  - backend/app/api/v1/endpoints/ai_assessment.py
  - backend/app/api/v1/endpoints/model_extraction.py
  - backend/app/api/v1/endpoints/section_extraction.py
  - backend/app/api/v1/endpoints/user_api_keys.py
  - backend/app/api/v1/endpoints/zotero_import.py
  - backend/app/repositories/article_repository.py
  - backend/app/schemas/assessment.py
  - backend/app/schemas/extraction.py
  - backend/app/worker/tasks/import_tasks.py
  - backend/pyproject.toml

Deleted (recent refactoring):
  - backend/app/repositories/queries/ (consolidated into repositories)
  - backend/app/use_cases/ (simplified to service layer)

Untracked:
  - backend/app/schemas/user_api_key.py
  - backend/app/services/zotero_import_service.py
```

Recent refactoring focused on:
- Simplifying worker tasks with service layer
- Consolidating Supabase config
- Removing Alembic (using Supabase migrations only)
- Removing edge functions

## AI Assistant Best Practices

When helping with this codebase:

1. **Always follow the layered architecture** - Don't skip layers or create shortcuts
2. **Use dependency injection** - Don't instantiate dependencies directly
3. **Check existing patterns** - Look at similar endpoints/services for consistency
4. **Validate with schemas** - Use Pydantic for all input/output validation
5. **Consider RLS** - Remember that database access is controlled by Supabase RLS policies
6. **Think about async** - All database operations are async (use `await`)
7. **Return domain objects from services** - Not HTTP responses
8. **Use type hints** - Python 3.11+ type hints everywhere
9. **Write docstrings** - Every public function needs a docstring
10. **Follow SOLID principles** - Especially Single Responsibility

## Quick Reference: File Locations

When asked to add/modify features, files typically go in:

- **New endpoint** → `backend/app/api/v1/endpoints/{domain}.py`
- **New service** → `backend/app/services/{domain}_service.py`
- **New repository** → `backend/app/repositories/{entity}_repository.py`
- **New model** → `backend/app/models/{entity}.py`
- **New schema** → `backend/app/schemas/{domain}.py`
- **New migration** → `supabase/migrations/{timestamp}_{name}.sql`
- **New React component** → `src/components/{category}/{ComponentName}.tsx`
- **New React page** → `src/pages/{PageName}.tsx`
- **New API service** → `src/services/{domain}Service.ts`
- **Tests** → `backend/tests/{unit|integration}/test_{module}.py`

---

**Last Updated**: 2026-01-25
**Project Version**: 0.1.0
**Python Version**: 3.11+
**Node Version**: 18+

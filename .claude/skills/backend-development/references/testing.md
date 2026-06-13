# Testing the backend

Test runner: `pytest` + `pytest-asyncio`. Tests live under `backend/tests/`. Run via `make test-backend` (defaults from `backend/pyproject.toml`).

## Test pyramid we actually invest in

| Layer | Where | Priority |
|---|---|---|
| Service unit tests against a real Postgres (Supabase local) | `backend/tests/services/` | high — catch RLS misses, FK mistakes, transaction bugs |
| Endpoint integration tests (auth + project gate + happy path) | `backend/tests/api/` | high — the BOLA fence |
| Migration up/down tests | `backend/tests/migrations/` | medium — run on PRs that touch `alembic/versions/` |
| Pure-Python unit tests (validators, utilities) | `backend/tests/utils/` | medium — fast, but limited scope |
| End-to-end (Playwright) | `frontend/tests/e2e/` | covered by the frontend, not here |

Heavy mocking of the DB is discouraged. Use a real Postgres via the local Supabase stack — it's fast enough and the test catches real things.

## Async fixtures (the spine)

```python
# backend/tests/conftest.py (sketch)
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.deps import get_db
from app.main import app


@pytest_asyncio.fixture(scope="session")
async def engine():
    eng = create_async_engine(settings.async_database_url, future=True)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db_session(engine) -> AsyncSession:
    """Per-test transactional session — rolled back at teardown."""
    SessionFactory = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.connect() as conn:
        trans = await conn.begin()
        session = SessionFactory(bind=conn)
        try:
            yield session
        finally:
            await session.close()
            await trans.rollback()


@pytest_asyncio.fixture
async def client(db_session):
    """HTTP client with DB and auth overrides."""
    app.dependency_overrides[get_db] = lambda: db_session
    # override auth — your project has helpers for this
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
```

Key ideas:
- Session-scoped engine, function-scoped session inside a rollback'd transaction. Tests can't pollute each other.
- `app.dependency_overrides` rather than monkey-patching modules — clean and FastAPI-aware.
- Clear overrides in teardown so one test's fixture doesn't leak into the next.

## Authenticating the test client

Don't mint JWTs in tests. Override `get_current_user_sub`:

```python
TEST_USER_ID = UUID("00000000-0000-0000-0000-000000000001")


@pytest.fixture
def authed_client(client):
    from app.api.deps.security import get_current_user_sub
    app.dependency_overrides[get_current_user_sub] = lambda: TEST_USER_ID
    yield client
    app.dependency_overrides.pop(get_current_user_sub, None)
```

For per-test user identities, parameterize the override:
```python
def as_user(client, user_id: UUID):
    app.dependency_overrides[get_current_user_sub] = lambda: user_id
    return client
```

## Factories

Use a factory module (`backend/tests/factories.py`) for ORM instances:

```python
async def create_project(db, *, manager_id: UUID) -> Project:
    p = Project(name="t", description="", created_by=manager_id)
    db.add(p)
    await db.flush()
    db.add(ProjectMember(project_id=p.id, user_id=manager_id, role="manager"))
    await db.flush()
    return p
```

Skip third-party factory libraries (`factory_boy`) — homemade async factories tied to your real services are clearer.

## Endpoint integration tests — the canonical shape

```python
async def test_open_hitl_session_creates_run_201(authed_client, db_session):
    project = await create_project(db_session, manager_id=TEST_USER_ID)
    article = await create_article(db_session, project_id=project.id)
    template = await create_extraction_template(db_session, project_id=project.id)

    res = await authed_client.post(
        "/api/v1/hitl/sessions",
        json={
            "kind": "extraction",
            "project_id": str(project.id),
            "article_id": str(article.id),
            "project_template_id": str(template.id),
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["data"]["run_id"]


async def test_open_hitl_session_403_for_non_member(client, db_session):
    project = await create_project(db_session, manager_id=uuid4())
    article = await create_article(db_session, project_id=project.id)
    template = await create_extraction_template(db_session, project_id=project.id)

    # NOT in the project
    as_user(client, uuid4())
    res = await client.post("/api/v1/hitl/sessions", json={...})
    assert res.status_code == 403
```

The 403 test is the BOLA fence. Add one for every endpoint that takes a `project_id` in body or path. CI should fail if it's missing.

## Service-only tests

Don't go through the HTTP layer when you're testing a service:

```python
async def test_hitl_session_resumes_existing_run(db_session):
    ...
    service = HITLSessionService(db_session)
    first = await service.open_or_resume(...)
    second = await service.open_or_resume(...)
    assert first.run_id == second.run_id
    assert second.created is False
```

Faster, and the failure points straight at the service.

## Migration tests

```python
import subprocess


def test_migrations_up_and_down(tmp_path):
    # On a freshly reset DB:
    subprocess.run(["alembic", "upgrade", "head"], check=True, cwd="backend")
    subprocess.run(["alembic", "downgrade", "-1"], check=True, cwd="backend")
    subprocess.run(["alembic", "upgrade", "head"], check=True, cwd="backend")
```

This catches the common "I forgot to write a working `downgrade`" bug. CI should run this on PRs that touch `alembic/versions/`.

## Celery in tests

Eager mode runs tasks inline so you can assert side effects synchronously:

```python
@pytest.fixture
def celery_eager(monkeypatch):
    monkeypatch.setattr("app.worker.celery_app.celery_app.conf.task_always_eager", True)
    monkeypatch.setattr("app.worker.celery_app.celery_app.conf.task_eager_propagates", True)


async def test_extract_section_task_records_proposals(celery_eager, db_session):
    extract_section_task.delay(project_id=..., article_id=..., ...)
    # Assert the side effects directly in db_session.
```

`task_eager_propagates=True` is what turns task exceptions into test failures. Without it, errors disappear into the result backend.

## Snapshot testing — only for stable shapes

For OpenAPI schema, you might snapshot. For HTTP responses, prefer explicit field assertions — a snapshot lets a real regression slide because "the file changed and looked fine".

## Tooling

- `ruff check + format` via `make lint-backend`. Treat as part of the test suite.
- `mypy` if/when configured — type errors should be a CI failure.
- Coverage: aim for 80% on services and endpoints. Don't chase 100% — the last 20% is usually trivial branches and untestable error paths.

## Anti-patterns

- Reusing one DB session across tests. State leaks; flakiness follows.
- Asserting against the production DB. Use the local Supabase stack via `make start`.
- Mocking `AsyncSession`. The mock will accept calls real Postgres rejects.
- Patching internal functions to bypass auth in a test. Use `dependency_overrides`.
- Asserting `res.text` (the JSON shape) without parsing — typos hide in here.

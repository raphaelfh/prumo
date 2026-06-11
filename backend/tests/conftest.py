"""
Pytest Configuration.

Fixtures compartilhadas para todos os testes.
Suporta testes com mocks e testes de integração com banco real.
"""

import asyncio
import uuid
from collections.abc import AsyncGenerator, Generator
from unittest.mock import AsyncMock, MagicMock

import logfire
import pydantic_ai.models
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

# These guards must execute before any `app.*` import:
# - logfire: disable the exporter so tests never emit spans, even when
#   LOGFIRE_TOKEN is set in the developer's environment.
# - pydantic-ai: block real model requests; tests use TestModel/FunctionModel.
logfire.configure(send_to_logfire=False, console=False)
pydantic_ai.models.ALLOW_MODEL_REQUESTS = False

from app.core.config import settings  # noqa: E402
from app.core.deps import get_db, get_supabase  # noqa: E402
from app.core.security import TokenPayload, get_current_user  # noqa: E402
from app.main import app  # noqa: E402

# =================== EVENT LOOP ===================


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


# =================== FIXTURES COM MOCKS (para testes leves) ===================


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """
    Fixture que fornece cliente HTTP para testes de API.

    Sobrescreve dependencies de banco e autenticação com mocks.
    Use para testes que não precisam de banco de dados real.
    """

    # Mock da sessão de banco
    mock_db = AsyncMock(spec=AsyncSession)

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield mock_db

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub="test-user-id",
            email="test@example.com",
            role="authenticated",
            aal="aal1",
        )

    # Mock do Supabase client
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = (
        MagicMock(data=[])
    )

    def override_get_supabase() -> MagicMock:
        return mock_supabase

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_supabase] = override_get_supabase

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# =================== ENGINE (session-scoped, async-loop-agnostic) ===================


@pytest.fixture(scope="session")
def _engine() -> Generator[AsyncEngine, None, None]:
    """
    Single async engine reused across the test session.

    Intentionally a SYNC fixture: ``create_async_engine`` is a sync
    constructor, and ``NullPool`` means no connections are held between
    calls — each ``engine.connect()`` opens a fresh connection bound to
    the calling loop. This sidesteps pytest-asyncio 1.x loop-scope rules
    that would otherwise forbid a session-scoped async fixture being
    consumed by function-scoped tests.

    ``engine.dispose()`` is async; we run it under a fresh ``asyncio.run``
    at teardown — safe because there are no live connections to evict
    (NullPool).
    """
    engine = create_async_engine(
        settings.async_database_url,
        echo=False,
        poolclass=NullPool,
    )
    yield engine
    asyncio.run(engine.dispose())


# =================== FIXTURES COM BANCO REAL ===================


@pytest_asyncio.fixture(scope="function")
async def db_session(_engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    """
    SAVEPOINT-isolated session for integration tests. The DEFAULT db fixture.

    Inner commits (test code, endpoints under test, services) land in a
    SAVEPOINT that is rolled back at teardown — zero cross-test pollution
    by construction. The ``after_transaction_end`` hook re-opens a fresh
    SAVEPOINT every time an inner commit closes the current one, so the
    outer transaction stays alive until ``finally``.

    Use ``db_session_real`` when you need:
      - Genuine cross-session visibility (test spins its own parallel
        connection and expects to read its own writes).
      - DEFERRED triggers to actually fire (commit-time constraint checks);
        see ``backend/tests/integration/smoke_constraints/``.
    """
    async with _engine.connect() as conn:
        outer_trans = await conn.begin()
        Session = async_sessionmaker(bind=conn, expire_on_commit=False)
        async with Session() as session:
            await session.begin_nested()  # initial SAVEPOINT

            @event.listens_for(session.sync_session, "after_transaction_end")
            def _restart_savepoint(sess, trans):  # type: ignore[no-redef]
                if trans.nested and not trans._parent.nested:
                    sess.begin_nested()

            try:
                yield session
            finally:
                if outer_trans.is_active:
                    await outer_trans.rollback()


@pytest_asyncio.fixture(scope="function")
async def db_session_real(_engine: AsyncEngine) -> AsyncGenerator[AsyncSession, None]:
    """
    Real-commit session — explicit opt-out from SAVEPOINT isolation.

    Commits made through this session persist for the rest of the test
    session unless the test cleans up after itself. Prefer ``db_session``
    unless you specifically need:
      - Cross-session visibility (concurrency tests).
      - DEFERRED trigger coverage.

    Tests using this fixture are responsible for their own teardown
    (``DELETE`` what they ``INSERT``). The 3 existing concurrency tests
    already open their own ``async_sessionmaker`` and do not need this
    fixture; this is for new tests that want a single real-commit session
    without re-implementing the boilerplate.
    """
    async with _engine.connect() as conn:
        Session = async_sessionmaker(bind=conn, expire_on_commit=False)
        async with Session() as session:
            yield session


@pytest_asyncio.fixture
async def db_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """
    Fixture que fornece cliente HTTP com banco de dados REAL.

    Use para testes de integração que precisam do banco.
    """

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub="test-user-id",
            email="test@example.com",
            role="authenticated",
            aal="aal1",
        )

    # Mock do Supabase client (ainda mockado para Storage)
    mock_supabase = MagicMock()
    mock_supabase.table.return_value.select.return_value.eq.return_value.execute.return_value = (
        MagicMock(data=[])
    )

    def override_get_supabase() -> MagicMock:
        return mock_supabase

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_supabase] = override_get_supabase

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# =================== FIXTURES DE DADOS DE TESTE ===================


@pytest.fixture
def test_user_id() -> str:
    """ID de usuário para testes."""
    return str(uuid.uuid4())


@pytest.fixture
def test_org_id() -> str:
    """ID de organização para testes."""
    return str(uuid.uuid4())


@pytest.fixture
def mock_user() -> TokenPayload:
    """Fixture com usuário mock para testes."""
    return TokenPayload(
        sub="test-user-id",
        email="test@example.com",
        role="authenticated",
        aal="aal1",
    )


@pytest.fixture
def sample_pdf_bytes() -> bytes:
    """
    Fixture com PDF de exemplo para testes.

    Cria um PDF mínimo válido.
    """
    # PDF mínimo válido
    return b"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length 44 >> stream
BT /F1 12 Tf 100 700 Td (Test PDF) Tj ET
endstream endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000214 00000 n 
trailer << /Size 5 /Root 1 0 R >>
startxref
306
%%EOF"""

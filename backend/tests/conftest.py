# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
Pytest Configuration.

Fixtures compartilhadas para todos os testes.
"""

import asyncio
from collections.abc import AsyncGenerator, Generator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.deps import get_db
from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.models.base import Base


# Test database URL (usar database separado para testes)
TEST_DATABASE_URL = settings.async_database_url.replace(
    "/postgres", "/postgres_test"
)


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create event loop for async tests."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Fixture que fornece sessão de banco de dados para testes.
    
    Cria tabelas antes e limpa depois de cada teste.
    """
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async_session = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    
    async with async_session() as session:
        yield session
    
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    
    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """
    Fixture que fornece cliente HTTP para testes de API.
    
    Sobrescreve dependencies de banco e autenticação.
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
    
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac
    
    app.dependency_overrides.clear()


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


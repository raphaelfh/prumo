"""
Dependencies Module.

Contem todas as dependencies compartilhadas da aplicacao:
- Database session
- Supabase client
- Current user
"""

from collections.abc import AsyncGenerator
from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from supabase import Client, create_client

from app.core.config import settings
from app.core.logging import get_logger
from app.core.security import TokenPayload, get_current_user

logger = get_logger(__name__)

# =================== DATABASE ===================

# Engine async for PostgreSQL
# NOTA: O workaround de ::VARCHAR for ENUMs foi REMOVIDO.
# Agora usamos PostgreSQLEnumType (em app.models.base) que resolve o problema
# de forma declarativa diretamente nos models SQLAlchemy.
engine = create_async_engine(
    settings.async_database_url,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    connect_args={
        "statement_cache_size": 0,  # ✅ Desabilita prepared statements (compativel with pgbouncer)
        "server_settings": {
            "jit": "off",  # Desabilita JIT for melhor performance em queries complexas
        },
    },
)

# Session factory
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency que fornece uma sessao de banco de data.

    A sessao e automaticamente fechada ao final da request.

    Yields:
        AsyncSession: Sessao do SQLAlchemy.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


# Type alias for uso nas rotas
DbSession = Annotated[AsyncSession, Depends(get_db)]


# =================== SUPABASE CLIENT ===================


@lru_cache
def get_supabase_client() -> Client:
    """
    Return cliente Supabase configurado with service role.

    Usado for operacoes que precisam de acesso elevado:
    - Storage operations
    - Bypass RLS quando necessario

    Returns:
        Client: Supabase client configurado.
    """
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_SERVICE_ROLE_KEY,
    )


def get_supabase() -> Client:
    """Dependency for obter Supabase client."""
    return get_supabase_client()


SupabaseClient = Annotated[Client, Depends(get_supabase)]


# =================== CURRENT USER ===================

CurrentUser = Annotated[TokenPayload, Depends(get_current_user)]


# =================== COMBINED DEPENDENCIES ===================


class RequestContext:
    """
    Contexto da requisicao with todas as dependencies comuns.

    Agrupa db, user and supabase for facilitar passagem for services.
    """

    def __init__(
        self,
        db: AsyncSession,
        user: TokenPayload,
        supabase: Client,
    ):
        self.db = db
        self.user = user
        self.supabase = supabase

    @property
    def user_id(self) -> str:
        """user atual."""
        return self.user.sub


async def get_request_context(
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
) -> RequestContext:
    """
    Dependency que fornece contexto completo da requisicao.

    Util for services que precisam de multiplas dependencies.
    """
    return RequestContext(db=db, user=user, supabase=supabase)


RequestCtx = Annotated[RequestContext, Depends(get_request_context)]

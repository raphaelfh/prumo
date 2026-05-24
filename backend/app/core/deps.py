"""
Dependencies Module.

Contains all shared application dependencies:
- Database session
- Supabase client
- Current user
"""

from collections.abc import AsyncGenerator
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
# NOTE: The ::VARCHAR workaround for ENUMs was REMOVED.
# We now use PostgreSQLEnumType (in app.models.base), which resolves
# the problem declaratively at the SQLAlchemy model level.
engine = create_async_engine(
    settings.async_database_url,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    connect_args={
        "statement_cache_size": 0,  # Disable prepared statements (compatible with pgbouncer)
        "server_settings": {
            "jit": "off",  # Disable JIT for better performance on complex queries
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
    Dependency that provides a database session.

    The session is automatically closed at the end of the request.

    Yields:
        AsyncSession: SQLAlchemy async session.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


# Type alias for use in routes
DbSession = Annotated[AsyncSession, Depends(get_db)]


# =================== SUPABASE CLIENT ===================


def get_supabase_client() -> Client:
    """Return a fresh Supabase service-role client.

    NOT cached. The cached version was the root cause of the 2026-05-24
    event-loop reuse bug — the underlying httpx client binds its
    connection pool to the loop active at construction time, so reusing
    one across loops raises ``RuntimeError: <Future ...> attached to a
    different loop``. Worker tasks construct one per invocation via
    ``app.worker._runner.run_task``; FastAPI request handlers construct
    one per request via ``get_supabase`` in this module.
    """
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_SERVICE_ROLE_KEY,
    )


def get_supabase() -> Client:
    """Dependency to obtain a Supabase client."""
    return get_supabase_client()


SupabaseClient = Annotated[Client, Depends(get_supabase)]


# =================== CURRENT USER ===================

CurrentUser = Annotated[TokenPayload, Depends(get_current_user)]


# =================== COMBINED DEPENDENCIES ===================


class RequestContext:
    """
    Request context grouping all common dependencies.

    Bundles db, user, and supabase to simplify passing them to services.
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
        """Current user id."""
        return self.user.sub


async def get_request_context(
    db: DbSession,
    user: CurrentUser,
    supabase: SupabaseClient,
) -> RequestContext:
    """
    Dependency that provides the complete request context.

    Useful for services that need multiple dependencies.
    """
    return RequestContext(db=db, user=user, supabase=supabase)


RequestCtx = Annotated[RequestContext, Depends(get_request_context)]

"""
Base Repository.

Generic base class for every repository. Implements the common CRUD
operations with SQLAlchemy async.

IMPORTANT — transaction management:
===================================

These methods never commit. They flush() to push changes to the database
and obtain generated IDs; the commit is always someone else's call
(constitution §I).

Why flush() instead of commit()?
--------------------------------
1. Lets callers compose operations (create several related entities).
2. Keeps a rollback possible when a later step fails.
3. Avoids partial commits in the middle of a multi-step operation.

Who commits, then?
------------------
    # The usual case: the service or endpoint owning the request commits.
    repo = ArticleRepository(session)
    article = await repo.create(Article(title="New"))
    await session.commit()

    # A UnitOfWork block scopes the same session with rollback-on-exception,
    # for the repositories it exposes. It is not a facade over all of them —
    # see app/repositories/unit_of_work.py.
    async with UnitOfWork(session) as uow:
        member = await uow.project_members.create(member)
        await uow.commit()
"""

from time import perf_counter
from typing import Any, Generic, TypeVar
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.base import Base

# Type var for modelo SQLAlchemy
T = TypeVar("T", bound=Base)
logger = get_logger(__name__)


class BaseRepository(Generic[T]):
    """
    Generic base repository with CRUD operations.

    IMPORTANT: this repository flushes and never commits. The caller owns
    the commit, which is what lets several operations share one transaction.

    Attributes:
        db: SQLAlchemy async session.
        model: SQLAlchemy model class.

    Usage:
        repo = ArticleRepository(session)
        article = await repo.create(Article(title="Test"))
        await session.commit()  # the caller controls the commit
    """

    def __init__(self, db: AsyncSession, model: type[T]):
        """
        Inicializa o repository.

        Args:
            db: Sessao async do SQLAlchemy.
            model: Classe do modelo.
        """
        self.db = db
        self.model = model

    async def get_by_id(self, id: UUID | str) -> T | None:
        """
        Fetch entidade por ID.

        Args:
            id: UUID or string do ID.

        Returns:
            Entidade encontrada or None.
        """
        if isinstance(id, str):
            id = UUID(id)

        query_start = perf_counter()
        result = await self.db.execute(select(self.model).where(self.model.id == id))
        query_duration_ms = (perf_counter() - query_start) * 1000
        logger.debug(
            "repository_get_by_id_db_latency",
            repository=self.__class__.__name__,
            model=self.model.__name__,
            operation="get_by_id",
            record_id=str(id),
            db_duration_ms=query_duration_ms,
        )
        return result.scalar_one_or_none()

    async def create(self, obj: T) -> T:
        """
        Create a new entity.

        NOTE: flushes to obtain the generated ID, but never commits.
        Commit through the session (or a UnitOfWork block) afterwards.

        Args:
            obj: model instance to create.

        Returns:
            The created entity, with its generated ID.

        Example:
            repo = ArticleRepository(session)
            created = await repo.create(Article(title="New", project_id=pid))
            # created.id is available after flush()
            await session.commit()  # persists it
        """
        query_start = perf_counter()
        self.db.add(obj)
        await self.db.flush()
        await self.db.refresh(obj)
        query_duration_ms = (perf_counter() - query_start) * 1000
        logger.info(
            "repository_create_db_latency",
            repository=self.__class__.__name__,
            model=self.model.__name__,
            operation="create",
            record_id=str(getattr(obj, "id", "unknown")),
            db_duration_ms=query_duration_ms,
        )
        return obj

    async def update(self, obj: T, data: dict[str, Any]) -> T:
        """
        Update an existing entity.

        NOTE: flushes to synchronise, but never commits.
        Commit through the session (or a UnitOfWork block) afterwards.

        Args:
            obj: entity to update.
            data: values to apply (key=attribute, value=new value).

        Returns:
            The updated entity.

        Example:
            repo = ArticleRepository(session)
            article = await repo.get_by_id(id)
            updated = await repo.update(article, {"title": "New"})
            await session.commit()
        """
        query_start = perf_counter()
        for key, value in data.items():
            if hasattr(obj, key):
                setattr(obj, key, value)

        await self.db.flush()
        await self.db.refresh(obj)
        query_duration_ms = (perf_counter() - query_start) * 1000
        logger.info(
            "repository_update_db_latency",
            repository=self.__class__.__name__,
            model=self.model.__name__,
            operation="update",
            record_id=str(getattr(obj, "id", "unknown")),
            db_duration_ms=query_duration_ms,
        )
        return obj

    async def delete(self, obj: T) -> None:
        """
        Remove an entity.

        NOTE: flushes to synchronise, but never commits.
        Commit through the session (or a UnitOfWork block) afterwards.

        Args:
            obj: entity to remove.

        Example:
            repo = ArticleRepository(session)
            article = await repo.get_by_id(id)
            await repo.delete(article)
            await session.commit()
        """
        query_start = perf_counter()
        await self.db.delete(obj)
        await self.db.flush()
        query_duration_ms = (perf_counter() - query_start) * 1000
        logger.info(
            "repository_delete_db_latency",
            repository=self.__class__.__name__,
            model=self.model.__name__,
            operation="delete",
            record_id=str(getattr(obj, "id", "unknown")),
            db_duration_ms=query_duration_ms,
        )

    async def exists(self, id: UUID | str) -> bool:
        """
        Check se entidade existe.

        Args:
            id: entidade.

        Returns:
            True se existe.
        """
        if isinstance(id, str):
            id = UUID(id)

        result = await self.db.execute(select(func.count()).where(self.model.id == id))
        return result.scalar_one() > 0

    async def count(self) -> int:
        """
        Conta total de entidades.

        Returns:
            Numero total de entidades.
        """
        result = await self.db.execute(select(func.count()).select_from(self.model))
        return result.scalar_one()

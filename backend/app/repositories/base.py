"""
Base Repository.

Classe base generica for todos os repositories.
Implementa operacoes CRUD comuns with SQLAlchemy async.

IMPORTANTE - Managesmento de Transacoes:
=========================================

Os metodos deste repository NAO fazem commit automaticamente.
Usamos flush() for sincronizar mudancas and obter IDs gerados,
mas o commit() deve ser chamado explicitamente via UnitOfWork.

Por que flush() em vez de commit()?
-----------------------------------
1. Permite operacoes compostas (criar multiplas entidades relacionadas)
2. Possibilita rollback se alguma parte falhar
3. Segue o padrao Unit of Work corretamente
4. Evita commits parciais em operacoes complexas

Como usar corretamente:
-----------------------
    # Forma recomendada: via UnitOfWork
    async with UnitOfWork(session) as uow:
        article = Article(title="Novo")
        await uow.articles.create(article)
        await uow.commit()  # Commit explicito

    # If using repository directly (not recommended):
    repo = ArticleRepository(session)
    article = await repo.create(Article(title="Novo"))
    await session.commit()  # VOCE deve fazer o commit!

Relacionamento with UnitOfWork:
------------------------------
- Repositories sao criados pelo UnitOfWork
- UnitOfWork controla commit/rollback
- Se excecao ocorrer, UnitOfWork faz rollback automatico
"""

from typing import Any, Generic, TypeVar
from time import perf_counter
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
    Repository base generico with operacoes CRUD.

    IMPORTANTE: Este repository usa flush() and NAO commit().
    O commit deve ser feito via UnitOfWork or diretamente in the session.
    Isso permite agrupar multiplas operacoes em uma transacao.

    Attributes:
        db: Sessao async do SQLAlchemy.
        model: Classe do modelo SQLAlchemy.

    Usage with UnitOfWork (recomendado):
        async with UnitOfWork(session) as uow:
            article = await uow.articles.get_by_id(id)
            await uow.articles.update(article, {"title": "Novo"})
            await uow.commit()  # Commit explicito

    Usage direto (apenas for casos especiais):
        repo = ArticleRepository(session)
        article = await repo.create(Article(title="Test"))
        await session.commit()  # Voce controla o commit
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

    async def get_all(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
    ) -> list[T]:
        """
        List todas as entidades with paginacao.

        Args:
            skip: Offset for paginacao.
            limit: Limite de resultados.

        Returns:
            List de entidades.
        """
        result = await self.db.execute(select(self.model).offset(skip).limit(limit))
        return list(result.scalars().all())

    async def create(self, obj: T) -> T:
        """
        Create nova entidade.

        NOTA: Faz flush() for obter ID gerado, mas NAO faz commit().
        Use UnitOfWork.commit() or session.commit() apos criar.

        Args:
            obj: Instancia do modelo a criar.

        Returns:
            Entidade criada with ID gerado.

        Example:
            async with UnitOfWork(session) as uow:
                article = Article(title="Novo", project_id=project_id)
                created = await uow.articles.create(article)
                # created.id is available after flush()
                await uow.commit()  # Persiste in the banco
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

    async def create_from_dict(self, data: dict[str, Any]) -> T:
        """
        Create entidade a partir de dicionario.

        Args:
            data: Dados for criar a entidade.

        Returns:
            Entidade criada.
        """
        obj = self.model(**data)
        return await self.create(obj)

    async def update(self, obj: T, data: dict[str, Any]) -> T:
        """
        Update entidade existente.

        NOTA: Faz flush() for sincronizar, mas NAO faz commit().
        Use UnitOfWork.commit() or session.commit() apos atualizar.

        Args:
            obj: Entidade a atualizar.
            data: Dados for atualizar (key=atributo, valor=novo valor).

        Returns:
            Entidade atualizada.

        Example:
            async with UnitOfWork(session) as uow:
                article = await uow.articles.get_by_id(id)
                updated = await uow.articles.update(article, {"title": "Novo"})
                await uow.commit()
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
        Remove entidade.

        NOTA: Faz flush() for sincronizar, mas NAO faz commit().
        Use UnitOfWork.commit() or session.commit() apos deletar.

        Args:
            obj: Entidade a remover.

        Example:
            async with UnitOfWork(session) as uow:
                article = await uow.articles.get_by_id(id)
                await uow.articles.delete(article)
                await uow.commit()
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

    async def delete_by_id(self, id: UUID | str) -> bool:
        """
        Remove entidade por ID.

        Args:
            id: entidade.

        Returns:
            True se removida, False se not found.
        """
        obj = await self.get_by_id(id)
        if obj:
            await self.delete(obj)
            return True
        return False

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

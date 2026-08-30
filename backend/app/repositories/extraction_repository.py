"""
Extraction Repository.

Extraction domain persistence layer.
"""

from time import perf_counter
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.logging import get_logger
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionInstance,
    ExtractionRun,
    ExtractionTemplateGlobal,
    ProjectExtractionTemplate,
)
from app.repositories.base import BaseRepository

logger = get_logger(__name__)


class ExtractionTemplateRepository(BaseRepository[ProjectExtractionTemplate]):
    """Repository for project extraction templates."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ProjectExtractionTemplate)

    async def get_with_entity_types(
        self,
        template_id: UUID | str,
    ) -> ProjectExtractionTemplate | None:
        """
        Fetch template with entity types loaded.

        Args:
            template_id: Template ID.

        Returns:
            Template with entity types or None.
        """
        if isinstance(template_id, str):
            template_id = UUID(template_id)

        query_start = perf_counter()
        result = await self.db.execute(
            select(ProjectExtractionTemplate)
            .options(selectinload(ProjectExtractionTemplate.entity_types))
            .where(ProjectExtractionTemplate.id == template_id)
        )
        logger.debug(
            "repository_query_db_latency",
            repository=self.__class__.__name__,
            operation="get_with_entity_types",
            db_duration_ms=(perf_counter() - query_start) * 1000,
        )
        return result.scalar_one_or_none()


class GlobalTemplateRepository(BaseRepository[ExtractionTemplateGlobal]):
    """Repository for global extraction templates."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ExtractionTemplateGlobal)


class ExtractionEntityTypeRepository(BaseRepository[ExtractionEntityType]):
    """Repository for extraction entity types."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ExtractionEntityType)

    async def get_with_fields(
        self,
        entity_type_id: UUID | str,
    ) -> ExtractionEntityType | None:
        """
        Fetch entity type with fields loaded.

        Args:
            entity_type_id: Entity type ID.

        Returns:
            Entity type with fields or None.
        """
        if isinstance(entity_type_id, str):
            entity_type_id = UUID(entity_type_id)

        query_start = perf_counter()
        result = await self.db.execute(
            select(ExtractionEntityType)
            .options(selectinload(ExtractionEntityType.fields))
            .where(ExtractionEntityType.id == entity_type_id)
        )
        logger.debug(
            "repository_query_db_latency",
            repository=self.__class__.__name__,
            operation="get_with_fields",
            db_duration_ms=(perf_counter() - query_start) * 1000,
        )
        return result.scalar_one_or_none()

    async def get_by_role(
        self,
        role: str,
        template_id: UUID | str,
        is_project_template: bool = True,
    ) -> ExtractionEntityType | None:
        """
        Fetch the single entity type for a given role within a template.

        The partial unique index from migration 0016
        (``uq_extraction_entity_types_one_container_per_*``) enforces at
        most one ``model_container`` per template, so this returns at
        most one row without needing a defensive ``LIMIT 1``. Returns
        ``None`` when the template has no entity type with the given
        role (e.g. QA templates have no ``model_container``).

        Args:
            role: ``ExtractionEntityRole`` value (e.g.
                ``'model_container'``).
            template_id: Template ID (global or project, per the flag).
            is_project_template: ``True`` for project clones (default);
                ``False`` for the global catalogue.
        """
        if isinstance(template_id, str):
            template_id = UUID(template_id)

        query = select(ExtractionEntityType).where(ExtractionEntityType.role == role)
        if is_project_template:
            query = query.where(ExtractionEntityType.project_template_id == template_id)
        else:
            query = query.where(ExtractionEntityType.template_id == template_id)

        query_start = perf_counter()
        result = await self.db.execute(query)
        logger.debug(
            "repository_query_db_latency",
            repository=self.__class__.__name__,
            operation="get_by_role",
            db_duration_ms=(perf_counter() - query_start) * 1000,
        )
        return result.scalar_one_or_none()

    async def get_children(
        self,
        parent_entity_type_id: UUID | str,
        cardinality: str | None = None,
    ) -> list[ExtractionEntityType]:
        """
        Fetch child entity types with eager loading of fields.

        Args:
            parent_entity_type_id: Parent entity type ID.
            cardinality: Optional cardinality filter.

        Returns:
            List of child entity types with fields preloaded.
        """
        if isinstance(parent_entity_type_id, str):
            parent_entity_type_id = UUID(parent_entity_type_id)

        query = (
            select(ExtractionEntityType)
            .where(ExtractionEntityType.parent_entity_type_id == parent_entity_type_id)
            .options(selectinload(ExtractionEntityType.fields))  # Eager load fields
        )

        if cardinality:
            query = query.where(ExtractionEntityType.cardinality == cardinality)

        query = query.order_by(ExtractionEntityType.sort_order)

        query_start = perf_counter()
        result = await self.db.execute(query)
        logger.debug(
            "repository_query_db_latency",
            repository=self.__class__.__name__,
            operation="get_children",
            db_duration_ms=(perf_counter() - query_start) * 1000,
        )
        return list(result.scalars().all())


class ExtractionInstanceRepository(BaseRepository[ExtractionInstance]):
    """Repository for extraction instances."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ExtractionInstance)

    async def get_by_article(
        self,
        article_id: UUID | str,
        entity_type_id: UUID | str | None = None,
    ) -> list[ExtractionInstance]:
        """
        List extraction instances for an article.

        Args:
            article_id: Article ID.
            entity_type_id: Optional entity type filter.

        Returns:
            Instance list.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)

        query = select(ExtractionInstance).where(ExtractionInstance.article_id == article_id)

        if entity_type_id:
            if isinstance(entity_type_id, str):
                entity_type_id = UUID(entity_type_id)
            query = query.where(ExtractionInstance.entity_type_id == entity_type_id)

        query = query.order_by(ExtractionInstance.sort_order)

        query_start = perf_counter()
        result = await self.db.execute(query)
        logger.debug(
            "repository_query_db_latency",
            repository=self.__class__.__name__,
            operation="get_by_article",
            db_duration_ms=(perf_counter() - query_start) * 1000,
        )
        return list(result.scalars().all())

    async def get_in_coordinate(
        self,
        instance_id: UUID | str,
        *,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
    ) -> ExtractionInstance | None:
        """Fetch an instance only when it sits on the given coordinate.

        The BOLA guard for a client-supplied ``parent_instance_id``. The
        scope is IN the query rather than a comparison after a bare
        ``get_by_id``, so a caller cannot forget it: a foreign row returns
        ``None``, exactly like a missing one, and existence never leaks.

        Args:
            instance_id: Instance ID.
            project_id: Project the instance must belong to.
            article_id: Article the instance must belong to.
            template_id: Project template the instance must belong to.

        Returns:
            The instance, or None when it is missing or out of scope.
        """
        if isinstance(instance_id, str):
            instance_id = UUID(instance_id)

        query_start = perf_counter()
        result = await self.db.execute(
            select(ExtractionInstance).where(
                ExtractionInstance.id == instance_id,
                ExtractionInstance.project_id == project_id,
                ExtractionInstance.article_id == article_id,
                ExtractionInstance.template_id == template_id,
            )
        )
        logger.debug(
            "repository_query_db_latency",
            repository=self.__class__.__name__,
            operation="get_in_coordinate",
            db_duration_ms=(perf_counter() - query_start) * 1000,
        )
        return result.scalar_one_or_none()

    async def get_on_run(
        self,
        instance_id: UUID | str,
        run: ExtractionRun,
    ) -> ExtractionInstance | None:
        """The same guard, keyed by the run whose coordinate it must sit on.

        A run already carries a project-bound article and template, so
        passing it whole makes a mismatched trio unrepresentable at the call
        site — the shape every in-run caller wants.
        """
        return await self.get_in_coordinate(
            instance_id,
            project_id=run.project_id,
            article_id=run.article_id,
            template_id=run.template_id,
        )

    async def get_children(
        self,
        parent_instance_id: UUID | str,
    ) -> list[ExtractionInstance]:
        """
        List child instances.

        Args:
            parent_instance_id: Parent instance ID.

        Returns:
            Child instance list.
        """
        if isinstance(parent_instance_id, str):
            parent_instance_id = UUID(parent_instance_id)

        query_start = perf_counter()
        result = await self.db.execute(
            select(ExtractionInstance)
            .where(ExtractionInstance.parent_instance_id == parent_instance_id)
            .order_by(ExtractionInstance.sort_order)
        )
        logger.debug(
            "repository_query_db_latency",
            repository=self.__class__.__name__,
            operation="get_children",
            db_duration_ms=(perf_counter() - query_start) * 1000,
        )
        return list(result.scalars().all())

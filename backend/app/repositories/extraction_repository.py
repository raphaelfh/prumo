"""
Extraction Repository.

Extraction domain persistence layer.
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.extraction import (
    AISuggestion,
    ExtractionEntityType,
    ExtractionInstance,
    ExtractionTemplateGlobal,
    ProjectExtractionTemplate,
)
from app.repositories.base import BaseRepository


class ExtractionTemplateRepository(BaseRepository[ProjectExtractionTemplate]):
    """Repository for project extraction templates."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ProjectExtractionTemplate)

    async def get_by_project(
        self,
        project_id: UUID | str,
    ) -> list[ProjectExtractionTemplate]:
        """
        List templates for a project.

        Args:
            project_id: Project ID.

        Returns:
            Template list.
        """
        if isinstance(project_id, str):
            project_id = UUID(project_id)

        result = await self.db.execute(
            select(ProjectExtractionTemplate).where(
                ProjectExtractionTemplate.project_id == project_id
            )
        )
        return list(result.scalars().all())

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

        result = await self.db.execute(
            select(ProjectExtractionTemplate)
            .options(selectinload(ProjectExtractionTemplate.entity_types))
            .where(ProjectExtractionTemplate.id == template_id)
        )
        return result.scalar_one_or_none()


class GlobalTemplateRepository(BaseRepository[ExtractionTemplateGlobal]):
    """Repository for global extraction templates."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ExtractionTemplateGlobal)

    async def get_active(self) -> list[ExtractionTemplateGlobal]:
        """
        List active global templates.

        Returns:
            Active template list.
        """
        result = await self.db.execute(
            select(ExtractionTemplateGlobal).where(ExtractionTemplateGlobal.is_active.is_(True))
        )
        return list(result.scalars().all())


class ExtractionEntityTypeRepository(BaseRepository[ExtractionEntityType]):
    """Repository for extraction entity types."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ExtractionEntityType)

    async def get_by_template(
        self,
        template_id: UUID | str,
        is_project_template: bool = True,
    ) -> list[ExtractionEntityType]:
        """
        List entity types for a template.

        Args:
            template_id: Template ID.
            is_project_template: Whether template is project-scoped.

        Returns:
            Entity type list.
        """
        if isinstance(template_id, str):
            template_id = UUID(template_id)

        if is_project_template:
            query = select(ExtractionEntityType).where(
                ExtractionEntityType.project_template_id == template_id
            )
        else:
            query = select(ExtractionEntityType).where(
                ExtractionEntityType.template_id == template_id
            )

        query = query.order_by(ExtractionEntityType.sort_order)

        result = await self.db.execute(query)
        return list(result.scalars().all())

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

        result = await self.db.execute(
            select(ExtractionEntityType)
            .options(selectinload(ExtractionEntityType.fields))
            .where(ExtractionEntityType.id == entity_type_id)
        )
        return result.scalar_one_or_none()

    async def get_by_name(
        self,
        name: str,
        template_id: UUID | str,
        is_project_template: bool = True,
    ) -> ExtractionEntityType | None:
        """
        Fetch entity type by name inside a template.

        Args:
            name: Entity type name.
            template_id: Template ID.
            is_project_template: Whether template is project-scoped.

        Returns:
            Entity type or None.
        """
        if isinstance(template_id, str):
            template_id = UUID(template_id)

        query = select(ExtractionEntityType).where(ExtractionEntityType.name == name)

        if is_project_template:
            query = query.where(ExtractionEntityType.project_template_id == template_id)
        else:
            query = query.where(ExtractionEntityType.template_id == template_id)

        result = await self.db.execute(query.limit(1))
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

        result = await self.db.execute(query)
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

        result = await self.db.execute(query)
        return list(result.scalars().all())

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

        result = await self.db.execute(
            select(ExtractionInstance)
            .where(ExtractionInstance.parent_instance_id == parent_instance_id)
            .order_by(ExtractionInstance.sort_order)
        )
        return list(result.scalars().all())

    async def get_with_values(
        self,
        instance_id: UUID | str,
    ) -> ExtractionInstance | None:
        """
        Fetch instance with extracted values loaded.

        Args:
            instance_id: Instance ID.

        Returns:
            Instance with values or None.
        """
        if isinstance(instance_id, str):
            instance_id = UUID(instance_id)

        result = await self.db.execute(
            select(ExtractionInstance)
            .options(selectinload(ExtractionInstance.values))
            .where(ExtractionInstance.id == instance_id)
        )
        return result.scalar_one_or_none()


class AISuggestionRepository(BaseRepository[AISuggestion]):
    """Repository for AI suggestions."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, AISuggestion)

    async def get_by_instance(
        self,
        instance_id: UUID | str,
        status: str | None = None,
    ) -> list[AISuggestion]:
        """
        List suggestions for an instance.

        Args:
            instance_id: Instance ID.
            status: Optional status filter.

        Returns:
            Suggestion list.
        """
        if isinstance(instance_id, str):
            instance_id = UUID(instance_id)

        query = select(AISuggestion).where(AISuggestion.instance_id == instance_id)

        if status:
            query = query.where(AISuggestion.status == status)

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_pending_by_article(
        self,
        article_id: UUID | str,
    ) -> list[AISuggestion]:
        """
        List pending suggestions for an article.

        Args:
            article_id: Article ID.

        Returns:
            Pending suggestion list.
        """
        if isinstance(article_id, str):
            article_id = UUID(article_id)

        result = await self.db.execute(
            select(AISuggestion)
            .join(ExtractionInstance)
            .where(ExtractionInstance.article_id == article_id)
            .where(AISuggestion.status == "pending")
        )
        return list(result.scalars().all())

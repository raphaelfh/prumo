"""Clone a global extraction or quality-assessment template into a project."""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
    ProjectExtractionTemplate,
    TemplateKind,
)
from app.models.extraction_versioning import ExtractionTemplateVersion


class TemplateNotFoundError(Exception):
    """The supplied global template id does not exist or has the wrong kind."""


class TemplateClone:
    """Result envelope returned by ``TemplateCloneService.clone``."""

    def __init__(
        self,
        *,
        project_template_id: UUID,
        version_id: UUID,
        entity_type_count: int,
        field_count: int,
        created: bool,
    ) -> None:
        self.project_template_id = project_template_id
        self.version_id = version_id
        self.entity_type_count = entity_type_count
        self.field_count = field_count
        self.created = created


class TemplateCloneService:
    """Clone a global template (CHARMS / PROBAST / QUADAS-2 / ...) into a project.

    Kind-agnostic: pass ``kind`` to require a specific lineage at the global
    level. Idempotent on ``(project_id, global_template_id)``: a second call
    returns the existing clone instead of creating duplicates. Wraps the work
    in a single flush so partial failures don't leave half-cloned state.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def clone(
        self,
        *,
        project_id: UUID,
        global_template_id: UUID,
        user_id: UUID,
        kind: TemplateKind,
    ) -> TemplateClone:
        global_tpl = await self.db.get(ExtractionTemplateGlobal, global_template_id)
        if global_tpl is None:
            raise TemplateNotFoundError(f"Global template {global_template_id} not found")
        if global_tpl.kind != kind.value:
            raise TemplateNotFoundError(
                f"Template {global_template_id} has kind={global_tpl.kind}, expected {kind.value}"
            )

        existing = await self._find_existing_clone(project_id, global_template_id)
        if existing is not None:
            entity_types = await self._count_entity_types(existing.id)
            fields = await self._count_fields(existing.id)
            version = await self._active_version(existing.id)
            # The deferred constraint trigger
            # ``project_extraction_templates_active_version`` (migration
            # 0004) makes a template-without-active-version state
            # unrepresentable — every transaction that creates one must
            # also create an active version row by COMMIT, or the whole
            # transaction aborts. So this lookup is a hard guarantee,
            # not a defensive check.
            assert version is not None, (
                f"Active-version invariant violated for project_extraction_template "
                f"{existing.id}; the DB trigger should have prevented this."
            )
            return TemplateClone(
                project_template_id=existing.id,
                version_id=version.id,
                entity_type_count=entity_types,
                field_count=fields,
                created=False,
            )

        project_tpl = ProjectExtractionTemplate(
            project_id=project_id,
            global_template_id=global_template_id,
            name=global_tpl.name,
            description=global_tpl.description,
            framework=global_tpl.framework,
            version=global_tpl.version,
            kind=global_tpl.kind,
            schema_=global_tpl.schema_ or {},
            is_active=True,
            created_by=user_id,
        )
        self.db.add(project_tpl)
        await self.db.flush()

        entity_type_id_map: dict[UUID, UUID] = {}
        global_entity_types = await self._global_entity_types(global_template_id)
        for et in global_entity_types:
            new_id = uuid4()
            entity_type_id_map[et.id] = new_id
            self.db.add(
                ExtractionEntityType(
                    id=new_id,
                    project_template_id=project_tpl.id,
                    template_id=None,
                    name=et.name,
                    label=et.label,
                    description=et.description,
                    parent_entity_type_id=(
                        entity_type_id_map[et.parent_entity_type_id]
                        if et.parent_entity_type_id is not None
                        else None
                    ),
                    cardinality=et.cardinality,
                    sort_order=et.sort_order,
                    is_required=et.is_required,
                )
            )
        await self.db.flush()

        field_count = 0
        for et in global_entity_types:
            for f in await self._global_fields(et.id):
                self.db.add(
                    ExtractionField(
                        entity_type_id=entity_type_id_map[et.id],
                        name=f.name,
                        label=f.label,
                        description=f.description,
                        field_type=f.field_type,
                        is_required=f.is_required,
                        validation_schema=f.validation_schema,
                        allowed_values=f.allowed_values,
                        unit=f.unit,
                        allowed_units=f.allowed_units,
                        llm_description=f.llm_description,
                        sort_order=f.sort_order,
                        allow_other=f.allow_other,
                        other_label=f.other_label,
                        other_placeholder=f.other_placeholder,
                    )
                )
                field_count += 1
        await self.db.flush()

        version = ExtractionTemplateVersion(
            project_template_id=project_tpl.id,
            version=1,
            schema_=await self._snapshot(project_tpl.id),
            published_at=datetime.now(UTC),
            published_by=user_id,
            is_active=True,
        )
        self.db.add(version)
        await self.db.flush()

        return TemplateClone(
            project_template_id=project_tpl.id,
            version_id=version.id,
            entity_type_count=len(global_entity_types),
            field_count=field_count,
            created=True,
        )

    async def _find_existing_clone(
        self,
        project_id: UUID,
        global_template_id: UUID,
    ) -> ProjectExtractionTemplate | None:
        stmt = select(ProjectExtractionTemplate).where(
            ProjectExtractionTemplate.project_id == project_id,
            ProjectExtractionTemplate.global_template_id == global_template_id,
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def _global_entity_types(self, global_template_id: UUID) -> list[ExtractionEntityType]:
        stmt = (
            select(ExtractionEntityType)
            .where(ExtractionEntityType.template_id == global_template_id)
            .order_by(ExtractionEntityType.sort_order)
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def _global_fields(self, entity_type_id: UUID) -> list[ExtractionField]:
        stmt = (
            select(ExtractionField)
            .where(ExtractionField.entity_type_id == entity_type_id)
            .order_by(ExtractionField.sort_order)
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def _count_entity_types(self, project_template_id: UUID) -> int:
        stmt = select(ExtractionEntityType).where(
            ExtractionEntityType.project_template_id == project_template_id
        )
        return len((await self.db.execute(stmt)).scalars().all())

    async def _count_fields(self, project_template_id: UUID) -> int:
        stmt = (
            select(ExtractionField)
            .join(
                ExtractionEntityType,
                ExtractionEntityType.id == ExtractionField.entity_type_id,
            )
            .where(ExtractionEntityType.project_template_id == project_template_id)
        )
        return len((await self.db.execute(stmt)).scalars().all())

    async def _active_version(self, project_template_id: UUID) -> ExtractionTemplateVersion | None:
        stmt = select(ExtractionTemplateVersion).where(
            ExtractionTemplateVersion.project_template_id == project_template_id,
            ExtractionTemplateVersion.is_active.is_(True),
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def _snapshot(self, project_template_id: UUID) -> dict:
        from sqlalchemy import text

        result = await self.db.execute(
            text(
                """
                SELECT jsonb_build_object(
                    'entity_types', COALESCE(
                        (
                            SELECT jsonb_agg(
                                jsonb_build_object(
                                    'id', et.id,
                                    'name', et.name,
                                    'label', et.label,
                                    'parent_entity_type_id', et.parent_entity_type_id,
                                    'cardinality', et.cardinality,
                                    'sort_order', et.sort_order,
                                    'is_required', et.is_required,
                                    'fields', COALESCE(
                                        (
                                            SELECT jsonb_agg(jsonb_build_object(
                                                'id', f.id,
                                                'name', f.name,
                                                'label', f.label,
                                                'field_type', f.field_type,
                                                'is_required', f.is_required,
                                                'allowed_values', f.allowed_values,
                                                'sort_order', f.sort_order
                                            ) ORDER BY f.sort_order)
                                            FROM public.extraction_fields f
                                            WHERE f.entity_type_id = et.id
                                        ),
                                        '[]'::jsonb
                                    )
                                ) ORDER BY et.sort_order
                            )
                            FROM public.extraction_entity_types et
                            WHERE et.project_template_id = :tid
                        ),
                        '[]'::jsonb
                    )
                )
                """
            ),
            {"tid": str(project_template_id)},
        )
        return result.scalar_one()

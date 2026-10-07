"""Clone a global extraction or quality-assessment template into a project."""

from collections import deque
from uuid import UUID, uuid4

from sqlalchemy import inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import Base
from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
    ProjectExtractionTemplate,
    TemplateKind,
)
from app.services.project_template_active_service import (
    deactivate_sibling_extraction_templates,
    flush_activation,
)


class TemplateNotFoundError(Exception):
    """The supplied global template id does not exist or has the wrong kind."""


def _copied_columns(model: type[Base], exclude: frozenset[str]) -> frozenset[str]:
    """Every mapped column of ``model`` except ``exclude``.

    Derived rather than listed, so a column added to the model travels into
    the project copy by default. A hand-written list drops each new column in
    silence (it did, twice: the ADR-0016 dispositions, then ``is_entity_key``);
    a missing exclusion copies a value onto a row that accepts it, which is
    rarer and louder. A stale exclusion name fails here, at import.
    """
    keys = frozenset(attr.key for attr in inspect(model).column_attrs)
    stale = exclude - keys
    if stale:
        raise ValueError(f"{model.__name__} has no columns {sorted(stale)}")
    return keys - exclude


#: What a clone must NOT copy: the row's own identity, the links it re-points
#: at its own rows, and the timestamps the new row mints for itself.
UNCLONED_ENTITY_TYPE_COLUMNS: frozenset[str] = frozenset(
    {
        "id",
        "template_id",
        "project_template_id",
        "parent_entity_type_id",
        "created_at",
        "updated_at",
    }
)
UNCLONED_FIELD_COLUMNS: frozenset[str] = frozenset(
    {"id", "entity_type_id", "created_at", "updated_at"}
)
CLONED_ENTITY_TYPE_COLUMNS = _copied_columns(ExtractionEntityType, UNCLONED_ENTITY_TYPE_COLUMNS)
CLONED_FIELD_COLUMNS = _copied_columns(ExtractionField, UNCLONED_FIELD_COLUMNS)


class TemplateCloneService:
    """Materialize a global template's structure (CHARMS / PROBAST / QUADAS-2 / ...)
    under a project template.

    Structure only — rows in ``project_extraction_templates``,
    ``extraction_entity_types`` and ``extraction_fields``. It never publishes:
    deciding whether a clone, a re-import or a heal becomes a new active
    version is ``template_versioning.clone_template``'s job, and the deferred
    constraint trigger (migration 0004) makes an unpublished fresh row a
    commit-time error, so nothing but that orchestration calls
    :meth:`create_from_global`.
    """

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def global_template(
        self, global_template_id: UUID, *, kind: TemplateKind
    ) -> ExtractionTemplateGlobal:
        """The global template to clone from, or ``TemplateNotFoundError``.

        One error for a missing id and a kind mismatch alike: the caller asked
        for a lineage, and a template of another kind is not it.
        """
        global_tpl = await self.db.get(ExtractionTemplateGlobal, global_template_id)
        if global_tpl is None:
            raise TemplateNotFoundError(f"Global template {global_template_id} not found")
        if global_tpl.kind != kind.value:
            raise TemplateNotFoundError(
                f"Template {global_template_id} has kind={global_tpl.kind}, expected {kind.value}"
            )
        return global_tpl

    async def create_from_global(
        self,
        *,
        project_id: UUID,
        global_tpl: ExtractionTemplateGlobal,
        user_id: UUID,
        kind: TemplateKind,
    ) -> tuple[ProjectExtractionTemplate, int, int]:
        """Insert a fresh project template row and its live structure.

        Returns the row and the (entity type, field) counts inserted. The row
        has no active version until the caller publishes it.
        """
        # Single-active invariant for extraction templates: deactivate every
        # currently-active extraction template in the project *before*
        # inserting the new one. The partial unique index
        # ``uq_one_active_extraction_template_per_project`` is enforced on
        # the same flush as the INSERT, so the cleanup must land first or
        # the INSERT trips the index. QA templates coexist (PROBAST +
        # QUADAS-2) and are not affected — kind discriminator on the index
        # keeps QA out of scope.
        if kind == TemplateKind.EXTRACTION:
            await deactivate_sibling_extraction_templates(
                self.db, project_id=project_id, keep_active_id=None
            )
            await self.db.flush()

        project_tpl = ProjectExtractionTemplate(
            project_id=project_id,
            global_template_id=global_tpl.id,
            name=global_tpl.name,
            description=global_tpl.description,
            framework=global_tpl.framework,
            version=global_tpl.version,
            kind=global_tpl.kind,
            schema_=dict(global_tpl.schema_ or {}),
            llm_template_instruction=global_tpl.llm_template_instruction,
            is_active=True,
            created_by=user_id,
        )
        self.db.add(project_tpl)
        await flush_activation(self.db)

        entity_type_count, field_count = await self.rebuild_from_global(
            project_template_id=project_tpl.id, global_template_id=global_tpl.id
        )
        return project_tpl, entity_type_count, field_count

    async def rebuild_from_global(
        self, *, project_template_id: UUID, global_template_id: UUID
    ) -> tuple[int, int]:
        """Copy the global structure under ``project_template_id``.

        Returns the (entity type, field) counts inserted. Every live-row
        insert stamps the draft marker (0048), so a caller that must refuse
        on a pending draft checks BEFORE calling this.
        """
        global_entity_types = await self._global_entity_types(global_template_id)
        field_count = await self._insert_project_structure_from_global(
            project_template_id=project_template_id,
            global_entity_types=global_entity_types,
        )
        return len(global_entity_types), field_count

    async def reactivate(
        self,
        existing: ProjectExtractionTemplate,
        *,
        global_tpl: ExtractionTemplateGlobal,
        kind: TemplateKind,
    ) -> None:
        """A re-import of an existing clone: resync its rules and activate it."""
        # Re-import refreshes the template-level ``schema_`` from the
        # global. That column holds declarative RULES which READ the
        # structure (``derived_judgments``, ``scope_rules``) — never the
        # structure itself, which lives in the entity-type/field rows and
        # in the version snapshot. So it can be re-synced without
        # touching the live rows the heal deliberately preserves, and
        # clone creation is otherwise its only writer, so there is no
        # project customization to clobber.
        existing.schema_ = dict(global_tpl.schema_ or {})
        # Re-importing a template re-activates it (user intent: "use
        # this template now"). For extraction kind, also enforce the
        # single-active invariant by deactivating siblings *before*
        # touching ``existing.is_active`` — the partial unique index
        # ``uq_one_active_extraction_template_per_project`` is checked
        # eagerly on every flush, so we must clear the field first.
        if kind == TemplateKind.EXTRACTION:
            await deactivate_sibling_extraction_templates(
                self.db, project_id=existing.project_id, keep_active_id=existing.id
            )
            await self.db.flush()
        if not existing.is_active:
            existing.is_active = True
        await flush_activation(self.db)

    async def resolve_existing_clone(
        self,
        project_id: UUID,
        global_template_id: UUID,
    ) -> ProjectExtractionTemplate | None:
        """The existing clone row, AS-IS — no heal, no publish, no
        activation. ``clone_template`` decides what to do with it;
        session-open falls back to this when the drift heal refuses on a
        pending draft (B-4: the marker must never gate reviewers)."""
        stmt = select(ProjectExtractionTemplate).where(
            ProjectExtractionTemplate.project_id == project_id,
            ProjectExtractionTemplate.global_template_id == global_template_id,
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def structure_counts(
        self,
        project_template_id: UUID,
    ) -> tuple[int, int]:
        """Entity-type and field counts for a project template in a single DB round trip."""
        row = (
            await self.db.execute(
                text(
                    """
                    SELECT
                        (
                            SELECT COUNT(*)::bigint
                            FROM public.extraction_entity_types et
                            WHERE et.project_template_id = CAST(:tid AS uuid)
                        ) AS entity_type_count,
                        (
                            SELECT COUNT(*)::bigint
                            FROM public.extraction_fields f
                            INNER JOIN public.extraction_entity_types et
                                ON et.id = f.entity_type_id
                            WHERE et.project_template_id = CAST(:tid AS uuid)
                        ) AS field_count
                    """
                ),
                {"tid": str(project_template_id)},
            )
        ).one()
        return int(row[0]), int(row[1])

    @staticmethod
    def topologically_sorted(
        entity_types: list[ExtractionEntityType],
    ) -> list[ExtractionEntityType]:
        """Return ``entity_types`` ordered so every parent precedes its children.

        Kahn's algorithm; treats rows whose ``parent_entity_type_id`` falls
        outside the supplied list as roots (defensive — the caller always
        passes a complete template tree). Raises ``ValueError`` if a cycle
        is detected, which would indicate a corrupt template (the model has
        no cycle-prevention check; this surfaces it loudly instead of
        looping or producing partial output).

        Replaces the previous implicit assumption that the caller's
        ``ORDER BY sort_order`` already happened to place parents first —
        a fragile contract that forced the CHARMS seed to use globally
        unique sort orders even where local-per-parent orders would have
        read better.
        """
        ids_in_scope = {et.id for et in entity_types}
        children_of: dict[UUID | None, list[ExtractionEntityType]] = {}
        for et in entity_types:
            effective_parent = (
                et.parent_entity_type_id if et.parent_entity_type_id in ids_in_scope else None
            )
            children_of.setdefault(effective_parent, []).append(et)
        for bucket in children_of.values():
            bucket.sort(key=lambda x: x.sort_order)

        ordered: list[ExtractionEntityType] = []
        queue: deque[ExtractionEntityType] = deque(children_of.get(None, []))
        while queue:
            current = queue.popleft()
            ordered.append(current)
            queue.extend(children_of.get(current.id, []))

        if len(ordered) != len(entity_types):
            missing = {et.id for et in entity_types} - {et.id for et in ordered}
            raise ValueError(
                f"Cycle or unreachable parent in template tree; "
                f"could not order entity_types: {missing}"
            )
        return ordered

    async def _insert_project_structure_from_global(
        self,
        *,
        project_template_id: UUID,
        global_entity_types: list[ExtractionEntityType],
    ) -> int:
        """Copy global entity types and fields into a project template (one field read batch)."""
        # Topologically sort so every parent is inserted before its children.
        # The caller loads rows ordered by ``sort_order`` (display order),
        # which is *not* the same as topological order — this layer owns the
        # invariant instead of depending on the seed to honour it.
        ordered_entity_types = self.topologically_sorted(global_entity_types)

        entity_type_id_map: dict[UUID, UUID] = {}
        for et in ordered_entity_types:
            new_id = uuid4()
            entity_type_id_map[et.id] = new_id
            self.db.add(
                ExtractionEntityType(
                    id=new_id,
                    project_template_id=project_template_id,
                    template_id=None,
                    parent_entity_type_id=(
                        entity_type_id_map[et.parent_entity_type_id]
                        if et.parent_entity_type_id is not None
                        else None
                    ),
                    **{c: getattr(et, c) for c in CLONED_ENTITY_TYPE_COLUMNS},
                )
            )
        await self.db.flush()

        fields_by_entity = await self._global_fields_by_entity_types(
            list(entity_type_id_map.keys()),
        )
        field_count = 0
        for et in global_entity_types:
            for f in fields_by_entity.get(et.id, ()):
                self.db.add(
                    ExtractionField(
                        entity_type_id=entity_type_id_map[et.id],
                        **{c: getattr(f, c) for c in CLONED_FIELD_COLUMNS},
                    )
                )
                field_count += 1
        await self.db.flush()
        return field_count

    async def _global_entity_types(self, global_template_id: UUID) -> list[ExtractionEntityType]:
        stmt = (
            select(ExtractionEntityType)
            .where(ExtractionEntityType.template_id == global_template_id)
            .order_by(ExtractionEntityType.sort_order)
        )
        return list((await self.db.execute(stmt)).scalars().all())

    async def _global_fields_by_entity_types(
        self,
        global_entity_type_ids: list[UUID],
    ) -> dict[UUID, list[ExtractionField]]:
        """Load all global fields for the given entity types in one round trip (no N+1)."""
        if not global_entity_type_ids:
            return {}
        stmt = (
            select(ExtractionField)
            .where(ExtractionField.entity_type_id.in_(global_entity_type_ids))
            .order_by(ExtractionField.entity_type_id, ExtractionField.sort_order)
        )
        rows = list((await self.db.execute(stmt)).scalars().all())
        buckets: dict[UUID, list[ExtractionField]] = {eid: [] for eid in global_entity_type_ids}
        for f in rows:
            buckets[f.entity_type_id].append(f)
        return buckets

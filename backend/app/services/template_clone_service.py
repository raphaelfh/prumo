"""Clone a global extraction or quality-assessment template into a project."""

from collections import deque
from uuid import UUID, uuid4

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityType,
    ExtractionField,
    ExtractionTemplateGlobal,
    ProjectExtractionTemplate,
    TemplateKind,
)
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.services.project_template_active_service import (
    deactivate_sibling_extraction_templates,
    flush_activation,
)


class TemplateNotFoundError(Exception):
    """The supplied global template id does not exist or has the wrong kind."""


class PendingConfigDraftError(Exception):
    """Publish-adjacent operation refused: unpublished config edits.

    Raised only where the operation would silently PUBLISH a pending
    draft (the drift heal). Zero-state rebuilds regardless of marker
    (documented factory recovery); the aligned path publishes nothing.
    Defined here (not in template_version_service) because that module
    already imports from this one — this direction adds no new cycle.
    """

    def __init__(
        self,
        msg: str = (
            "Template has unpublished configuration changes. Publish them before re-importing."
        ),
    ) -> None:
        super().__init__(msg)


def _snapshot_structure_counts(version: ExtractionTemplateVersion) -> tuple[int, int]:
    """Entity-type and field counts recorded in a version snapshot."""
    entity_types = (version.schema_ or {}).get("entity_types", [])
    return len(entity_types), sum(len(et.get("fields", [])) for et in entity_types)


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
            entity_types, fields = await self._project_template_structure_counts(existing.id)
            version = await self._active_version(existing.id)
            # The deferred constraint trigger
            # ``project_extraction_templates_active_version`` (migration
            # 0004) makes a template-without-active-version state
            # unrepresentable, so this lookup is a hard guarantee.
            assert version is not None, (
                f"Active-version invariant violated for project_extraction_template "
                f"{existing.id}; the DB trigger should have prevented this."
            )
            snapshot_et, snapshot_field = _snapshot_structure_counts(version)
            # Heal existing clones. Drift is measured against the template's
            # ACTIVE SNAPSHOT, never against the global template — deliberate
            # config edits are republished as a new version
            # (``TemplateVersionService.republish``), so a healthy edited
            # template has live == snapshot. Two heal cases:
            #   1. Zero-state — the clone row exists but its live structure
            #      was never inserted (legacy data, aborted clone). Rebuild
            #      from the global template: an empty clone is unusable and
            #      factory state is strictly better. A legacy clone may carry
            #      an empty placeholder snapshot (live == snapshot == 0), so
            #      zero-state gets its own clause.
            #   2. Non-empty drift (live counts != snapshot counts) — publish
            #      the LIVE structure as a new version. Never wipe: with
            #      user-editable templates a count mismatch is
            #      indistinguishable from a deliberate edit whose republish
            #      call was lost, and the historical wipe-and-rebuild
            #      destroyed customizations (and 500'd on the RESTRICT FK
            #      whenever instances existed). Live is authoritative; true
            #      factory recovery is an explicit delete + re-import.
            zero_state = entity_types == 0 and fields == 0
            # Local import: template_version_service imports this module
            # (TemplateNotFoundError), so a top-level import would cycle.
            from app.services.template_version_service import (
                TemplateVersionService,
            )

            republished = None
            if zero_state:
                publisher = TemplateVersionService(self.db)
                # Locks BEFORE the rebuild: the rebuild's mark-draft trigger
                # stamps take the template-row lock, and taking republish's
                # advisory locks after that would invert the documented
                # order against session-open (ABBA).
                await publisher.acquire_publish_locks(existing.id)
                global_entity_types = await self._global_entity_types(global_template_id)
                field_count = await self._insert_project_structure_from_global(
                    project_template_id=existing.id,
                    global_entity_types=global_entity_types,
                )
                # Publish through the one publish path (B-4): a NEW active
                # version (append-only — never rewrite the placeholder in
                # place), draft marker cleared under the locks above.
                republished = await publisher.republish(
                    project_id=project_id,
                    project_template_id=existing.id,
                    user_id=user_id,
                )
                entity_types = len(global_entity_types)
                fields = field_count
            elif entity_types != snapshot_et or fields != snapshot_field:
                if existing.config_draft_since is not None:
                    # B-4: a marker-set drift is a PENDING DRAFT, and this
                    # heal would silently publish it. Fast-fail courtesy —
                    # the AUTHORITATIVE re-check runs under republish's
                    # locks (fail_if_pending_draft), so a stamp landing
                    # after this read still refuses. A marker-NULL drift
                    # is a lost republish and self-heals as before.
                    raise PendingConfigDraftError()
                republished = await TemplateVersionService(self.db).republish(
                    project_id=project_id,
                    project_template_id=existing.id,
                    user_id=user_id,
                    fail_if_pending_draft=True,
                )
            if republished is not None:
                version = await self.db.get(ExtractionTemplateVersion, republished.version_id)
                assert version is not None, (
                    f"Heal republish left project_extraction_template "
                    f"{existing.id} without an active version."
                )
            # Re-importing a template re-activates it (user intent: "use
            # this template now"). For extraction kind, also enforce the
            # single-active invariant by deactivating siblings *before*
            # touching ``existing.is_active`` — the partial unique index
            # ``uq_one_active_extraction_template_per_project`` is checked
            # eagerly on every flush, so we must clear the field first.
            if kind == TemplateKind.EXTRACTION:
                await deactivate_sibling_extraction_templates(
                    self.db, project_id=project_id, keep_active_id=existing.id
                )
                await self.db.flush()
            if not existing.is_active:
                existing.is_active = True
            await flush_activation(self.db)
            return TemplateClone(
                project_template_id=existing.id,
                version_id=version.id,
                entity_type_count=entity_types,
                field_count=fields,
                created=False,
            )

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
            global_template_id=global_template_id,
            name=global_tpl.name,
            description=global_tpl.description,
            framework=global_tpl.framework,
            version=global_tpl.version,
            kind=global_tpl.kind,
            schema_=global_tpl.schema_ or {},
            llm_template_instruction=global_tpl.llm_template_instruction,
            is_active=True,
            created_by=user_id,
        )
        self.db.add(project_tpl)
        await flush_activation(self.db)

        global_entity_types = await self._global_entity_types(global_template_id)
        field_count = await self._insert_project_structure_from_global(
            project_template_id=project_tpl.id,
            global_entity_types=global_entity_types,
        )

        # Publish v1 through the one publish path (B-4): republish
        # snapshots under its locks and clears the draft marker the
        # structure inserts above just stamped. A brand-new template has
        # no runs, so the advisory step is a no-op (no ABBA reachable).
        # Local import: template_version_service imports this module.
        from app.services.template_version_service import TemplateVersionService

        republished = await TemplateVersionService(self.db).republish(
            project_id=project_id,
            project_template_id=project_tpl.id,
            user_id=user_id,
        )

        return TemplateClone(
            project_template_id=project_tpl.id,
            version_id=republished.version_id,
            entity_type_count=len(global_entity_types),
            field_count=field_count,
            created=True,
        )

    @staticmethod
    def _topologically_sorted(
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
        ordered_entity_types = self._topologically_sorted(global_entity_types)

        entity_type_id_map: dict[UUID, UUID] = {}
        for et in ordered_entity_types:
            new_id = uuid4()
            entity_type_id_map[et.id] = new_id
            self.db.add(
                ExtractionEntityType(
                    id=new_id,
                    project_template_id=project_template_id,
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
                    role=et.role,
                    entry_label=et.entry_label,
                    sort_order=et.sort_order,
                    is_required=et.is_required,
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
                        # ADR-0016 opt-in dispositions travel with the field:
                        # the project clone is what the run-open form renders,
                        # so dropping them here silently removes the
                        # "Not applicable" affordance from every signaling
                        # question (and freezes that loss into the snapshot).
                        allows_not_applicable=f.allows_not_applicable,
                        allows_not_evaluated=f.allows_not_evaluated,
                        allows_no_information=f.allows_no_information,
                    )
                )
                field_count += 1
        await self.db.flush()
        return field_count

    async def resolve_existing_clone(
        self,
        project_id: UUID,
        global_template_id: UUID,
    ) -> ProjectExtractionTemplate | None:
        """The existing clone row, AS-IS — no heal, no publish, no
        activation. Session-open falls back to this when the drift heal
        refuses on a pending draft (B-4: the marker must never gate
        reviewers)."""
        return await self._find_existing_clone(project_id, global_template_id)

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

    async def _project_template_structure_counts(
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

    async def _active_version(self, project_template_id: UUID) -> ExtractionTemplateVersion | None:
        stmt = select(ExtractionTemplateVersion).where(
            ExtractionTemplateVersion.project_template_id == project_template_id,
            ExtractionTemplateVersion.is_active.is_(True),
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

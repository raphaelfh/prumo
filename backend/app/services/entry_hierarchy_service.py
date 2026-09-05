"""Create one entry of any repeating section, with its singleton children.

Replaces ``model_hierarchy_service``, which could only ever create the one
``model_container`` the ``role`` column allowed. Structure is read from
``parent_entity_type_id`` + ``cardinality``; nothing here is model-shaped.

Scope is bound before any write, through the guards that already exist —
this module adds none of its own (`.claude/rules/backend.md`
§ Ownership guards): ``owned_template`` (with the template's kind),
``owned_article``, ``owned_section`` and
``ExtractionInstanceRepository.get_in_coordinate``.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityType,
    ExtractionField,
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
)
from app.models.extraction_versioning import TemplateKind
from app.repositories.extraction_repository import ExtractionInstanceRepository
from app.schemas.extraction import EntryCreateResponse, ExtractionErrorCode
from app.services.article_read_service import ArticleNotFoundError, owned_article
from app.services.entity_key import match_or_none, stamp
from app.services.extraction_review_service import (
    ExtractionReviewService,
    InvalidDecisionError,
)
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    owned_template,
)
from app.services.template_section_service import SectionNotFoundError, owned_section


class EntryTargetNotFoundError(Exception):
    """The article, template, section or parent named is not on this coordinate.

    One error for missing and for foreign, 404-class, naming the row TYPE
    and never a column of the row that was not found.
    """


class InvalidEntryTargetError(ValueError):
    """The coordinate resolves but cannot hold this entry — 422.

    Covers the section not repeating (§7.2), the parent/root mismatch
    (§7.3), and a key supplied for a keyless section or omitted for a keyed
    one. These were three exception types in an earlier draft; the endpoint
    mapped all three to the same status with the same body, so the
    distinction lived entirely in the message string.
    """


class EntryKeyDuplicateError(AppError):
    """This coordinate already holds an entry with that identity (§7.4).

    The retired model path silently renamed the collision ("Cox Model (2)");
    a typed 409 lets the reviewer open the entry they already have instead
    of accumulating near-duplicates the AI can no longer tell apart.
    """

    def __init__(self, key_value: str) -> None:
        super().__init__(
            code=ExtractionErrorCode.ENTRY_KEY_DUPLICATE.value,
            message=(
                f"An entry with the key {key_value.strip()!r} already exists here. "
                "Open that entry instead, or give this one a different key."
            ),
            status_code=409,
        )


class EntryHierarchyService:
    """Creates an entry for any ``cardinality='many'`` section, at any depth."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def create_entry(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        entity_type_id: UUID,
        parent_instance_id: UUID | None,
        label: str,
        entity_key: str | None,
        user_id: UUID,
    ) -> EntryCreateResponse:
        entry_label = label.strip()
        if not entry_label:
            raise InvalidEntryTargetError("label is required")

        entity_type = await self._bind_coordinate(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            entity_type_id=entity_type_id,
        )
        if entity_type.cardinality != ExtractionCardinality.MANY.value:
            raise InvalidEntryTargetError(
                "Only a repeating section holds entries; a singleton materializes "
                "under its parent entry."
            )
        await self._bind_parent(
            entity_type=entity_type,
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            parent_instance_id=parent_instance_id,
        )

        key_field = await self._key_field(entity_type_id)
        key_value = (entity_key or "").strip()
        if key_field is not None and not key_value:
            raise InvalidEntryTargetError(
                "entityKey is required for a section that declares an entry key"
            )
        if key_field is None and key_value:
            raise InvalidEntryTargetError(
                "entityKey is not accepted for a section without an entry key"
            )
        if key_field is not None:
            duplicate = await match_or_none(
                self.db,
                article_id=article_id,
                entity_type_id=entity_type_id,
                key_value=key_value,
                parent_instance_id=parent_instance_id,
            )
            if duplicate is not None:
                raise EntryKeyDuplicateError(key_value)

        # The entry and its singleton children land in one transaction: the
        # caller commits, so a failure anywhere below leaves no half-built
        # entry for a reviewer to find.
        provenance: dict[str, Any] = {"created_via": "manual"}
        entry = ExtractionInstance(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            entity_type_id=entity_type_id,
            parent_instance_id=parent_instance_id,
            label=entry_label,
            sort_order=await self._next_sort_order(
                article_id=article_id,
                entity_type_id=entity_type_id,
                parent_instance_id=parent_instance_id,
            ),
            metadata_=stamp(provenance, key_value) if key_field is not None else dict(provenance),
            created_by=user_id,
        )
        self.db.add(entry)
        await self.db.flush()

        await self._materialize_singletons(
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
            parent_entity_type_id=entity_type_id,
            parent_instance_id=entry.id,
            parent_label=entry.label,
            user_id=user_id,
        )
        if key_field is not None:
            await self._record_key_decision(
                project_id=project_id,
                article_id=article_id,
                template_id=template_id,
                key_field_id=key_field.id,
                instance_id=entry.id,
                user_id=user_id,
                # entry.label, not the raw input: the append-only decision
                # value must match every visible surface.
                value=entry.label,
            )
        return EntryCreateResponse(instance_id=entry.id, label=entry.label)

    async def _bind_coordinate(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        entity_type_id: UUID,
    ) -> ExtractionEntityType:
        """Bind every client-supplied id to the caller's scope, before any write."""
        try:
            # ``kind`` is part of the bind: without it a quality-assessment
            # template accepts extraction entries, and the decision lookup
            # below — which filters runs to kind=extraction — records nothing,
            # so the rows land with no audit trail at all.
            await owned_template(
                self.db,
                project_id=project_id,
                template_id=template_id,
                kind=TemplateKind.EXTRACTION.value,
            )
        except ProjectTemplateNotFoundError as exc:
            raise EntryTargetNotFoundError("Template not found") from exc
        try:
            await owned_article(self.db, project_id=project_id, article_id=article_id)
        except ArticleNotFoundError as exc:
            raise EntryTargetNotFoundError("Article not found") from exc
        try:
            return await owned_section(self.db, template_id=template_id, section_id=entity_type_id)
        except SectionNotFoundError as exc:
            raise EntryTargetNotFoundError("Section not found") from exc

    async def _bind_parent(
        self,
        *,
        entity_type: ExtractionEntityType,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        parent_instance_id: UUID | None,
    ) -> None:
        if entity_type.parent_entity_type_id is None:
            if parent_instance_id is not None:
                raise InvalidEntryTargetError("A root group takes no parentInstanceId")
            return
        if parent_instance_id is None:
            raise InvalidEntryTargetError("A nested group requires parentInstanceId")
        parent = await ExtractionInstanceRepository(self.db).get_in_coordinate(
            parent_instance_id,
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
        )
        if parent is None:
            raise EntryTargetNotFoundError("Parent entry not found")
        if parent.entity_type_id != entity_type.parent_entity_type_id:
            raise InvalidEntryTargetError(
                "parentInstanceId is not an entry of this section's parent"
            )

    async def _key_field(self, entity_type_id: UUID) -> ExtractionField | None:
        """The section's entry-key field, read in SQL.

        NOT ``entity_type.fields``: that relationship is ``lazy="select"``
        and ``owned_section`` does not eager-load it, so touching it raises
        ``MissingGreenlet`` under ``AsyncSession`` — and a test whose clone
        put the field rows in the same session's identity map would never
        see it, because they resolve without a round trip.

        NOT ``entity_key.key_field_of`` either: that raises
        ``MissingEntityKeyError`` for a keyless repeating group, and manual
        creation must succeed for one (§3 invariant 6). One reader here
        serves both the arity check and the decision write.
        """
        return (
            (
                await self.db.execute(
                    select(ExtractionField).where(
                        ExtractionField.entity_type_id == entity_type_id,
                        ExtractionField.is_entity_key.is_(True),
                    )
                )
            )
            .scalars()
            .first()
        )

    async def _materialize_singletons(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        parent_entity_type_id: UUID,
        parent_instance_id: UUID,
        parent_label: str,
        user_id: UUID,
    ) -> None:
        """One instance per ``cardinality='one'`` child of the entry's section.

        Flat, not recursive: migration 0016's role CHECK and its parent
        trigger make a singleton's own children unrepresentable, so a
        recursive call would select zero rows every time and could not be
        tested. Trees B5 drops those constraints and adds the recursion —
        together with the depth bound the self-referential parent FK will
        then need.

        A nested GROUP gets no instance here: its entries are created by its
        own call to :meth:`create_entry` (§7.5).
        """
        stmt = (
            select(ExtractionEntityType)
            .where(
                ExtractionEntityType.parent_entity_type_id == parent_entity_type_id,
                ExtractionEntityType.cardinality == ExtractionCardinality.ONE.value,
            )
            .order_by(ExtractionEntityType.sort_order.asc())
        )
        for child_type in (await self.db.execute(stmt)).scalars().all():
            self.db.add(
                ExtractionInstance(
                    project_id=project_id,
                    article_id=article_id,
                    template_id=template_id,
                    entity_type_id=child_type.id,
                    parent_instance_id=parent_instance_id,
                    label=f"{parent_label} - {child_type.label}",
                    sort_order=0,
                    metadata_={"created_via": "manual"},
                    created_by=user_id,
                )
            )
        await self.db.flush()

    async def _next_sort_order(
        self, *, article_id: UUID, entity_type_id: UUID, parent_instance_id: UUID | None
    ) -> int:
        """One past the highest sibling.

        ``max + 1``, not ``count``: counting reuses an order after a delete,
        which silently ties two entries in every ``ORDER BY sort_order`` read.
        """
        stmt = select(func.coalesce(func.max(ExtractionInstance.sort_order), -1)).where(
            ExtractionInstance.article_id == article_id,
            ExtractionInstance.entity_type_id == entity_type_id,
            ExtractionInstance.parent_instance_id.is_(None)
            if parent_instance_id is None
            else ExtractionInstance.parent_instance_id == parent_instance_id,
        )
        return int((await self.db.execute(stmt)).scalar_one()) + 1

    async def _record_key_decision(
        self,
        *,
        project_id: UUID,
        article_id: UUID,
        template_id: UUID,
        key_field_id: UUID,
        instance_id: UUID,
        user_id: UUID,
        value: str,
    ) -> None:
        """Record the dialog's one value — the key — as the reviewer's decision.

        A human-entered extraction value must land as a per-user
        ReviewerDecision (blind-review write defense), not a shared proposal:
        the form's ``/decisions`` path does the same, and recording it as a
        proposal would leak this reviewer's value to peers through the
        shared proposal track.

        Silent when no live extract-stage run exists — the entry itself is
        created regardless, since the key is recorded so the form shows it
        prefilled, not because the entry depends on it.
        """
        run = (
            (
                await self.db.execute(
                    select(ExtractionRun)
                    .where(
                        ExtractionRun.project_id == project_id,
                        ExtractionRun.article_id == article_id,
                        ExtractionRun.template_id == template_id,
                        ExtractionRun.kind == TemplateKind.EXTRACTION.value,
                        ExtractionRun.stage == ExtractionRunStage.EXTRACT.value,
                    )
                    .order_by(ExtractionRun.created_at.desc())
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        if run is None:
            return
        try:
            await ExtractionReviewService(self.db).record_decision(
                run_id=run.id,
                instance_id=instance_id,
                field_id=key_field_id,
                reviewer_id=user_id,
                decision="edit",
                value={"value": value},
            )
        except InvalidDecisionError:
            # The run advanced out of extract between the lookup and the
            # write. The entry was created fine; losing the prefill must not
            # 500 the whole creation.
            return

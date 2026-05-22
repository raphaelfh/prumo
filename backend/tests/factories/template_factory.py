"""Builders for ``ExtractionEntityType`` + project_template fixtures.

Two entry points:

* :func:`make_entity_type` — create a single entity type with sensible
  defaults; the caller adds it to a session and commits. Honors the
  role/parent/cardinality coherence enforced by migration 0016.

* :class:`TemplateFactory` — wraps a ``project_extraction_template`` +
  its entity_types so tests that need a full template skeleton don't
  wire 4+ rows by hand.

Both surfaces go through SQLAlchemy ORM rather than raw SQL — that
exercises the CHECK constraint + deferred trigger from migration 0016
on every fixture insert, so misuse fails loud at test setup instead of
silently producing inconsistent rows that mask real bugs downstream.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import (
    ExtractionEntityRole,
    ExtractionEntityType,
    ProjectExtractionTemplate,
    TemplateKind,
)
from app.models.extraction_versioning import ExtractionTemplateVersion


def make_entity_type(
    *,
    project_template_id: UUID | None = None,
    template_id: UUID | None = None,
    name: str,
    label: str | None = None,
    cardinality: Literal["one", "many"] = "one",
    role: ExtractionEntityRole = ExtractionEntityRole.STUDY_SECTION,
    parent_entity_type_id: UUID | None = None,
    sort_order: int = 0,
    is_required: bool = False,
) -> ExtractionEntityType:
    """Construct an :class:`ExtractionEntityType` with type-checked
    role/parent invariants.

    Exactly one of ``project_template_id`` / ``template_id`` must be set
    (mirrors the DB XOR check constraint). The caller adds the row to a
    session and commits — this function does no I/O.
    """
    if (project_template_id is None) == (template_id is None):
        raise ValueError("Exactly one of project_template_id / template_id must be set")
    return ExtractionEntityType(
        id=uuid4(),
        project_template_id=project_template_id,
        template_id=template_id,
        name=name,
        # Default to the name verbatim (preserves caller-supplied
        # casing). Callers that want a humanized label pass it
        # explicitly.
        label=label if label is not None else name,
        cardinality=cardinality,
        role=role.value,
        parent_entity_type_id=parent_entity_type_id,
        sort_order=sort_order,
        is_required=is_required,
    )


class TemplateFactory:
    """Build a complete ``project_extraction_template`` skeleton for tests.

    Usage::

        factory = TemplateFactory(db, project_id, user_id)
        ptid = await factory.create(name="test-template", kind="extraction")
        container = await factory.add_container(ptid, name="prediction_models")
        section = await factory.add_section(ptid, parent=container, name="sub")
        study = await factory.add_study_section(ptid, name="participants")
        await db.commit()

    Every helper enforces the role/parent invariants from migration 0016
    at the application layer too, so misuse raises before the DB does.
    """

    def __init__(self, db: AsyncSession, project_id: UUID, user_id: UUID) -> None:
        self.db = db
        self.project_id = project_id
        self.user_id = user_id

    async def create(
        self,
        *,
        name: str = "test-template",
        kind: Literal["extraction", "quality_assessment"] = "extraction",
        is_active: bool = False,
    ) -> UUID:
        """Create a ``project_extraction_template`` + its v1 active version."""
        tid = uuid4()
        self.db.add(
            ProjectExtractionTemplate(
                id=tid,
                project_id=self.project_id,
                name=name,
                description=None,
                framework="CUSTOM",
                version="1.0",
                kind=TemplateKind(kind).value,
                schema_={},
                is_active=is_active,
                created_by=self.user_id,
            )
        )
        self.db.add(
            ExtractionTemplateVersion(
                project_template_id=tid,
                version=1,
                schema_={"entity_types": []},
                published_by=self.user_id,
                is_active=True,
            )
        )
        await self.db.flush()
        return tid

    async def add_study_section(
        self,
        project_template_id: UUID,
        *,
        name: str,
        cardinality: Literal["one", "many"] = "one",
        sort_order: int = 0,
    ) -> UUID:
        et = make_entity_type(
            project_template_id=project_template_id,
            name=name,
            cardinality=cardinality,
            role=ExtractionEntityRole.STUDY_SECTION,
            sort_order=sort_order,
        )
        self.db.add(et)
        await self.db.flush()
        return et.id

    async def add_container(
        self,
        project_template_id: UUID,
        *,
        name: str = "prediction_models",
        sort_order: int = 0,
    ) -> UUID:
        et = make_entity_type(
            project_template_id=project_template_id,
            name=name,
            cardinality="many",
            role=ExtractionEntityRole.MODEL_CONTAINER,
            sort_order=sort_order,
        )
        self.db.add(et)
        await self.db.flush()
        return et.id

    async def add_section(
        self,
        project_template_id: UUID,
        *,
        parent: UUID,
        name: str,
        cardinality: Literal["one", "many"] = "one",
        sort_order: int = 0,
    ) -> UUID:
        et = make_entity_type(
            project_template_id=project_template_id,
            name=name,
            cardinality=cardinality,
            role=ExtractionEntityRole.MODEL_SECTION,
            parent_entity_type_id=parent,
            sort_order=sort_order,
        )
        self.db.add(et)
        await self.db.flush()
        return et.id

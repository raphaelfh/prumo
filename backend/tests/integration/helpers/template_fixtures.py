"""Shared multi-tier template-config fixtures (B-9c1 / B-9b2a).

Lifted verbatim out of ``test_template_discard_draft.py``, which built them
first. They are shared rather than copied on purpose: the Discard gate and
the config-diff read are supposed to answer the same question about the same
tree, and two private copies of the setup would let the fixtures drift until
the suites stopped proving the gates agree.

Everything here writes through raw SQL or the real services — never the ORM
models directly — because the answers under test are RESTRICT FKs, CASCADEs
and trigger-materialized instances.
"""

from __future__ import annotations

import json as _json
from collections.abc import AsyncGenerator
from typing import Any
from uuid import UUID, uuid4

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.services.template_version_service import TemplateVersionService
from tests.integration.conftest import (
    SEED,
    clean_project_clones,
    clone_charms,
    make_proposal,
    open_session,
)

#: The article every fixture below materializes instances against. Lives in
#: the cross-project seed, which ships no articles of its own.
ARTICLE_ID = UUID("ffffffff-9999-0002-0000-0000000009c1")


# --------------------------------------------------------------------------
# HTTP auth
# --------------------------------------------------------------------------


async def authenticated_as(user_id: UUID, email: str) -> AsyncGenerator[UUID, None]:
    """Override ``get_current_user`` for the body of a fixture, then pop it."""

    async def _override() -> TokenPayload:
        return TokenPayload(sub=str(user_id), email=email, role="authenticated", aal="aal1")

    app.dependency_overrides[get_current_user] = _override
    yield user_id
    app.dependency_overrides.pop(get_current_user, None)


@pytest_asyncio.fixture
async def auth_as_manager(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    """JWT sub = a manager of both seeded projects.

    Imported by name into the suites that need it — every template-config
    endpoint is manager-gated, so the two suites that exercise them were
    declaring the same fixture twice."""
    del db_session  # fixture ordering only: the seed must run first
    async for user_id in authenticated_as(SEED.primary_profile, "t@example.com"):
        yield user_id


@pytest_asyncio.fixture
async def auth_as_reviewer(db_session: AsyncSession) -> AsyncGenerator[UUID, None]:
    """JWT sub = a member of the primary project who is NOT a manager.

    The negative half of ``auth_as_manager``: every manager-gated endpoint
    owes a 403 test, so this lives here for the same reason its sibling
    does rather than being redeclared per suite."""
    del db_session  # fixture ordering only: the seed must run first
    async for user_id in authenticated_as(SEED.reviewer_profile, "r@example.com"):
        yield user_id


# --------------------------------------------------------------------------
# Baseline setup
# --------------------------------------------------------------------------


async def fresh_charms(db: AsyncSession) -> tuple[UUID, UUID, dict[str, Any]]:
    """CHARMS cloned into the cross-project seed and published.

    Also materializes an article there: every partial-discard case needs a
    HITL session, and the cross-project seed ships none."""
    project_id = SEED.secondary_project
    await clean_project_clones(db, project_id)
    await db.execute(
        text(
            # Title only, never asserted on — ON CONFLICT DO NOTHING keys off
            # the fixed id above. Renamed from the original 'B-9c1 discard
            # article' when this helper moved here, because it is now shared
            # by more than the discard suite; do not assume byte-identity
            # with the pre-move fixture.
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'Template-config fixture article', 1) "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(ARTICLE_ID), "pid": str(project_id)},
    )
    clone = await clone_charms(db, project_id, SEED.primary_profile)
    template_id = clone.project_template_id
    await TemplateVersionService(db).republish(
        project_id=project_id,
        project_template_id=template_id,
        user_id=SEED.primary_profile,
    )
    return project_id, template_id, await active_schema(db, template_id)


async def force_narrow_baseline(db: AsyncSession, template_id: UUID, section: UUID) -> None:
    """Rewrite the active version's schema into the pre-0017 "narrow" shape.

    The entity type carries no ``role``, so ``snapshot_is_narrow`` calls it
    narrow and ``baseline_is_restorable`` refuses it — which is exactly what
    the count, the Discard gate and the config-diff read all key off. One
    owner because this shape is a GATE INPUT: a copy that drifted would
    quietly stop being narrow, and its suite would keep passing while
    testing nothing.
    """
    active = await ExtractionTemplateVersionRepository(db).get_active(template_id)
    assert active is not None
    active.schema_ = {"entity_types": [{"id": str(section), "label": "Narrow", "fields": []}]}
    await db.flush()


async def active_schema(db: AsyncSession, template_id: UUID) -> dict[str, Any]:
    schema: dict[str, Any] = (
        await db.execute(
            text(
                "SELECT schema FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active IS TRUE"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()
    return schema


# --------------------------------------------------------------------------
# Live introspection / draft edits
# --------------------------------------------------------------------------


async def entity_id(db: AsyncSession, template_id: UUID, name: str) -> UUID:
    return (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_entity_types "
                "WHERE project_template_id = :tid AND name = :name"
            ),
            {"tid": str(template_id), "name": name},
        )
    ).scalar_one()


async def field_id(db: AsyncSession, template_id: UUID, entity_name: str, field_name: str) -> UUID:
    return (
        await db.execute(
            text(
                "SELECT f.id FROM public.extraction_fields f "
                "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                "WHERE et.project_template_id = :tid AND et.name = :en AND f.name = :fn"
            ),
            {"tid": str(template_id), "en": entity_name, "fn": field_name},
        )
    ).scalar_one()


async def add_section(
    db: AsyncSession,
    template_id: UUID,
    name: str,
    *,
    role: str = "study_section",
    parent_id: UUID | None = None,
    cardinality: str = "one",
    sort_order: int = 99,
    entry_label: str | None = None,
) -> UUID:
    section_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, template_id, name, label, parent_entity_type_id, "
            " cardinality, role, sort_order, is_required, entry_label) "
            "VALUES (:id, :tid, NULL, :name, :label, :parent, CAST(:card AS extraction_cardinality),"
            " CAST(:role AS extraction_entity_role), :o, false, :entry)"
        ),
        {
            "id": str(section_id),
            "tid": str(template_id),
            "name": name,
            "label": name,
            "parent": str(parent_id) if parent_id else None,
            "card": cardinality,
            "role": role,
            "o": sort_order,
            "entry": entry_label,
        },
    )
    await db.flush()
    return section_id


async def add_field(
    db: AsyncSession, entity_type_id: UUID, name: str, *, sort_order: int = 99
) -> UUID:
    new_field_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required, sort_order, "
            " allow_other, allows_not_applicable, allows_not_evaluated) "
            "VALUES (:id, :et, :name, :label, 'text', false, :o, false, false, false)"
        ),
        {
            "id": str(new_field_id),
            "et": str(entity_type_id),
            "name": name,
            "label": name,
            "o": sort_order,
        },
    )
    await db.flush()
    return new_field_id


async def set_label(db: AsyncSession, table: str, node_id: UUID, label: str) -> None:
    await db.execute(
        text(f"UPDATE public.{table} SET label = :label WHERE id = :id"),  # noqa: S608
        {"id": str(node_id), "label": label},
    )
    await db.flush()


async def delete_field(db: AsyncSession, target_field_id: UUID) -> None:
    await db.execute(
        text("DELETE FROM public.extraction_fields WHERE id = :id"), {"id": str(target_field_id)}
    )
    await db.flush()


async def add_instance(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    entity_type_id: UUID,
    parent_instance_id: UUID | None = None,
) -> UUID:
    """One extraction instance, the way the run UI adds a repeating entry."""
    instance_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, article_id, template_id, entity_type_id, parent_instance_id, "
            " label, sort_order, created_by) "
            "VALUES (:id, :pid, :aid, :tid, :et, :parent, 'entry', 0, :uid)"
        ),
        {
            "id": str(instance_id),
            "pid": str(project_id),
            "aid": str(ARTICLE_ID),
            "tid": str(template_id),
            "et": str(entity_type_id),
            "parent": str(parent_instance_id) if parent_instance_id else None,
            "uid": str(SEED.primary_profile),
        },
    )
    await db.flush()
    return instance_id


async def option_orphan_setup(
    db: AsyncSession, *, options: tuple[str, ...] = ("draft_option",)
) -> tuple[UUID, UUID, UUID]:
    """A draft that added select options a reviewer then picked one of.

    ``options`` is the whole draft list; the baseline has none, so every
    entry is a separate destructive change on the SAME field."""
    project_id, template_id, _ = await fresh_charms(db)
    owner = await entity_id(db, template_id, "sample_size")
    target = await field_id(db, template_id, "sample_size", "number_of_participants")
    session = await open_session(
        db,
        project_id=project_id,
        article_id=ARTICLE_ID,
        template_id=template_id,
        user_id=SEED.primary_profile,
    )
    await db.execute(
        text(
            "UPDATE public.extraction_fields "
            "SET allowed_values = CAST(:opts AS jsonb) WHERE id = :id"
        ),
        {"id": str(target), "opts": _json.dumps(list(options))},
    )
    await db.flush()
    await make_proposal(
        db,
        run_id=session.run_id,
        instance_id=UUID(session.instances_by_entity_type[str(owner)]),
        field_id=target,
        user_id=SEED.primary_profile,
        value=options[0],
    )
    return project_id, template_id, target


async def draft_lock_holder(db: AsyncSession, template_id: UUID) -> UUID | None:
    """Who currently holds a template's config draft lock, if anyone."""
    return (
        await db.execute(
            text("SELECT config_draft_by FROM public.project_extraction_templates WHERE id = :t"),
            {"t": str(template_id)},
        )
    ).scalar_one()

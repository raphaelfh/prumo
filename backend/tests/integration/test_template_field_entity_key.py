"""Declaring a section's entity key through the API (0059).

The AI path refuses a repeating group that declares no key rather than
duplicating in silence. That refusal is only honest because a manager can
satisfy it — this is that path.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.template_structure import TemplateFieldUpdateRequest
from app.services.template_field_service import DuplicateEntityKeyError, update_field
from tests.integration.conftest import SEED

pytestmark = pytest.mark.asyncio


async def _section_with_two_fields(db: AsyncSession) -> tuple[UUID, UUID, UUID]:
    entity_type_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, sort_order) "
            "VALUES (:id, :tpl, :name, 'Key Probe', 'many', 'study_section', 96)"
        ),
        {
            "id": entity_type_id,
            "tpl": SEED.primary_template,
            "name": f"keyprobe_{entity_type_id.hex[:8]}",
        },
    )
    ids = []
    for n, fname in enumerate(("first_field", "second_field")):
        fid = uuid4()
        await db.execute(
            text(
                "INSERT INTO public.extraction_fields "
                "(id, entity_type_id, name, label, field_type, sort_order) "
                "VALUES (:id, :et, :n, :l, 'text', :s)"
            ),
            {"id": fid, "et": entity_type_id, "n": fname, "l": fname, "s": n},
        )
        ids.append(fid)
    await db.flush()
    return entity_type_id, ids[0], ids[1]


async def test_a_manager_can_declare_the_entity_key(db_session: AsyncSession) -> None:
    _, first, _ = await _section_with_two_fields(db_session)
    read = await update_field(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        field_id=first,
        payload=TemplateFieldUpdateRequest(is_entity_key=True),
    )
    assert read.is_entity_key is True


async def test_a_second_key_on_the_same_section_is_refused(
    db_session: AsyncSession,
) -> None:
    """Typed error, not a raw 23505 leaking out of the driver."""
    _, first, second = await _section_with_two_fields(db_session)
    await update_field(
        db_session,
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        field_id=first,
        payload=TemplateFieldUpdateRequest(is_entity_key=True),
    )
    with pytest.raises(DuplicateEntityKeyError):
        await update_field(
            db_session,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            field_id=second,
            payload=TemplateFieldUpdateRequest(is_entity_key=True),
        )


async def test_moving_the_key_to_another_field_is_allowed(
    db_session: AsyncSession,
) -> None:
    """Clearing then setting must work — otherwise a mistake is permanent."""
    _, first, second = await _section_with_two_fields(db_session)
    for field_id, value in ((first, True), (first, False), (second, True)):
        await update_field(
            db_session,
            project_id=SEED.primary_project,
            template_id=SEED.primary_template,
            field_id=field_id,
            payload=TemplateFieldUpdateRequest(is_entity_key=value),
        )
    flagged = (
        await db_session.execute(
            text("SELECT id FROM public.extraction_fields WHERE is_entity_key AND id IN (:a, :b)"),
            {"a": first, "b": second},
        )
    ).scalars().all()
    assert flagged == [second]


async def test_is_entity_key_may_not_be_nulled(db_session: AsyncSession) -> None:
    with pytest.raises(ValueError, match="may be omitted but not null"):
        TemplateFieldUpdateRequest(is_entity_key=None)

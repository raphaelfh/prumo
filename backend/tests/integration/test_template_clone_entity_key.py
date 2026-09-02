"""Clone must carry ``is_entity_key`` into the project copy.

``is_entity_key`` is what ``entity_key.resolve_key_field`` reads to tell a
new repeating-group entry from one the AI already extracted. The project
clone is what a Run resolves against, so dropping the flag here leaves
every cloned CHARMS project with repeating sections that declare no
identity — and ``model_extraction_service`` then raises
``MissingEntityKeyError`` on the first AI extraction into them.

The module docstring of ``entity_key`` states that "the seed and migration
0059 cover every CHARMS lineage so the common path never reaches this".
That holds only while the clone preserves the flag: the seed stamps the
GLOBAL catalogue and 0059 backfilled rows that already existed, so a
project cloned after 0059 gets its identity silently stripped.
"""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import TemplateKind
from app.services.template_clone_service import TemplateCloneService
from tests.integration.conftest import SEED

_CHARMS_TEMPLATE_ID = UUID("000c0000-0000-0000-0000-000000000001")


@pytest.mark.asyncio
async def test_clone_preserves_entity_key_flag(db_session: AsyncSession) -> None:
    global_keys = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_fields f
                JOIN public.extraction_entity_types et ON et.id = f.entity_type_id
                WHERE et.template_id = :tid AND f.is_entity_key
                """
            ),
            {"tid": str(_CHARMS_TEMPLATE_ID)},
        )
    ).scalar()
    assert global_keys and global_keys > 0, "CHARMS global must declare entity keys"

    clone = await TemplateCloneService(db_session).clone(
        project_id=SEED.primary_project,
        global_template_id=_CHARMS_TEMPLATE_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.EXTRACTION,
    )
    await db_session.flush()

    cloned_keys = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_fields f
                JOIN public.extraction_entity_types et ON et.id = f.entity_type_id
                WHERE et.project_template_id = :tid AND f.is_entity_key
                """
            ),
            {"tid": str(clone.project_template_id)},
        )
    ).scalar()
    assert cloned_keys == global_keys, (
        f"clone dropped the entity-key flag: {cloned_keys} of {global_keys} survived"
    )


@pytest.mark.asyncio
async def test_cloned_repeating_group_resolves_its_key_field(
    db_session: AsyncSession,
) -> None:
    """The consequence, not just the column: AI re-run matching must resolve.

    Counting flags proves the copy; this proves the thing the copy exists for
    — ``resolve_key_field`` on the CLONE's repeating section returns a field
    instead of raising, which is what stops a re-run duplicating every entry.
    """
    from app.services.entity_key import resolve_key_field

    clone = await TemplateCloneService(db_session).clone(
        project_id=SEED.primary_project,
        global_template_id=_CHARMS_TEMPLATE_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.EXTRACTION,
    )
    await db_session.flush()

    entity_type_id = (
        await db_session.execute(
            text(
                """
                SELECT id FROM public.extraction_entity_types
                WHERE project_template_id = :tid AND name = 'prediction_models'
                """
            ),
            {"tid": str(clone.project_template_id)},
        )
    ).scalar()
    assert entity_type_id is not None, "CHARMS clone must carry prediction_models"

    key_field = await resolve_key_field(db_session, entity_type_id)
    assert key_field.name == "model_name"

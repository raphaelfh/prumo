"""Clone must carry ``is_entity_key`` into the project copy.

A run's pinned snapshot is built from the CLONE, and ``entity_key.key_field_of``
reads the flag off that snapshot; drop it here and the first AI extraction
into a repeating section raises ``MissingEntityKeyError``.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import CHARMS_GLOBAL_ID, SEED, clone_charms


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
            {"tid": str(CHARMS_GLOBAL_ID)},
        )
    ).scalar()
    assert global_keys and global_keys > 0, "CHARMS global must declare entity keys"

    clone = await clone_charms(db_session, SEED.primary_project, SEED.primary_profile)
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

    # The consequence, not just the column: the clone's repeating section
    # resolves its key field instead of raising, which is what stops an AI
    # re-run duplicating every entry.
    prediction_models_id = (
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
    assert prediction_models_id is not None, "CHARMS clone must carry prediction_models"
    key_name = (
        await db_session.execute(
            text(
                "SELECT name FROM public.extraction_fields "
                "WHERE entity_type_id = :et AND is_entity_key"
            ),
            {"et": prediction_models_id},
        )
    ).scalar_one()
    assert key_name == "model_name"

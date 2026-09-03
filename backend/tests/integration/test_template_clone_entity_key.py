"""Clone must carry ``is_entity_key`` into the project copy.

``entity_key.resolve_key_field`` reads the flag off the CLONE, since that is
what a Run resolves against; drop it here and the first AI extraction into a
repeating section raises ``MissingEntityKeyError``.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.entity_key import resolve_key_field
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
    assert (await resolve_key_field(db_session, prediction_models_id)).name == "model_name"

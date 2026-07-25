"""Clone must carry ADR-0016 opt-in disposition flags into the project copy.

Without this, every PROBAST / PROBAST+AI signaling question loses its
"Not applicable" affordance inside a project (and in the frozen version
snapshot), because the project clone is what the run-open form renders.
"""

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import TemplateKind
from app.services.template_clone_service import TemplateCloneService
from tests.integration.conftest import SEED

_PROBAST_TEMPLATE_ID = UUID("00b00000-0000-0000-0000-000000000001")


@pytest.mark.asyncio
async def test_clone_preserves_not_applicable_flag(db_session: AsyncSession) -> None:
    global_na = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_fields f
                JOIN public.extraction_entity_types et ON et.id = f.entity_type_id
                WHERE et.template_id = :tid AND f.allows_not_applicable
                """
            ),
            {"tid": str(_PROBAST_TEMPLATE_ID)},
        )
    ).scalar()
    assert global_na and global_na > 0, "PROBAST global must have NA-enabled fields"

    clone = await TemplateCloneService(db_session).clone(
        project_id=SEED.primary_project,
        global_template_id=_PROBAST_TEMPLATE_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.QUALITY_ASSESSMENT,
    )
    await db_session.flush()

    cloned_na = (
        await db_session.execute(
            text(
                """
                SELECT COUNT(*) FROM public.extraction_fields f
                JOIN public.extraction_entity_types et ON et.id = f.entity_type_id
                WHERE et.project_template_id = :tid AND f.allows_not_applicable
                """
            ),
            {"tid": str(clone.project_template_id)},
        )
    ).scalar()
    assert cloned_na == global_na, (
        f"clone dropped disposition flags: {cloned_na} of {global_na} survived"
    )

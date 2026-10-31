"""Characterization tests for the identity facts the export relies on (spec §13, PR4).

``section.name`` is not unique within a template, so two active fields can
share a ``field_code`` (``<section.name>.<field.name>``): the export's rule 3
must suffix the later one (D1) rather than assume the code is a key.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.template_structure import SectionCreateRequest
from app.services.template_section_service import create_section
from tests.integration.conftest import SEED, clean_project_clones, clone_charms


@pytest.mark.asyncio
async def test_two_sections_in_one_template_may_share_a_name(db_session: AsyncSession) -> None:
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    payload = SectionCreateRequest(name="dup_section", label="Dup", cardinality="one")

    a = await create_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=clone.project_template_id,
        payload=payload,
    )
    b = await create_section(
        db_session,
        project_id=SEED.secondary_project,
        template_id=clone.project_template_id,
        payload=payload,
    )

    assert a.id != b.id
    assert a.name == b.name == "dup_section"

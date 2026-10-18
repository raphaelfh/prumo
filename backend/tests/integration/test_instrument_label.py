"""The instrument a QA prompt names comes from the template's stable code.

A manager can rename a template; the ``instrument`` code is set by the seed
and copied on clone, so a renamed PROBAST+AI clone still prompts as
"PROBAST+AI". ``custom`` templates keep the old behavior: their own name.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionTemplateGlobal, ProjectExtractionTemplate
from app.schemas.extraction import INSTRUMENT_LABELS
from app.services.ai_extraction.service import instrument_label
from app.services.template_create_service import create_blank_template
from tests.integration.conftest import SEED, clean_project_clones


@pytest.mark.parametrize(
    ("code", "label"), list(INSTRUMENT_LABELS.items()), ids=list(INSTRUMENT_LABELS)
)
def test_known_code_yields_fixed_label(code: str, label: str) -> None:
    template = SimpleNamespace(instrument=code, name="My RoB form", framework="CUSTOM")
    assert instrument_label(template) == label


def test_known_labels_are_the_seeded_names() -> None:
    assert INSTRUMENT_LABELS == {
        "charms": "CHARMS",
        "charms_mm": "CHARMS + Multimodal (ML prediction)",
        "probast": "PROBAST",
        "probast_ai": "PROBAST+AI",
        "quadas2": "QUADAS-2",
    }


def test_custom_yields_own_name() -> None:
    assert (
        instrument_label(SimpleNamespace(instrument="custom", name=" Mine ", framework="CUSTOM"))
        == "Mine"
    )
    assert instrument_label(None) is None
    assert (
        instrument_label(SimpleNamespace(instrument="custom", name="  ", framework="CUSTOM"))
        == "CUSTOM"
    )


@pytest.mark.asyncio
async def test_seeded_clone_label_equals_name(db_session: AsyncSession) -> None:
    """Seeded globals keep a byte-identical QA prompt label after the switch."""
    rows = list((await db_session.execute(select(ExtractionTemplateGlobal))).scalars())
    seeded = [row for row in rows if row.instrument != "custom"]
    assert {row.instrument for row in seeded} >= {"probast", "probast_ai", "quadas2"}
    named_as_label = [row for row in seeded if row.name == INSTRUMENT_LABELS[row.instrument]]
    assert len(named_as_label) >= 3
    for row in named_as_label:
        assert instrument_label(row) == row.name


@pytest.mark.asyncio
async def test_blank_template_reads_custom(db_session: AsyncSession) -> None:
    await clean_project_clones(db_session, SEED.secondary_project)
    result = await create_blank_template(
        db_session,
        project_id=SEED.secondary_project,
        name="Blank instrument",
        description=None,
        framework="CUSTOM",
        user_id=SEED.primary_profile,
    )
    tpl = await db_session.get(ProjectExtractionTemplate, result.project_template_id)
    assert tpl is not None
    await db_session.refresh(tpl)
    assert tpl.instrument == "custom"

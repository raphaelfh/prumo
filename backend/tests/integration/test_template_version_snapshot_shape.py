"""The frozen template-version snapshot must carry every column the run-open
form renders from — role (study/model partition), plus the field columns that
drive units, validation, and the 'other' option. Both builders share one SQL
fragment so they can never drift again (role was once added to clone but not
lifecycle)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_snapshot import build_template_version_snapshot
from tests.integration.conftest import SEED, clean_project_clones, clone_charms

_ENTITY_KEYS = {
    "id",
    "name",
    "label",
    "description",
    "entry_label",
    "parent_entity_type_id",
    "cardinality",
    "role",
    "sort_order",
    "is_required",
    "fields",
}
_FIELD_KEYS = {
    "id",
    "name",
    "label",
    "description",
    "field_type",
    "is_required",
    "validation_schema",
    "allowed_values",
    "unit",
    "allowed_units",
    "sort_order",
    "llm_description",
    "allow_other",
    "other_label",
    "other_placeholder",
}


@pytest.mark.asyncio
async def test_snapshot_carries_role_and_all_field_columns(
    db_session: AsyncSession,
) -> None:
    template_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE id = :tid AND kind = 'extraction' LIMIT 1"
            ),
            {"tid": str(SEED.primary_template)},
        )
    ).scalar()
    if template_id is None:
        pytest.skip("Seed graph incomplete")

    snapshot = await build_template_version_snapshot(db_session, template_id)
    entity_types = snapshot["entity_types"]
    assert entity_types, "expected a non-empty entity_types tree for a seeded template"

    for et in entity_types:
        assert set(et.keys()) >= _ENTITY_KEYS, (
            f"entity_type missing keys: {_ENTITY_KEYS - set(et.keys())}"
        )
        assert et["role"] in ("study_section", "model_container", "model_section")
        for f in et["fields"]:
            assert set(f.keys()) >= _FIELD_KEYS, (
                f"field missing keys: {_FIELD_KEYS - set(f.keys())}"
            )


@pytest.mark.asyncio
async def test_snapshot_carries_entry_label(db_session: AsyncSession) -> None:
    """B-8: the group entry noun is pinned in the snapshot — 'model' for
    the seeded CHARMS container, null for every other section (nullable
    entity keys are emitted unconditionally, D2)."""
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)

    snapshot = await build_template_version_snapshot(db_session, clone.project_template_id)
    entity_types = snapshot["entity_types"]
    assert any(et["role"] == "model_container" for et in entity_types)
    for et in entity_types:
        assert "entry_label" in et, f"entity_type {et.get('name')} missing entry_label"
        if et["role"] == "model_container":
            assert et["entry_label"] == "model"
        else:
            assert et["entry_label"] is None
    await db_session.rollback()


@pytest.mark.asyncio
async def test_snapshot_omits_instruction_key_when_null(
    db_session: AsyncSession,
) -> None:
    """Absent ≡ NULL: legacy templates must republish byte-identically."""
    snapshot = await build_template_version_snapshot(db_session, SEED.primary_template)
    assert "llm_template_instruction" not in snapshot


@pytest.mark.asyncio
async def test_snapshot_carries_instruction_when_set(
    db_session: AsyncSession,
) -> None:
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'Focus on the primary cohort.' "
            "WHERE id = :tid"
        ),
        {"tid": str(SEED.primary_template)},
    )
    snapshot = await build_template_version_snapshot(db_session, SEED.primary_template)
    assert snapshot["llm_template_instruction"] == "Focus on the primary cohort."
    # No commit: the fixture transaction rolls the UPDATE back.


@pytest.mark.asyncio
async def test_general_instructions_reader_prefers_pinned_snapshot(
    db_session: AsyncSession,
) -> None:
    """The prompt path reads the pinned version, never the live column."""
    from app.services.extraction_snapshot import general_instructions_for_version

    version_id = uuid.uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(id, project_template_id, version, schema, published_by, is_active) "
            "VALUES (:id, :tid, 999, "
            ' \'{"entity_types": [], "llm_template_instruction": "PINNED"}\'::jsonb, '
            " :pub, false)"
        ),
        {
            "id": str(version_id),
            "tid": str(SEED.primary_template),
            "pub": str(SEED.primary_profile),
        },
    )
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'LIVE' WHERE id = :tid"
        ),
        {"tid": str(SEED.primary_template)},
    )
    assert await general_instructions_for_version(db_session, version_id) == "PINNED"


@pytest.mark.asyncio
async def test_general_instructions_reader_none_when_key_absent(
    db_session: AsyncSession,
) -> None:
    from app.services.extraction_snapshot import general_instructions_for_version

    active_version_id = (
        await db_session.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active"
            ),
            {"tid": str(SEED.primary_template)},
        )
    ).scalar_one()
    assert await general_instructions_for_version(db_session, active_version_id) is None

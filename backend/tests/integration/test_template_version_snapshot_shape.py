"""The frozen template-version snapshot must carry every column the run-open
form renders from — role (study/model partition), plus the field columns that
drive units, validation, and the 'other' option. Both builders share one SQL
fragment so they can never drift again (role was once added to clone but not
lifecycle)."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_snapshot import build_template_version_snapshot

_ENTITY_KEYS = {
    "id",
    "name",
    "label",
    "description",
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
                "WHERE kind = 'extraction' LIMIT 1"
            )
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

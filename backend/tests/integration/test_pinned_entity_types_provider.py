"""B-2: the shared pinned-snapshot entity-types provider.

Prompts must read template structure from ``run.version_id``'s snapshot,
never live rows. These tests FORCE divergence (pinned snapshot says one
thing, live rows another) — a test that passes on today's live==snapshot
data proves nothing.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extraction_snapshot import entity_types_for_version
from tests.integration.conftest import SEED


def _wide_entity_type(
    *,
    et_id: str,
    label: str,
    role: str = "study_section",
    parent: str | None = None,
    fields: list[dict] | None = None,
) -> dict:
    """A snapshot entity type carrying the full post-0026 key set."""
    return {
        "id": et_id,
        "name": f"name_{et_id[:8]}",
        "label": label,
        "description": "pinned description",
        "parent_entity_type_id": parent,
        "cardinality": "one",
        "role": role,
        "sort_order": 0,
        "is_required": False,
        "fields": fields or [],
    }


def _wide_field(*, field_id: str, name: str, label: str) -> dict:
    return {
        "id": field_id,
        "name": name,
        "label": label,
        "description": None,
        "field_type": "text",
        "is_required": False,
        "validation_schema": None,
        "allowed_values": None,
        "unit": None,
        "allowed_units": None,
        "sort_order": 0,
        "llm_description": "pinned per-field instruction",
        "allow_other": False,
        "other_label": None,
        "other_placeholder": None,
        "allows_not_applicable": False,
        "allows_not_evaluated": False,
    }


async def _insert_version(db: AsyncSession, *, version: int, schema: dict) -> uuid.UUID:
    import json

    version_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_template_versions "
            "(id, project_template_id, version, schema, published_by, is_active) "
            "VALUES (:id, :tid, :version, CAST(:schema AS jsonb), :pub, false)"
        ),
        {
            "id": str(version_id),
            "tid": str(SEED.primary_template),
            "version": version,
            "schema": json.dumps(schema),
            "pub": str(SEED.primary_profile),
        },
    )
    return version_id


@pytest.mark.asyncio
async def test_provider_returns_pinned_tree_not_live(db_session: AsyncSession) -> None:
    """Divergence: the pinned snapshot wins over live rows entirely."""
    et_id = str(uuid.uuid4())
    field_id = str(uuid.uuid4())
    version_id = await _insert_version(
        db_session,
        version=990,
        schema={
            "entity_types": [
                _wide_entity_type(
                    et_id=et_id,
                    label="PINNED SECTION",
                    fields=[_wide_field(field_id=field_id, name="pinned_field", label="Pinned")],
                )
            ]
        },
    )

    tree = await entity_types_for_version(
        db_session, version_id=version_id, template_id=SEED.primary_template
    )

    assert [et.label for et in tree] == ["PINNED SECTION"]
    assert tree[0].id == uuid.UUID(et_id)
    assert [f.name for f in tree[0].fields] == ["pinned_field"]
    # ids must round-trip as UUIDs — they flow into set membership against
    # DB-sourced UUIDs; a str would silently never match.
    assert isinstance(tree[0].fields[0].id, uuid.UUID)


@pytest.mark.asyncio
async def test_provider_chains_empty_snapshot_to_live(db_session: AsyncSession) -> None:
    """An empty pinned tree must NOT make extraction a green no-op: it
    chains to the live read, which for the seeded template is non-empty."""
    version_id = await _insert_version(db_session, version=991, schema={"entity_types": []})

    tree = await entity_types_for_version(
        db_session, version_id=version_id, template_id=SEED.primary_template
    )

    assert tree, "empty snapshot must fall back to live rows"
    assert all(et.role in ("study_section", "model_container", "model_section") for et in tree)


@pytest.mark.asyncio
async def test_provider_chains_heterogeneous_snapshot_to_live(
    db_session: AsyncSession,
) -> None:
    """First element wide, second narrow (no 'role'): first-element-only
    narrowness detection would pass the check and then blow up
    ``model_validate`` on element two. Per-element detection chains to live."""
    version_id = await _insert_version(
        db_session,
        version=992,
        schema={
            "entity_types": [
                _wide_entity_type(et_id=str(uuid.uuid4()), label="wide"),
                {
                    # pre-0017 narrow shape: no role, no cardinality
                    "id": str(uuid.uuid4()),
                    "name": "narrow",
                    "label": "narrow",
                    "fields": [],
                },
            ]
        },
    )

    tree = await entity_types_for_version(
        db_session, version_id=version_id, template_id=SEED.primary_template
    )

    assert tree, "heterogeneous snapshot must fall back to live, not raise"
    assert all(et.role for et in tree)


@pytest.mark.asyncio
async def test_provider_missing_version_chains_to_live(
    db_session: AsyncSession,
) -> None:
    """A dangling version id degrades to the live read rather than a 500."""
    tree = await entity_types_for_version(
        db_session, version_id=uuid.uuid4(), template_id=SEED.primary_template
    )
    assert tree

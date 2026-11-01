"""Integration: the Codebook spans every version a run pins (spec §4.4, R14, D5).

Real Postgres. Extra template versions are inserted on the seed template and
pinned by finalized runs on the seed article; the SAVEPOINT rollback drops them.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import ExtractionTemplateVersion
from app.services.extraction_export_service import ExportMode, ExtractionExportService
from tests.integration.conftest import SEED
from tests.unit.helpers.snapshot_builders import entity_node, field_node, snapshot

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


async def _add_pinned_version(db: AsyncSession, number: int, schema: dict) -> UUID:
    version = ExtractionTemplateVersion(
        project_template_id=SEED.primary_template,
        version=number,
        is_active=False,
        published_by=SEED.primary_profile,
        schema_=schema,
    )
    db.add(version)
    await db.flush()
    await db.execute(
        text(
            "INSERT INTO public.extraction_runs "
            "(id, project_id, article_id, template_id, kind, version_id, "
            " stage, status, created_by) "
            "VALUES (gen_random_uuid(), :pid, :aid, :tid, 'extraction', "
            " :vid, 'finalized', 'completed', :created_by)"
        ),
        {
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "tid": str(SEED.primary_template),
            "vid": str(version.id),
            "created_by": str(SEED.primary_profile),
        },
    )
    return version.id


def _dropped_snapshot(fid: UUID, *, label: str, option: tuple[str, str]) -> dict:
    code, option_label = option
    return snapshot(
        entity_node(
            uuid4(),
            field_node(
                fid,
                name="dropped",
                label=label,
                field_type="select",
                allowed_values=[{"value": code, "label": option_label}],
            ),
            name="s",
        )
    )


async def _resolve(db: AsyncSession):
    svc = ExtractionExportService(db=db, user_id=str(SEED.primary_profile))
    return await svc.resolve_layout(
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        mode=ExportMode.CONSENSUS,
        article_ids=[],
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
    )


async def test_codebook_covers_a_version_pinned_only_by_a_run(db_session: AsyncSession) -> None:
    fid = uuid4()
    await _add_pinned_version(
        db_session, 9001, _dropped_snapshot(fid, label="Dropped", option=("B", "Bee"))
    )
    await _add_pinned_version(db_session, 9002, {"entity_types": []})

    layout = await _resolve(db_session)

    e = next(e for e in layout.codebook if e.field_id == fid)
    assert (e.field_code, e.section_id, e.in_current_version, e.versions) == (
        "s.dropped",
        None,
        False,
        (9001,),
    )
    assert all(9002 not in e.versions for e in layout.codebook)  # narrow snapshot skipped
    assert layout.narrow_pinned_versions == (9002,)  # D5
    assert [v.version_label for v in layout.versions if v.version_label >= 9000] == [9001]
    # The active version leads, carrying its own run-view fields (R14).
    assert layout.versions[0].version_label == layout.template_version


@pytest.mark.parametrize(
    "insert_order", [(9001, 9003), (9003, 9001)], ids=["old-first", "new-first"]
)
async def test_labels_and_metadata_come_from_the_latest_pinned_version(
    db_session: AsyncSession, insert_order: tuple[int, int]
) -> None:
    """Option labels and Codebook metadata read the same latest-first sequence."""
    fid = uuid4()
    snapshots = {
        9001: _dropped_snapshot(fid, label="Old", option=("B", "Bee v1")),
        9003: _dropped_snapshot(fid, label="Newer", option=("B", "Bee v3")),
    }
    for number in insert_order:
        await _add_pinned_version(db_session, number, snapshots[number])

    layout = await _resolve(db_session)

    assert [v.version_label for v in layout.versions if v.version_label >= 9000] == [9003, 9001]
    e = next(e for e in layout.codebook if e.field_id == fid)
    assert (e.field_label, e.versions) == ("Newer", (9001, 9003))
    assert [(o.code, o.label) for o in e.options] == [("B", "Bee v3")]

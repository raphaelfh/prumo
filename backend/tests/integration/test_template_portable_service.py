# backend/tests/integration/test_template_portable_service.py
"""Round-trip and lifecycle tests for the portable template service.

The round-trip (seeded template → clone → export → import → export) is the one
test that proves BOTH directions and every carried column at once; it runs
over both seeded extraction globals because CHARMS+Multimodal carries
~1.4k-char llm_descriptions the editor's cap would have rejected.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError
from app.models.extraction_versioning import TemplateKind
from app.schemas.template_portable import PortableSection, PortableTemplate
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_clone_service import TemplateCloneService
from app.services.template_portable_service import (
    TemplateExportInvalidError,
    TemplateImportInvalidError,
    TemplateImportUnsupportedVersionError,
    TemplateImportWrongKindError,
    import_portable,
    parse_portable_document,
    to_portable,
)
from tests.integration.conftest import SEED, clean_project_clones, clone_charms

CHARMS_GLOBAL_ID = UUID("000c0000-0000-0000-0000-000000000001")
CHARMS_MM_GLOBAL_ID = UUID("000e0000-0000-0000-0000-000000000001")
PROBAST_GLOBAL_ID = UUID("00b00000-0000-0000-0000-000000000001")


def _dump(doc: PortableTemplate) -> dict:
    return doc.model_dump(by_alias=True, exclude_defaults=True)


async def _count(db: AsyncSession, sql: str, **params) -> int:
    return (await db.execute(text(sql), params)).scalar_one()


async def _clone(db: AsyncSession, project_id: UUID, global_id: UUID, kind: TemplateKind):
    return await TemplateCloneService(db).clone(
        project_id=project_id,
        global_template_id=global_id,
        user_id=SEED.primary_profile,
        kind=kind,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("global_id", [CHARMS_GLOBAL_ID, CHARMS_MM_GLOBAL_ID])
async def test_round_trip_is_lossless(db_session: AsyncSession, global_id: UUID) -> None:
    """One project suffices: the import creates a SECOND template there (and
    deactivates the clone), so the two exports come from distinct rows. The
    instruction is set explicitly — the seed backfill does not run in CI."""
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await _clone(db_session, project_id, global_id, TemplateKind.EXTRACTION)
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates "
            "SET llm_template_instruction = 'Extract only what the article states.' "
            "WHERE id = :tid"
        ),
        {"tid": str(clone.project_template_id)},
    )

    exported = await to_portable(
        db_session, project_id=project_id, template_id=clone.project_template_id
    )
    assert exported.prumo_template == 1 and exported.kind == "extraction"
    assert any(s.group for s in exported.sections)  # both CHARMS lineages have the model group
    assert exported.llm_template_instruction == "Extract only what the article states."

    imported = await import_portable(
        db_session, project_id=project_id, doc=exported, user_id=SEED.primary_profile
    )
    assert imported.created is True
    assert imported.project_template_id != clone.project_template_id
    assert imported.entity_type_count == clone.entity_type_count
    assert imported.field_count == clone.field_count

    re_exported = await to_portable(
        db_session, project_id=project_id, template_id=imported.project_template_id
    )
    assert _dump(re_exported) == _dump(exported)


@pytest.mark.asyncio
async def test_import_activates_new_and_deactivates_previous(db_session: AsyncSession) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    previous = await clone_charms(db_session, project_id, SEED.primary_profile)

    doc = parse_portable_document(
        {
            "prumo_template": 1,
            "kind": "extraction",
            "name": "Mini",
            "sections": [
                {
                    "name": "sec1",
                    "label": "S1",
                    "fields": [{"name": "f1", "label": "F1", "type": "text"}],
                }
            ],
        }
    )
    result = await import_portable(
        db_session, project_id=project_id, doc=doc, user_id=SEED.primary_profile
    )

    rows = await db_session.execute(
        text(
            "SELECT id, is_active, global_template_id FROM public.project_extraction_templates "
            "WHERE project_id = :pid AND kind = 'extraction'"
        ),
        {"pid": str(project_id)},
    )
    state = {str(r.id): (r.is_active, r.global_template_id) for r in rows}
    assert state[str(result.project_template_id)] == (True, None)
    assert state[str(previous.project_template_id)][0] is False

    assert (
        await _count(
            db_session,
            "SELECT COUNT(*) FROM public.extraction_template_versions "
            "WHERE project_template_id = :tid AND is_active",
            tid=str(result.project_template_id),
        )
        == 1
    )
    snapshot = (
        await db_session.execute(
            text("SELECT schema FROM public.extraction_template_versions WHERE id = :vid"),
            {"vid": str(result.version_id)},
        )
    ).scalar_one()
    assert [et["name"] for et in snapshot["entity_types"]] == ["sec1"]
    assert [f["name"] for f in snapshot["entity_types"][0]["fields"]] == ["f1"]
    assert snapshot["entity_types"][0]["role"] == "study_section"
    assert snapshot["entity_types"][0]["fields"][0]["validation_schema"] == {}


@pytest.mark.asyncio
async def test_import_derives_roles_and_template_wide_sort_order(
    db_session: AsyncSession,
) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    doc = parse_portable_document(
        {
            "prumo_template": 1,
            "kind": "extraction",
            "name": "Grouped",
            "sections": [
                {"name": "root", "label": "Root", "repeats": True, "entry_label": "arm"},
                {
                    "name": "grp",
                    "label": "G",
                    "group": True,
                    "fields": [{"name": "key", "label": "K", "type": "text"}],
                    "sections": [{"name": "child", "label": "C", "repeats": True}],
                },
                {"name": "tail", "label": "T"},
            ],
        }
    )
    result = await import_portable(
        db_session, project_id=project_id, doc=doc, user_id=SEED.primary_profile
    )
    rows = await db_session.execute(
        text(
            "SELECT name, role, cardinality, entry_label, sort_order, "
            "parent_entity_type_id IS NOT NULL AS has_parent "
            "FROM public.extraction_entity_types WHERE project_template_id = :tid"
        ),
        {"tid": str(result.project_template_id)},
    )
    by_name = {r.name: r for r in rows}
    assert (by_name["root"].role, by_name["root"].cardinality, by_name["root"].has_parent) == (
        "study_section",
        "many",
        False,
    )
    # The noun rides every repeating section, not only the group (entry-group train).
    assert by_name["root"].entry_label == "arm"
    # A repeating section imported without a noun keeps NULL — the bundle
    # round-trips losslessly and every reader falls back to the one fallback
    # noun ('entry'); the container's old 'model' default is gone.
    assert (by_name["grp"].role, by_name["grp"].cardinality, by_name["grp"].entry_label) == (
        "model_container",
        "many",
        None,
    )
    assert (by_name["child"].role, by_name["child"].cardinality, by_name["child"].has_parent) == (
        "model_section",
        "many",
        True,
    )
    assert by_name["child"].entry_label is None
    assert by_name["tail"].entry_label is None
    # Template-wide pre-order: no ties (SNAPSHOT_SQL sorts by bare sort_order).
    orders = [by_name[n].sort_order for n in ("root", "grp", "child", "tail")]
    assert orders == [0, 1, 2, 3]


@pytest.mark.asyncio
async def test_same_named_sections_import(db_session: AsyncSession) -> None:
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    doc = parse_portable_document(
        {
            "prumo_template": 1,
            "kind": "extraction",
            "name": "Dup",
            "sections": [{"name": "sec", "label": "A"}, {"name": "sec", "label": "B"}],
        }
    )
    result = await import_portable(
        db_session, project_id=project_id, doc=doc, user_id=SEED.primary_profile
    )
    assert result.entity_type_count == 2


@pytest.mark.parametrize(
    ("raw", "exc_type", "code"),
    [
        (
            {"prumo_template": 2, "kind": "extraction", "name": "x", "sections": []},
            TemplateImportUnsupportedVersionError,
            "TEMPLATE_IMPORT_UNSUPPORTED_VERSION",
        ),
        (
            {"prumo_template": 1, "kind": "quality_assessment", "name": "x", "sections": []},
            TemplateImportWrongKindError,
            "TEMPLATE_IMPORT_WRONG_KIND",
        ),
        (
            {
                "prumo_template": 1,
                "kind": "extraction",
                "name": "x",
                "sections": [
                    {
                        "name": "sec",
                        "label": "S",
                        "fields": [{"name": "Bad", "label": "B", "type": "text"}],
                    }
                ],
            },
            TemplateImportInvalidError,
            "TEMPLATE_IMPORT_INVALID",
        ),
        ({}, TemplateImportUnsupportedVersionError, "TEMPLATE_IMPORT_UNSUPPORTED_VERSION"),
    ],
)
def test_parse_rejections_are_typed(raw, exc_type, code) -> None:
    with pytest.raises(exc_type) as exc:
        parse_portable_document(raw)
    assert exc.value.code == code and exc.value.status_code == 422


def test_reflected_values_are_truncated() -> None:
    with pytest.raises(TemplateImportUnsupportedVersionError) as exc:
        parse_portable_document({"prumo_template": "v" * 5000})
    assert len(exc.value.message) < 200


def test_invalid_document_lists_paths_in_message_and_details() -> None:
    raw = {
        "prumo_template": 1,
        "kind": "extraction",
        "name": "x",
        "sections": [
            {
                "name": "sec",
                "label": "S",
                "fields": [{"name": "Bad", "label": "B", "type": "text"}],
            },
            {"name": "two", "label": "T", "sections": [{"name": "child", "label": "C"}]},
        ],
    }
    with pytest.raises(TemplateImportInvalidError) as exc:
        parse_portable_document(raw)
    paths = [e["path"] for e in exc.value.details["errors"]]
    assert "sections[0].fields[0].name" in paths
    assert any(p.startswith("sections[1]") for p in paths)
    assert "sections[0].fields[0].name" in exc.value.message


def test_invalid_document_details_are_capped_at_20_entries() -> None:
    fields = [{"name": f"Bad{i}", "label": "B", "type": "text"} for i in range(30)]
    raw = {
        "prumo_template": 1,
        "kind": "extraction",
        "name": "x",
        "sections": [{"name": "sec", "label": "S", "fields": fields}],
    }
    with pytest.raises(TemplateImportInvalidError) as exc:
        parse_portable_document(raw)
    assert len(exc.value.details["errors"]) == 20
    assert exc.value.details["error_count"] == 30
    assert "+10 more" in exc.value.message


@pytest.mark.asyncio
async def test_rejected_import_writes_nothing(db_session: AsyncSession) -> None:
    """A document that passes Pydantic but violates a DB constraint must not
    leave a template row behind. Only reachable by bypassing the model (the
    llm_instruction_len CHECK mirrors the 4000 cap), so this test does."""
    from sqlalchemy.exc import IntegrityError

    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    before = await _count(
        db_session,
        "SELECT COUNT(*) FROM public.project_extraction_templates WHERE project_id = :pid",
        pid=str(project_id),
    )
    doc = PortableTemplate.model_construct(
        prumo_template=1,
        kind="extraction",
        name="x",
        description=None,
        framework="CUSTOM",
        version="1.0.0",
        llm_template_instruction="x" * 4001,
        sections=[PortableSection.model_validate({"name": "sec", "label": "S"})],
    )
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            await import_portable(
                db_session, project_id=project_id, doc=doc, user_id=SEED.primary_profile
            )
    after = await _count(
        db_session,
        "SELECT COUNT(*) FROM public.project_extraction_templates WHERE project_id = :pid",
        pid=str(project_id),
    )
    assert after == before


@pytest.mark.asyncio
async def test_export_refuses_template_outside_project(db_session: AsyncSession) -> None:
    """BOLA: a template id from another project 404s."""
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    with pytest.raises(ProjectTemplateNotFoundError):
        await to_portable(
            db_session, project_id=SEED.primary_project, template_id=clone.project_template_id
        )


@pytest.mark.asyncio
async def test_export_refuses_qa_template(db_session: AsyncSession) -> None:
    """v1 is extraction-only: a QA id must not leave as `kind: extraction`."""
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    probast = await _clone(
        db_session, project_id, PROBAST_GLOBAL_ID, TemplateKind.QUALITY_ASSESSMENT
    )
    with pytest.raises(ProjectTemplateNotFoundError):
        await to_portable(
            db_session, project_id=project_id, template_id=probast.project_template_id
        )


@pytest.mark.asyncio
async def test_export_of_unrepresentable_rows_is_typed(db_session: AsyncSession) -> None:
    """A legacy row the format cannot carry (here: empty allowed_values) is a
    typed 422 naming the path, never a 500."""
    project_id = SEED.secondary_project
    await clean_project_clones(db_session, project_id)
    clone = await clone_charms(db_session, project_id, SEED.primary_profile)
    await db_session.execute(
        text(
            "UPDATE public.extraction_fields SET allowed_values = '[]'::jsonb "
            "WHERE entity_type_id IN (SELECT id FROM public.extraction_entity_types "
            "WHERE project_template_id = :tid) AND name = 'model_name'"
        ),
        {"tid": str(clone.project_template_id)},
    )
    with pytest.raises(TemplateExportInvalidError) as exc:
        await to_portable(db_session, project_id=project_id, template_id=clone.project_template_id)
    assert isinstance(exc.value, AppError) and exc.value.status_code == 422
    assert exc.value.code == "TEMPLATE_EXPORT_INVALID"
    assert any("allowed_values" in e["path"] for e in exc.value.details["errors"])

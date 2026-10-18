"""Boot-time seed convergence, against the real database.

``seed_probast_ai`` UPDATEs its global row and REPLACES its children on every
run (spec 2026-08-26 §4), and the web container runs it on every deploy
(``backend/Dockerfile`` CMD). Three claims carry that design, and none of them
can be proven by the capturing doubles in ``tests/unit``:

1. it converges — re-running leaves an identical database, and a manual UPDATE
   to the global row is reverted, so the CODE is authoritative;
2. the DELETE is scoped — a project clone's own rows survive untouched, which
   is what makes replacing the catalogue's children safe at boot;
3. the replacement is identity-stable — deterministic ids, so a deploy does
   not churn 108 primary keys.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app import seed, seed_instrument
from app.models.extraction import ExtractionTemplateGlobal
from app.models.extraction_versioning import TemplateKind
from app.seed import (
    _CHARMS_CONDITIONAL_FIELDS,
    _CHARMS_RETIRED_FIELDS,
    _ET_PARTICIPANTS,
    converge_charms_global,
)
from app.seed_instruction_defaults import CHARMS_INSTRUCTION
from app.seed_instrument import converge_instrument_codes
from app.seed_probast_ai import _PROBAST_AI_TEMPLATE_ID, seed_probast_ai
from app.services.template_versioning import clone_template
from tests.integration.conftest import (
    CHARMS_GLOBAL_ID,
    SEED,
    clean_project_clones,
    clone_charms,
    set_config_draft_marker,
)

# NOTE: the COLUMN is `schema`; `schema_` is only the Python attribute name
# (``mapped_column("schema", ...)``). Getting this wrong makes every test in
# this file ERROR rather than fail, which is how it would prove nothing.
_TEMPLATE_SQL = text(
    'SELECT name, version, framework, kind, "schema", llm_template_instruction '
    "FROM public.extraction_templates_global WHERE id = :tid"
)

_CHILDREN_SQL = text(
    "SELECT et.id, et.name, et.sort_order, f.id, f.name, f.sort_order, "
    "       f.is_required, f.allowed_values, f.allows_no_information, "
    "       f.allows_not_applicable, f.llm_description "
    "FROM public.extraction_entity_types et "
    "LEFT JOIN public.extraction_fields f ON f.entity_type_id = et.id "
    "WHERE et.template_id = :tid "
    "ORDER BY et.sort_order, f.sort_order"
)


async def _catalogue(db: AsyncSession) -> tuple[Any, list[Any]]:
    """The converged shape, timestamps excluded.

    ``created_at``/``updated_at`` move on every write by design (``TimestampMixin``),
    so comparing them would make idempotence untestable while proving nothing.
    Ids ARE compared — they are derived, not random, and that is the point.
    """
    tid = {"tid": str(_PROBAST_AI_TEMPLATE_ID)}
    row = (await db.execute(_TEMPLATE_SQL, tid)).one()
    children = (await db.execute(_CHILDREN_SQL, tid)).all()
    return row, children


@pytest.mark.asyncio
async def test_seeding_twice_leaves_an_identical_catalogue(db_session: AsyncSession) -> None:
    await seed_probast_ai(db_session)
    await db_session.commit()
    before = await _catalogue(db_session)

    await seed_probast_ai(db_session)
    await db_session.commit()

    assert await _catalogue(db_session) == before
    _, children = before
    assert len({c[0] for c in children}) == 13
    assert len({c[3] for c in children}) == 95


@pytest.mark.asyncio
async def test_the_code_is_authoritative_over_a_manual_edit(db_session: AsyncSession) -> None:
    """A hand-UPDATE of the global row is reverted by the next boot.

    This is the point of converging rather than early-returning: before
    2.1.0 the seeder skipped an existing row, so a corrected spec could
    never reach a database that already held the template.
    """
    await seed_probast_ai(db_session)
    await db_session.commit()
    expected = await _catalogue(db_session)

    await db_session.execute(
        text(
            "UPDATE public.extraction_templates_global "
            "SET version = '9.9.9', \"schema\" = '{}'::jsonb WHERE id = :tid"
        ),
        {"tid": str(_PROBAST_AI_TEMPLATE_ID)},
    )
    await db_session.execute(
        text(
            "DELETE FROM public.extraction_fields WHERE entity_type_id IN ("
            "  SELECT id FROM public.extraction_entity_types WHERE template_id = :tid"
            ") AND name = 'study_type'"
        ),
        {"tid": str(_PROBAST_AI_TEMPLATE_ID)},
    )
    await db_session.commit()

    await seed_probast_ai(db_session)
    await db_session.commit()

    assert await _catalogue(db_session) == expected


@pytest.mark.asyncio
async def test_the_manager_instruction_survives_convergence(db_session: AsyncSession) -> None:
    """``llm_template_instruction`` is the manager-customized ✨ text (the
    Step-1 PICOTS every applicability judgment is made against). Converging
    writes the catalogue's own columns and must never clobber it."""
    await seed_probast_ai(db_session)
    await db_session.execute(
        text(
            "UPDATE public.extraction_templates_global "
            "SET llm_template_instruction = :t WHERE id = :tid"
        ),
        {"t": "PICOTS the manager wrote", "tid": str(_PROBAST_AI_TEMPLATE_ID)},
    )
    await db_session.commit()

    await seed_probast_ai(db_session)
    await db_session.commit()

    row, _ = await _catalogue(db_session)
    assert row.llm_template_instruction == "PICOTS the manager wrote"
    assert row.version == "2.2.0"


@pytest.mark.asyncio
async def test_convergence_leaves_project_clones_untouched(db_session: AsyncSession) -> None:
    """The safety claim behind replacing the catalogue's children at boot.

    A clone copies structure BY VALUE under fresh ids, so nothing outside the
    catalogue's own fields references a global entity type. If that ever broke,
    the RESTRICT FKs on ``extraction_fields.id`` would abort the boot instead of
    cascading into a project's recorded data — which is why this asserts the
    clone survives byte-identically rather than merely that the seed returned.
    """
    await seed_probast_ai(db_session)
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_template(
        db_session,
        project_id=SEED.secondary_project,
        global_template_id=_PROBAST_AI_TEMPLATE_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.QUALITY_ASSESSMENT,
    )
    await db_session.commit()

    clone_sql = text(
        "SELECT et.id, et.name, f.id, f.name, f.is_required, f.allows_no_information "
        "FROM public.extraction_entity_types et "
        "LEFT JOIN public.extraction_fields f ON f.entity_type_id = et.id "
        "WHERE et.project_template_id = :cid ORDER BY et.sort_order, f.sort_order"
    )
    before = (await db_session.execute(clone_sql, {"cid": str(clone.project_template_id)})).all()
    assert before, "clone produced no structure"
    versions_sql = text(
        "SELECT id, version, is_active FROM public.extraction_template_versions "
        "WHERE project_template_id = :cid ORDER BY version"
    )
    versions_before = (
        await db_session.execute(versions_sql, {"cid": str(clone.project_template_id)})
    ).all()
    assert versions_before, "clone published no version"

    await seed_probast_ai(db_session)
    await db_session.commit()

    assert (
        await db_session.execute(clone_sql, {"cid": str(clone.project_template_id)})
    ).all() == before
    # A changed global prompt never publishes a new version of the clone.
    assert (
        await db_session.execute(versions_sql, {"cid": str(clone.project_template_id)})
    ).all() == versions_before
    # The clone row itself still points at the global template: converging must
    # never delete the catalogue ROW, which would SET NULL this FK and break
    # clone dedupe on the next import.
    still_linked = (
        await db_session.execute(
            text(
                "SELECT global_template_id FROM public.project_extraction_templates WHERE id = :cid"
            ),
            {"cid": str(clone.project_template_id)},
        )
    ).scalar()
    assert still_linked == _PROBAST_AI_TEMPLATE_ID


@pytest.mark.asyncio
async def test_seeded_options_are_canonical(db_session: AsyncSession) -> None:
    """Every seeded option is a ``{value, label}`` item, never a bare string."""
    await seed_probast_ai(db_session)
    await db_session.flush()

    options = (
        (
            await db_session.execute(
                text(
                    "SELECT f.allowed_values FROM public.extraction_fields f "
                    "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
                    "WHERE et.template_id = :tid AND jsonb_typeof(f.allowed_values) <> 'null'"
                ),
                {"tid": str(_PROBAST_AI_TEMPLATE_ID)},
            )
        )
        .scalars()
        .all()
    )

    assert options  # the signaling questions carry options
    for allowed in options:
        assert isinstance(allowed, list) and allowed
        for item in allowed:
            assert isinstance(item, dict) and set(item) == {"value", "label"}
            assert item["value"] and item["label"]


# ---------------------------------------------------------------------------
# CHARMS: placeholder cleanup and optional conditional fields
# ---------------------------------------------------------------------------

_CHARMS_GLOBAL_FIELDS_SQL = text(
    "SELECT f.name, f.is_required FROM public.extraction_fields f "
    "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
    "WHERE et.template_id = :tid"
)
_CHARMS_CLONE_FIELDS_SQL = text(
    "SELECT f.name, f.is_required FROM public.extraction_fields f "
    "JOIN public.extraction_entity_types et ON et.id = f.entity_type_id "
    "WHERE et.project_template_id = :cid ORDER BY et.sort_order, f.sort_order"
)
_RETIRED = {"native_valve_endocarditis", "valve_affected", "characteristic_4", "characteristic_5"}
_CONDITIONAL = {
    "calibration_slope_value",
    "calibration_slope_ci",
    "calibration_in_large_value",
    "calibration_in_large_ci",
    "hosmer_lemeshow_p_value",
    "c_statistic_value",
    "c_statistic_ci",
    "d_statistic_value",
    "d_statistic_ci",
    "log_rank_test_p_value",
}


async def _charms_global_fields(db: AsyncSession) -> dict[str, bool]:
    rows = (await db.execute(_CHARMS_GLOBAL_FIELDS_SQL, {"tid": str(CHARMS_GLOBAL_ID)})).all()
    return dict(rows)


async def _plant_old_charms_catalogue(db: AsyncSession) -> None:
    """The catalogue an existing database carries from before the cleanup."""
    await db.execute(
        text(
            "DELETE FROM public.extraction_fields "
            "WHERE entity_type_id = :et AND name = 'participant_characteristics'"
        ),
        {"et": str(_ET_PARTICIPANTS)},
    )
    for sort, name in enumerate(sorted(_RETIRED), start=9):
        await db.execute(
            text(
                "INSERT INTO public.extraction_fields "
                "(id, entity_type_id, name, label, field_type, sort_order, is_required) "
                "VALUES (gen_random_uuid(), :et, :name, :name, 'text', :sort, true) "
                "ON CONFLICT (entity_type_id, name) DO NOTHING"
            ),
            {"et": str(_ET_PARTICIPANTS), "name": name, "sort": sort},
        )
    await db.execute(
        text(
            "UPDATE public.extraction_fields f SET is_required = true "
            "FROM public.extraction_entity_types et "
            "WHERE et.id = f.entity_type_id AND et.template_id = :tid AND f.name = ANY(:names)"
        ),
        {"tid": str(CHARMS_GLOBAL_ID), "names": sorted(_CONDITIONAL)},
    )
    await db.commit()


@pytest.mark.asyncio
async def test_charms_global_has_no_placeholder_fields(db_session: AsyncSession) -> None:
    await converge_charms_global(db_session)
    await db_session.commit()

    fields = await _charms_global_fields(db_session)
    assert fields, "CHARMS global template is not seeded"
    assert not _RETIRED & set(fields)
    assert fields["participant_characteristics"] is False
    assert _CHARMS_RETIRED_FIELDS == _RETIRED


@pytest.mark.asyncio
async def test_charms_conditional_fields_are_optional(db_session: AsyncSession) -> None:
    await converge_charms_global(db_session)
    await db_session.commit()

    fields = await _charms_global_fields(db_session)
    assert _CHARMS_CONDITIONAL_FIELDS == _CONDITIONAL
    for name in _CONDITIONAL:
        assert fields[name] is False, name


@pytest.mark.asyncio
async def test_converge_charms_on_an_old_catalogue_and_clones_untouched(
    db_session: AsyncSession,
) -> None:
    await _plant_old_charms_catalogue(db_session)
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    await db_session.commit()
    cid = {"cid": str(clone.project_template_id)}
    clone_before = (await db_session.execute(_CHARMS_CLONE_FIELDS_SQL, cid)).all()
    assert {name for name, _ in clone_before} >= _RETIRED

    await converge_charms_global(db_session)
    await db_session.commit()

    fields = await _charms_global_fields(db_session)
    assert not _RETIRED & set(fields)
    assert fields["participant_characteristics"] is False
    assert not any(fields[name] for name in _CONDITIONAL)
    assert (await db_session.execute(_CHARMS_CLONE_FIELDS_SQL, cid)).all() == clone_before


@pytest.mark.asyncio
async def test_converge_charms_twice_is_a_no_op(db_session: AsyncSession) -> None:
    await _plant_old_charms_catalogue(db_session)
    await converge_charms_global(db_session)
    await db_session.commit()
    before = set((await _charms_global_fields(db_session)).items())

    await converge_charms_global(db_session)
    await db_session.commit()

    assert set((await _charms_global_fields(db_session)).items()) == before


@pytest.mark.asyncio
async def test_fresh_clone_is_clean(db_session: AsyncSession) -> None:
    await _plant_old_charms_catalogue(db_session)
    await converge_charms_global(db_session)
    await clean_project_clones(db_session, SEED.secondary_project)
    clone = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    await db_session.commit()

    names = {
        name
        for name, _ in (
            await db_session.execute(
                _CHARMS_CLONE_FIELDS_SQL, {"cid": str(clone.project_template_id)}
            )
        ).all()
    }
    assert not _RETIRED & names
    assert "participant_characteristics" in names


@pytest.mark.asyncio
async def test_converge_charms_skips_a_referenced_catalogue(db_session: AsyncSession) -> None:
    """An instance on a global entity type downgrades the cleanup to a loud skip."""
    await _plant_old_charms_catalogue(db_session)
    await db_session.execute(
        text("UPDATE public.extraction_instances SET entity_type_id = :et WHERE id = :iid"),
        {"et": str(_ET_PARTICIPANTS), "iid": str(SEED.primary_instance)},
    )

    await converge_charms_global(db_session)
    await db_session.commit()

    assert set(await _charms_global_fields(db_session)) >= _RETIRED


_CLONE_INSTRUMENT_SQL = text(
    "SELECT instrument, config_draft_since FROM public.project_extraction_templates WHERE id = :cid"
)


@pytest.mark.asyncio
async def test_clone_inherits_and_converges_to_the_instrument_code(
    db_session: AsyncSession,
) -> None:
    """A clone copies its global's code; a drifted clone converges, idempotently.

    The draft marker is pinned because the instrument converge writes the
    template row only: the 0048 draft triggers live on entity types and
    fields, so a boot-time converge must never open a draft.
    """
    await seed_probast_ai(db_session)
    await converge_instrument_codes(db_session)
    await clean_project_clones(db_session, SEED.secondary_project)
    charms = await clone_charms(db_session, SEED.secondary_project, SEED.primary_profile)
    probast_ai = await clone_template(
        db_session,
        project_id=SEED.secondary_project,
        global_template_id=_PROBAST_AI_TEMPLATE_ID,
        user_id=SEED.primary_profile,
        kind=TemplateKind.QUALITY_ASSESSMENT,
    )
    charms_id = {"cid": str(charms.project_template_id)}
    pai_id = {"cid": str(probast_ai.project_template_id)}
    assert (await db_session.execute(_CLONE_INSTRUMENT_SQL, charms_id)).one().instrument == "charms"
    assert (
        await db_session.execute(_CLONE_INSTRUMENT_SQL, pai_id)
    ).one().instrument == "probast_ai"

    draft_at = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    await set_config_draft_marker(db_session, charms.project_template_id, None)
    await set_config_draft_marker(db_session, probast_ai.project_template_id, draft_at)
    await db_session.execute(
        text(
            "UPDATE public.project_extraction_templates SET instrument = 'custom' WHERE id = :cid"
        ),
        pai_id,
    )
    assert (await db_session.execute(_CLONE_INSTRUMENT_SQL, pai_id)).one().instrument == "custom"

    await converge_instrument_codes(db_session)
    after_first = (
        (await db_session.execute(_CLONE_INSTRUMENT_SQL, charms_id)).one(),
        (await db_session.execute(_CLONE_INSTRUMENT_SQL, pai_id)).one(),
    )
    assert tuple(after_first[0]) == ("charms", None)
    assert tuple(after_first[1]) == ("probast_ai", draft_at)

    await converge_instrument_codes(db_session)
    assert (
        (await db_session.execute(_CLONE_INSTRUMENT_SQL, charms_id)).one(),
        (await db_session.execute(_CLONE_INSTRUMENT_SQL, pai_id)).one(),
    ) == after_first


_FRESH_GLOBAL_ID = UUID("0f5e0000-0000-0000-0000-000000000001")


@pytest.mark.asyncio
async def test_converge_sees_globals_the_seeders_have_not_flushed(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``app.seed`` runs on ``AsyncSessionLocal`` (``autoflush=False``).

    On a fresh database every seeded global is still a pending INSERT when the
    converge pass runs, so a bulk UPDATE that does not flush first matches no
    row and the global ships as ``custom`` with no instruction (CI's fresh
    seed). A new global registered under a probe id replays that path.
    """
    monkeypatch.setattr(seed_instrument, "GLOBAL_INSTRUMENTS", {_FRESH_GLOBAL_ID: "charms"})
    monkeypatch.setitem(seed._LLM_TEMPLATE_INSTRUCTIONS, _FRESH_GLOBAL_ID, CHARMS_INSTRUCTION)
    monkeypatch.setitem(seed._RETIRED_LLM_TEMPLATE_INSTRUCTIONS, _FRESH_GLOBAL_ID, "")
    db_session.sync_session.autoflush = False
    db_session.add(
        ExtractionTemplateGlobal(
            id=_FRESH_GLOBAL_ID, name="Fresh seed probe", framework="CHARMS", version="1.0.0"
        )
    )

    await seed_instrument.converge_seeded_globals(db_session)
    await db_session.flush()

    row = (
        await db_session.execute(
            text(
                "SELECT instrument, llm_template_instruction "
                "FROM public.extraction_templates_global WHERE id = :tid"
            ),
            {"tid": str(_FRESH_GLOBAL_ID)},
        )
    ).one()
    assert tuple(row) == ("charms", CHARMS_INSTRUCTION)

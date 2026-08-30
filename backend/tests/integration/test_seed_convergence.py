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

from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import TemplateKind
from app.seed_probast_ai import _PROBAST_AI_TEMPLATE_ID, seed_probast_ai
from app.services.template_clone_service import TemplateCloneService
from tests.integration.conftest import SEED, clean_project_clones

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
    clone = await TemplateCloneService(db_session).clone(
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

    await seed_probast_ai(db_session)
    await db_session.commit()

    assert (
        await db_session.execute(clone_sql, {"cid": str(clone.project_template_id)})
    ).all() == before
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

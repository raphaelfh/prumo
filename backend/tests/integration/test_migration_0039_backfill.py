"""Data migration 0039: in-band disposition strings -> absent_reason marker.

Exercises BOTH directions with real rows present at each end, all inside the
rolled-back test transaction (a data migration's downgrade rewrites every row in
the DB, so it must NOT be driven via the ``alembic`` subprocess against the
shared dev DB). The migration's exact SQL is imported by file path.

Covers every branch the diff-cover gate needs:
- upgrade convert (full-word + PROBAST abbreviation, scoped by the frozen snapshot)
- coincidental free-text match on an out-of-domain field is left untouched
- an accept_proposal decision (value NULL) inherits from its migrated proposal
- downgrade restores the domain-correct string (PROBAST "NI", never full-word)
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED

_MIG_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "0039_absent_reason_backfill.py"
)
_spec = importlib.util.spec_from_file_location("mig0039", _MIG_PATH)
_mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mig)

_NO_INFO = {"value": None, "absent_reason": "no_information"}
_NOT_APPLICABLE = {"value": None, "absent_reason": "not_applicable"}


async def _run_stmts(db: AsyncSession, stmts: list[str]) -> None:
    for stmt in stmts:
        await db.execute(text(stmt))


async def _jsonb(db: AsyncSession, table: str, col: str, row_id) -> dict | None:
    return (
        await db.execute(
            text(f"SELECT {col} FROM public.{table} WHERE id = :id"), {"id": str(row_id)}
        )
    ).scalar()


@pytest.mark.asyncio
async def test_0039_backfills_dispositions_scoped_by_frozen_snapshot(
    db_session: AsyncSession,
) -> None:
    if (
        await db_session.execute(
            text("SELECT 1 FROM public.profiles WHERE id = :id"),
            {"id": str(SEED.primary_profile)},
        )
    ).scalar() is None:
        pytest.skip("seed not present")

    field_a = SEED.primary_field  # frozen domain will offer "No information"
    field_b = uuid4()  # PROBAST-style domain (has "NI"/"NA", not full-word)
    field_c = uuid4()  # a domain WITHOUT any disposition (coincidental match guard)

    # Real extraction_fields rows so the value-table FKs resolve.
    for fid, name, allowed in (
        (field_b, "probast_signal", ["Y", "PY", "PN", "N", "NI", "NA"]),
        (field_c, "study_design", ["cohort", "rct"]),
    ):
        await db_session.execute(
            text(
                "INSERT INTO public.extraction_fields "
                "(id, entity_type_id, name, label, field_type, is_required, "
                " allowed_values, sort_order, allow_other, created_at, updated_at) "
                "VALUES (:id, :et, :n, :n, 'select', false, CAST(:av AS jsonb), 50, false, now(), now())"
            ),
            {
                "id": str(fid),
                "et": str(SEED.primary_entity_type),
                "n": name,
                "av": json.dumps(allowed),
            },
        )

    run = await RunLifecycleService(db_session).create_run(
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        project_template_id=SEED.primary_template,
        user_id=SEED.primary_profile,
    )

    # Freeze a controlled snapshot the migration will scope by (only id +
    # allowed_values matter to 0039).
    snapshot = {
        "entity_types": [
            {
                "id": str(SEED.primary_entity_type),
                "fields": [
                    {"id": str(field_a), "allowed_values": ["Yes", "No", "No information"]},
                    {"id": str(field_b), "allowed_values": ["Y", "PY", "PN", "N", "NI", "NA"]},
                    {"id": str(field_c), "allowed_values": ["cohort", "rct"]},
                ],
            }
        ]
    }
    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET schema = CAST(:s AS jsonb) WHERE id = :v"
        ),
        {"s": json.dumps(snapshot), "v": str(run.version_id)},
    )

    inst = SEED.primary_instance
    p1, p2, d1, d2, ps1 = uuid4(), uuid4(), uuid4(), uuid4(), uuid4()

    # P1: proposal carrying a full-word disposition on field_a (in domain).
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_proposal_records "
            "(id, run_id, instance_id, field_id, source, proposed_value, created_at, updated_at) "
            "VALUES (:id, :r, :i, :f, 'ai', CAST(:v AS jsonb), now(), now())"
        ),
        {
            "id": str(p1),
            "r": str(run.id),
            "i": str(inst),
            "f": str(field_a),
            "v": json.dumps({"value": "No information"}),
        },
    )
    # P2: coincidental free-text "NA" on field_c whose domain lacks it → untouched.
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_proposal_records "
            "(id, run_id, instance_id, field_id, source, proposed_value, created_at, updated_at) "
            "VALUES (:id, :r, :i, :f, 'ai', CAST(:v AS jsonb), now(), now())"
        ),
        {
            "id": str(p2),
            "r": str(run.id),
            "i": str(inst),
            "f": str(field_c),
            "v": json.dumps({"value": "NA"}),
        },
    )
    # D1: reviewer edit carrying PROBAST "NI" on field_b (in domain).
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_reviewer_decisions "
            "(id, run_id, instance_id, field_id, reviewer_id, decision, value, created_at, updated_at) "
            "VALUES (:id, :r, :i, :f, :rev, 'edit', CAST(:v AS jsonb), now(), now())"
        ),
        {
            "id": str(d1),
            "r": str(run.id),
            "i": str(inst),
            "f": str(field_b),
            "rev": str(SEED.primary_profile),
            "v": json.dumps({"value": "NI"}),
        },
    )
    # D2: accept_proposal (value NULL) pointing at P1 → inherits, not double-handled.
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_reviewer_decisions "
            "(id, run_id, instance_id, field_id, reviewer_id, decision, proposal_record_id, "
            " value, created_at, updated_at) "
            "VALUES (:id, :r, :i, :f, :rev, 'accept_proposal', :p, NULL, now(), now())"
        ),
        {
            "id": str(d2),
            "r": str(run.id),
            "i": str(inst),
            "f": str(field_a),
            "rev": str(SEED.primary_profile),
            "p": str(p1),
        },
    )
    # PS1: published PROBAST "NA" on field_b → not_applicable.
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_published_states "
            "(id, run_id, instance_id, field_id, value, published_at, published_by, version, "
            " created_at, updated_at) "
            "VALUES (:id, :r, :i, :f, CAST(:v AS jsonb), now(), :pub, 1, now(), now())"
        ),
        {
            "id": str(ps1),
            "r": str(run.id),
            "i": str(inst),
            "f": str(field_b),
            "v": json.dumps({"value": "NA"}),
            "pub": str(SEED.primary_profile),
        },
    )
    await db_session.flush()

    # --- upgrade ---
    await _run_stmts(db_session, _mig.upgrade_statements())

    assert await _jsonb(db_session, "extraction_proposal_records", "proposed_value", p1) == _NO_INFO
    assert await _jsonb(db_session, "extraction_reviewer_decisions", "value", d1) == _NO_INFO
    assert await _jsonb(db_session, "extraction_published_states", "value", ps1) == _NOT_APPLICABLE
    # coincidental free-text is NOT corrupted
    assert await _jsonb(db_session, "extraction_proposal_records", "proposed_value", p2) == {
        "value": "NA"
    }
    # accept_proposal decision stays NULL (its meaning rode on the migrated proposal)
    assert await _jsonb(db_session, "extraction_reviewer_decisions", "value", d2) is None

    # --- upgrade is idempotent (re-run is a no-op) ---
    await _run_stmts(db_session, _mig.upgrade_statements())
    assert await _jsonb(db_session, "extraction_proposal_records", "proposed_value", p1) == _NO_INFO

    # --- downgrade restores the DOMAIN-CORRECT string (never a domain-invalid full-word) ---
    await _run_stmts(db_session, _mig.downgrade_statements())
    # field_a domain has "No information" → full-word restored
    assert await _jsonb(db_session, "extraction_proposal_records", "proposed_value", p1) == {
        "value": "No information"
    }
    # field_b domain has "NI"/"NA" (NOT the full words) → abbreviation restored
    assert await _jsonb(db_session, "extraction_reviewer_decisions", "value", d1) == {"value": "NI"}
    assert await _jsonb(db_session, "extraction_published_states", "value", ps1) == {"value": "NA"}

    await db_session.rollback()

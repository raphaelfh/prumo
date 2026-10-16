"""The value-envelope audit against a real database (Task 2.4a).

The envelope rule exists only as the reporter's SQL ``CASE``, so every kind
rule is proved by planting a row and reading its kind back through the
audit. Rows are inserted directly: the write paths refuse these shapes.
"""

from __future__ import annotations

import json
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionConsensusMode,
    ExtractionReviewerDecision,
    ExtractionReviewerDecisionType,
)
from app.services.value_envelope_audit import (
    EnvelopeViolation,
    TableAudit,
    audit_value_envelopes,
)
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import run_in_extract

pytestmark = pytest.mark.asyncio

REVIEWER = "extraction_reviewer_decisions"
CONSENSUS = "extraction_consensus_decisions"
PUBLISHED = "extraction_published_states"
PROPOSAL = "extraction_proposal_records"


async def _coordinate(db: AsyncSession) -> tuple[UUID, UUID, UUID]:
    """A run in EXTRACT plus one instance and field of its template."""
    run = await run_in_extract(db)
    pair = (
        await db.execute(
            text(
                "SELECT i.id, f.id FROM public.extraction_instances i "
                "JOIN public.extraction_fields f ON f.entity_type_id = i.entity_type_id "
                "WHERE i.template_id = :tid AND i.article_id = :aid "
                "ORDER BY i.id, f.id LIMIT 1"
            ),
            {"tid": str(SEED.primary_template), "aid": str(SEED.primary_article)},
        )
    ).one()
    return run.id, pair[0], pair[1]


async def _reviewer(db: AsyncSession, coord, value: object, *, days_ago: int = 0) -> UUID:
    run_id, instance_id, field_id = coord
    row_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_reviewer_decisions "
            "(id, run_id, instance_id, field_id, reviewer_id, decision, value, created_at) "
            "VALUES (:id, :rid, :iid, :fid, :rev, 'edit', CAST(:v AS jsonb), "
            "now() - make_interval(days => :days))"
        ),
        {
            "id": str(row_id),
            "rid": str(run_id),
            "iid": str(instance_id),
            "fid": str(field_id),
            "rev": str(SEED.primary_profile),
            "v": json.dumps(value),
            "days": days_ago,
        },
    )
    return row_id


async def _proposal(db: AsyncSession, coord, value: object) -> UUID:
    run_id, instance_id, field_id = coord
    row_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_proposal_records "
            "(id, run_id, instance_id, field_id, source, proposed_value) "
            "VALUES (:id, :rid, :iid, :fid, 'ai', CAST(:v AS jsonb))"
        ),
        {
            "id": str(row_id),
            "rid": str(run_id),
            "iid": str(instance_id),
            "fid": str(field_id),
            "v": json.dumps(value),
        },
    )
    return row_id


async def _consensus(db: AsyncSession, coord, value: object) -> UUID:
    run_id, instance_id, field_id = coord
    row_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_consensus_decisions "
            "(id, run_id, instance_id, field_id, consensus_user_id, mode, value) "
            "VALUES (:id, :rid, :iid, :fid, :cu, 'manual_override', CAST(:v AS jsonb))"
        ),
        {
            "id": str(row_id),
            "rid": str(run_id),
            "iid": str(instance_id),
            "fid": str(field_id),
            "cu": str(SEED.primary_profile),
            "v": json.dumps(value),
        },
    )
    return row_id


async def _published(db: AsyncSession, coord, value: object) -> UUID:
    run_id, instance_id, field_id = coord
    row_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.extraction_published_states "
            "(id, run_id, instance_id, field_id, value, published_by) "
            "VALUES (:id, :rid, :iid, :fid, CAST(:v AS jsonb), :pb)"
        ),
        {
            "id": str(row_id),
            "rid": str(run_id),
            "iid": str(instance_id),
            "fid": str(field_id),
            "pb": str(SEED.primary_profile),
            "v": json.dumps(value),
        },
    )
    return row_id


def _by_table(audits: list[TableAudit]) -> dict[str, TableAudit]:
    return {a.table: a for a in audits}


def _kind_of(audit: TableAudit, row_id: UUID) -> EnvelopeViolation | None:
    kinds = [kind for kind, ids in audit.sample_ids.items() if row_id in ids]
    assert len(kinds) <= 1
    return kinds[0] if kinds else None


async def test_clean_estate_reports_zero(db_session: AsyncSession) -> None:
    audits = await audit_value_envelopes(db_session)

    assert {a.table for a in audits} == {REVIEWER, CONSENSUS, PUBLISHED, PROPOSAL}
    for audit in audits:
        assert audit.counts == {}, audit
        assert audit.sample_ids == {}
        assert audit.last_30_days == 0


async def test_kind_rules(db_session: AsyncSession) -> None:
    coord = await _coordinate(db_session)
    shapes: list[tuple[object, EnvelopeViolation | None]] = [
        ({"value": 1}, None),
        ({"value": None, "absent_reason": "no_information"}, None),
        ({"value": 2, "unit": "mg"}, None),
        ({"value": {"value": 22, "unit": "mg"}}, None),
        ("x", EnvelopeViolation.NOT_OBJECT),
        ([1], EnvelopeViolation.NOT_OBJECT),
        ({"unit": "mg"}, EnvelopeViolation.MISSING_VALUE),
        ({"value": 1, "text": "y"}, EnvelopeViolation.UNKNOWN_KEY),
        ({"value": None, "absent_reason": "nope"}, EnvelopeViolation.BAD_ABSENT_REASON),
        ({"value": 1, "verification": {}}, EnvelopeViolation.VERIFICATION_OUTSIDE_PROPOSAL),
    ]
    planted = [(await _reviewer(db_session, coord, value), kind) for value, kind in shapes]
    proposal_with_verification = await _proposal(
        db_session, coord, {"value": 1, "verification": {}}
    )
    await db_session.flush()

    audits = _by_table(await audit_value_envelopes(db_session))

    assert [_kind_of(audits[REVIEWER], row_id) for row_id, _ in planted] == [
        kind for _, kind in shapes
    ]
    assert audits[REVIEWER].counts == {
        EnvelopeViolation.NOT_OBJECT: 2,
        EnvelopeViolation.MISSING_VALUE: 1,
        EnvelopeViolation.UNKNOWN_KEY: 1,
        EnvelopeViolation.BAD_ABSENT_REASON: 1,
        EnvelopeViolation.VERIFICATION_OUTSIDE_PROPOSAL: 1,
    }
    assert _kind_of(audits[PROPOSAL], proposal_with_verification) is None
    assert audits[PROPOSAL].counts == {}


async def test_planted_violators_are_found(db_session: AsyncSession) -> None:
    coord = await _coordinate(db_session)
    reviewer_id = await _reviewer(db_session, coord, {"value": 1, "text": "x"})
    old_reviewer_id = await _reviewer(db_session, coord, {"value": 1, "text": "old"}, days_ago=60)
    consensus_id = await _consensus(db_session, coord, "bare")
    published_id = await _published(db_session, coord, "bare")
    await _proposal(db_session, coord, {"value": 1, "verification": {}})
    proposal_id = await _proposal(db_session, coord, {"value": None, "absent_reason": "nope"})
    await db_session.flush()

    audits = _by_table(await audit_value_envelopes(db_session))

    assert audits[REVIEWER].counts == {EnvelopeViolation.UNKNOWN_KEY: 2}
    assert set(audits[REVIEWER].sample_ids[EnvelopeViolation.UNKNOWN_KEY]) == {
        reviewer_id,
        old_reviewer_id,
    }
    assert audits[REVIEWER].last_30_days == 1
    assert audits[CONSENSUS].counts == {EnvelopeViolation.NOT_OBJECT: 1}
    assert audits[CONSENSUS].sample_ids == {EnvelopeViolation.NOT_OBJECT: [consensus_id]}
    assert audits[CONSENSUS].last_30_days == 1
    assert audits[PUBLISHED].counts == {EnvelopeViolation.NOT_OBJECT: 1}
    assert audits[PUBLISHED].sample_ids == {EnvelopeViolation.NOT_OBJECT: [published_id]}
    assert audits[PUBLISHED].last_30_days == 1
    assert audits[PROPOSAL].counts == {EnvelopeViolation.BAD_ABSENT_REASON: 1}
    assert audits[PROPOSAL].sample_ids == {EnvelopeViolation.BAD_ABSENT_REASON: [proposal_id]}
    assert audits[PROPOSAL].last_30_days == 1


async def test_orm_written_no_value_rows_are_not_reported(db_session: AsyncSession) -> None:
    """The ORM stores ``value=None`` as jsonb ``'null'``, the app's "no value"."""
    run_id, instance_id, field_id = await _coordinate(db_session)
    reject = ExtractionReviewerDecision(
        run_id=run_id,
        instance_id=instance_id,
        field_id=field_id,
        reviewer_id=SEED.primary_profile,
        decision=ExtractionReviewerDecisionType.REJECT.value,
        value=None,
    )
    db_session.add(reject)
    await db_session.flush()
    db_session.add(
        ExtractionConsensusDecision(
            run_id=run_id,
            instance_id=instance_id,
            field_id=field_id,
            consensus_user_id=SEED.primary_profile,
            mode=ExtractionConsensusMode.SELECT_EXISTING.value,
            selected_decision_id=reject.id,
            value=None,
        )
    )
    await db_session.flush()
    stored = (
        await db_session.execute(
            text(
                "SELECT jsonb_typeof(value) FROM public.extraction_reviewer_decisions "
                "WHERE id = :id"
            ),
            {"id": str(reject.id)},
        )
    ).scalar_one()
    assert stored == "null"  # precondition: the row really holds a JSON null

    audits = _by_table(await audit_value_envelopes(db_session))

    assert audits[REVIEWER].counts == {}
    assert audits[CONSENSUS].counts == {}

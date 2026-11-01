"""Integration: the two cell loaders behind every export value (D10, R1).

Real Postgres, SEED graph. Each test builds its own run on the seed article
through the real review and consensus services; the SAVEPOINT rollback drops it.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionRun, ExtractionRunStage
from app.services.exports.descriptors import value_key
from app.services.extraction_consensus_service import ExtractionConsensusService
from app.services.extraction_export_service import ExportMode
from app.services.extraction_review_service import ExtractionReviewService
from app.services.extraction_snapshot import build_template_version_snapshot
from app.services.run_lifecycle_service import RunLifecycleService
from tests.integration.conftest import SEED, land_ai_proposal
from tests.integration.helpers.export_fixtures import export_service, make_run

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

_INST = SEED.primary_instance
_FIELD = SEED.primary_field


async def _extract_run(db: AsyncSession) -> ExtractionRun:
    run = await make_run(
        db,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
        template_id=SEED.primary_template,
        profile_id=SEED.primary_profile,
    )
    if run.stage == ExtractionRunStage.PENDING.value:
        await RunLifecycleService(db).advance_stage(
            run_id=run.id, target_stage=ExtractionRunStage.EXTRACT, user_id=SEED.primary_profile
        )
    return run


async def _ai_proposal(db: AsyncSession, run_id: UUID, value: Any) -> UUID:
    return (
        await land_ai_proposal(
            db, run_id=run_id, instance_id=_INST, field_id=_FIELD, proposed_value={"value": value}
        )
    ).id


async def _decide(db: AsyncSession, run_id: UUID, reviewer: UUID, decision: str, **kw: Any):
    return await ExtractionReviewService(db).record_decision(
        run_id=run_id, instance_id=_INST, field_id=_FIELD, reviewer_id=reviewer,
        decision=decision, **kw,
    )  # fmt: skip


async def _to_consensus(db: AsyncSession, run_id: UUID) -> None:
    await RunLifecycleService(db).advance_stage(
        run_id=run_id, target_stage=ExtractionRunStage.CONSENSUS, user_id=SEED.primary_profile
    )


async def _consensus(db: AsyncSession, run_id: UUID, mode: str, **kw: Any):
    decision, _ = await ExtractionConsensusService(db).record_consensus(
        run_id=run_id, instance_id=_INST, field_id=_FIELD,
        consensus_user_id=SEED.primary_profile, mode=mode, **kw,
    )  # fmt: skip
    return decision


def _svc(db: AsyncSession):
    return export_service(db, profile_id=SEED.primary_profile)


async def test_reviewer_loader_resolves_legacy_accept_to_its_proposal(
    db_session: AsyncSession,
) -> None:
    """``accept_proposal`` stores ``value=NULL``: the envelope is the proposal's."""
    run = await _extract_run(db_session)
    ai_pid = await _ai_proposal(db_session, run.id, 42)
    await _decide(
        db_session, run.id, SEED.primary_profile, "accept_proposal", proposal_record_id=ai_pid
    )

    cells = await _svc(db_session)._load_reviewer_cells(run_ids=[run.id], reviewer_ids=None)

    c = cells[value_key(run.id, _INST, _FIELD, SEED.primary_profile)]
    assert c.envelope == {"value": 42}
    assert c.decision.kind == "accept_proposal"
    assert c.linked_proposal is not None and c.linked_proposal.source == "ai"
    assert c.linked_proposal.id == ai_pid


async def test_reviewer_loader_keeps_reject_and_clear(db_session: AsyncSession) -> None:
    run = await _extract_run(db_session)
    await _decide(db_session, run.id, SEED.primary_profile, "reject")
    await _decide(db_session, run.id, SEED.reviewer_profile, "edit", value={"value": None})

    cells = await _svc(db_session)._load_reviewer_cells(run_ids=[run.id], reviewer_ids=None)

    key_a = value_key(run.id, _INST, _FIELD, SEED.primary_profile)
    key_b = value_key(run.id, _INST, _FIELD, SEED.reviewer_profile)
    assert cells[key_a].decision.kind == "reject" and cells[key_a].envelope is None
    assert cells[key_b].decision.kind == "edit" and cells[key_b].envelope is None


async def test_reviewer_loader_filters_on_reviewer_ids(db_session: AsyncSession) -> None:
    run = await _extract_run(db_session)
    await _decide(db_session, run.id, SEED.primary_profile, "edit", value={"value": 1})
    await _decide(db_session, run.id, SEED.reviewer_profile, "edit", value={"value": 2})

    cells = await _svc(db_session)._load_reviewer_cells(
        run_ids=[run.id], reviewer_ids=[SEED.reviewer_profile]
    )

    assert list(cells) == [value_key(run.id, _INST, _FIELD, SEED.reviewer_profile)]
    assert cells[value_key(run.id, _INST, _FIELD, SEED.reviewer_profile)].envelope == {"value": 2}


async def test_consensus_loader_reads_latest_decision(db_session: AsyncSession) -> None:
    run = await _extract_run(db_session)
    d = await _decide(db_session, run.id, SEED.primary_profile, "edit", value={"value": 42})
    await _to_consensus(db_session, run.id)
    first = await _consensus(db_session, run.id, "select_existing", selected_decision_id=d.id)
    await db_session.execute(
        text(
            "UPDATE public.extraction_consensus_decisions "
            "SET created_at = now() - interval '1 minute' WHERE id = :id"
        ),
        {"id": str(first.id)},
    )
    await _consensus(db_session, run.id, "manual_override", value={"value": 50})

    c = (await _svc(db_session)._load_consensus_cells(run_ids=[run.id]))[
        value_key(run.id, _INST, _FIELD)
    ]

    assert c.decision.kind == "manual_override" and c.envelope == {"value": 50}
    assert c.decision.actor_id == SEED.primary_profile
    assert c.linked_proposal is None


async def test_select_existing_uses_selected_decision_even_when_not_current(
    db_session: AsyncSession,
) -> None:
    """F4: A's linked d1 is selected after A's unlinked d2 became current."""
    run = await _extract_run(db_session)
    ai_pid = await _ai_proposal(db_session, run.id, 42)
    d1 = await _decide(
        db_session, run.id, SEED.primary_profile, "edit",
        value={"value": 42}, proposal_record_id=ai_pid,
    )  # fmt: skip
    d2 = await _decide(db_session, run.id, SEED.primary_profile, "edit", value={"value": 42})
    assert d2.id != d1.id  # precondition: d2 is A's current decision
    await _to_consensus(db_session, run.id)
    await _consensus(db_session, run.id, "select_existing", selected_decision_id=d1.id)

    c = (await _svc(db_session)._load_consensus_cells(run_ids=[run.id]))[
        value_key(run.id, _INST, _FIELD)
    ]

    assert c.decision.kind == "select_existing"
    assert c.decision.selected_decision_id == d1.id
    assert c.linked_proposal is not None and c.linked_proposal.id == ai_pid
    assert c.envelope == {"value": 42}


async def test_published_state_without_decision_still_yields_override_row(
    db_session: AsyncSession,
) -> None:
    """D10: legacy synthetic runs published states with no consensus decision."""
    run = await _extract_run(db_session)
    await _to_consensus(db_session, run.id)
    await _consensus(db_session, run.id, "manual_override", value={"value": 7})
    await db_session.execute(
        text("DELETE FROM public.extraction_consensus_decisions WHERE run_id = :r"),
        {"r": str(run.id)},
    )

    c = (await _svc(db_session)._load_consensus_cells(run_ids=[run.id]))[
        value_key(run.id, _INST, _FIELD)
    ]

    assert c.decision.kind == "manual_override"
    assert c.decision.actor_id == SEED.primary_profile
    assert c.decision.selected_decision_id is None and c.decision.rationale is None
    assert c.envelope == {"value": 7} and c.linked_proposal is None


async def _count_statements(db: AsyncSession, call: Callable[[], Awaitable[object]]) -> int:
    statements: list[str] = []

    def listener(_conn, _cursor, statement, _params, _context, _many) -> None:
        statements.append(statement)

    conn = (await db.connection()).sync_connection
    event.listen(conn, "before_cursor_execute", listener)
    try:
        await call()
    finally:
        event.remove(conn, "before_cursor_execute", listener)
    return len(statements)


async def test_loaders_issue_one_statement_each(db_session: AsyncSession) -> None:
    run = await _extract_run(db_session)
    ai_pid = await _ai_proposal(db_session, run.id, 42)
    d = await _decide(
        db_session, run.id, SEED.primary_profile, "accept_proposal", proposal_record_id=ai_pid
    )
    await _decide(db_session, run.id, SEED.reviewer_profile, "edit", value={"value": 3})
    await _to_consensus(db_session, run.id)
    await _consensus(db_session, run.id, "select_existing", selected_decision_id=d.id)
    svc = _svc(db_session)

    reviewer = await _count_statements(
        db_session, lambda: svc._load_reviewer_cells(run_ids=[run.id], reviewer_ids=None)
    )
    consensus = await _count_statements(
        db_session, lambda: svc._load_consensus_cells(run_ids=[run.id])
    )

    assert (reviewer, consensus) == (1, 1)


async def test_value_for_field_outside_every_loaded_version_is_kept(
    db_session: AsyncSession,
) -> None:
    """D10: a live field no loaded version holds still reaches the value map."""
    snapshot = await build_template_version_snapshot(db_session, SEED.primary_template)
    await db_session.execute(
        text(
            "UPDATE public.extraction_template_versions SET schema = CAST(:s AS jsonb) "
            "WHERE project_template_id = :tid AND is_active"
        ),
        {"s": __import__("json").dumps(snapshot), "tid": str(SEED.primary_template)},
    )
    new_fid = uuid4()
    await db_session.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required) "
            "VALUES (:id, :etid, 'late_field', 'Late field', 'text', false)"
        ),
        {"id": str(new_fid), "etid": str(SEED.primary_entity_type)},
    )
    run = await _extract_run(db_session)
    await ExtractionReviewService(db_session).record_decision(
        run_id=run.id, instance_id=_INST, field_id=new_fid, reviewer_id=SEED.primary_profile,
        decision="edit", value={"value": "kept"}, enforce_contract=False,
    )  # fmt: skip

    layout = await _svc(db_session).resolve_layout(
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        mode=ExportMode.SINGLE_USER,
        article_ids=[SEED.primary_article],
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        reviewer_id=SEED.primary_profile,
    )

    assert all(f.field_id != new_fid for v in layout.versions for s in v.sections for f in s.fields)
    v = layout.value_map[value_key(run.id, _INST, new_fid, SEED.primary_profile)]
    assert v.status == "answered" and v.raw == {"value": "kept"}


# ----------------------------------------------------------------------
# Project rater/pseudonym map (§6, D4)
# ----------------------------------------------------------------------


async def _only_this_run(db: AsyncSession) -> ExtractionRun:
    """A fresh EXTRACT run as the project's only run, so its actors are the
    map's only actors (the SAVEPOINT rollback restores the rest)."""
    await db.execute(
        text("DELETE FROM public.extraction_runs WHERE project_id = :pid"),
        {"pid": str(SEED.primary_project)},
    )
    return await _extract_run(db)


async def _set_decided_at(db: AsyncSession, decision_id: UUID, ts: datetime) -> None:
    await db.execute(
        text("UPDATE public.extraction_reviewer_decisions SET created_at = :ts WHERE id = :id"),
        {"ts": ts, "id": str(decision_id)},
    )


async def _set_full_name(db: AsyncSession, profile_id: UUID, name: str) -> None:
    await db.execute(
        text("UPDATE public.profiles SET full_name = :n WHERE id = :id"),
        {"n": name, "id": str(profile_id)},
    )


async def test_same_name_reviewers_get_distinct_raters(db_session: AsyncSession) -> None:
    run = await _only_this_run(db_session)
    for pid in (SEED.primary_profile, SEED.reviewer_profile):
        await _set_full_name(db_session, pid, "Alex Doe")
        await _decide(db_session, run.id, pid, "edit", value={"value": 1})

    labels = await _svc(db_session)._load_rater_labels(
        project_id=SEED.primary_project, anonymize=False
    )

    assert labels[SEED.primary_profile] != labels[SEED.reviewer_profile]
    assert labels[SEED.primary_profile].startswith("Alex Doe ")
    assert labels[SEED.reviewer_profile].startswith("Alex Doe ")


async def test_member_letters_follow_earliest_decision(db_session: AsyncSession) -> None:
    run = await _only_this_run(db_session)
    a = await _decide(db_session, run.id, SEED.primary_profile, "edit", value={"value": 1})
    b = await _decide(db_session, run.id, SEED.reviewer_profile, "edit", value={"value": 2})
    await _set_decided_at(db_session, a.id, datetime(2026, 1, 1, 0, 1, tzinfo=UTC))
    await _set_decided_at(db_session, b.id, datetime(2026, 1, 1, tzinfo=UTC))

    labels = await _svc(db_session)._load_rater_labels(
        project_id=SEED.primary_project, anonymize=True
    )

    assert (labels[SEED.reviewer_profile], labels[SEED.primary_profile]) == ("Member A", "Member B")


async def test_adjudicator_without_reviewer_decisions_is_labelled(
    db_session: AsyncSession,
) -> None:
    run = await _only_this_run(db_session)
    await _to_consensus(db_session, run.id)
    await _consensus(db_session, run.id, "manual_override", value={"value": 7})

    labels = await _svc(db_session)._load_rater_labels(
        project_id=SEED.primary_project, anonymize=True
    )

    assert labels == {SEED.primary_profile: "Member A"}


async def test_name_equal_to_consensus_is_suffixed(db_session: AsyncSession) -> None:
    run = await _only_this_run(db_session)
    await _set_full_name(db_session, SEED.primary_profile, "Consensus")
    await _decide(db_session, run.id, SEED.primary_profile, "edit", value={"value": 1})

    labels = await _svc(db_session)._load_rater_labels(
        project_id=SEED.primary_project, anonymize=False
    )

    assert labels[SEED.primary_profile] == f"Consensus {str(SEED.primary_profile).split('-')[0]}"


async def test_non_manager_sees_only_own_name(db_session: AsyncSession) -> None:
    run = await _only_this_run(db_session)
    await _decide(db_session, run.id, SEED.primary_profile, "edit", value={"value": 1})
    await _decide(db_session, run.id, SEED.reviewer_profile, "edit", value={"value": 2})

    labels = await _svc(db_session)._load_rater_labels(
        project_id=SEED.primary_project, anonymize=False, named_only=SEED.reviewer_profile
    )

    assert labels[SEED.reviewer_profile] == "Integration Reviewer"
    assert re.fullmatch(r"Member [A-Z]+", labels[SEED.primary_profile])


async def test_labels_ignore_other_projects(db_session: AsyncSession) -> None:
    """The project predicate sits in the WHERE clause: no foreign actor leaks in."""
    run = await _only_this_run(db_session)
    await _decide(db_session, run.id, SEED.primary_profile, "edit", value={"value": 1})

    labels = await _svc(db_session)._load_rater_labels(project_id=uuid4(), anonymize=True)

    assert labels == {}


async def test_non_manager_layout_pseudonymises_others(db_session: AsyncSession) -> None:
    """D4 wiring: a reviewer's single_user export names only the exporter."""
    run = await _only_this_run(db_session)
    await _decide(db_session, run.id, SEED.primary_profile, "edit", value={"value": 1})
    await _decide(db_session, run.id, SEED.reviewer_profile, "edit", value={"value": 2})

    layout = await export_service(db_session, profile_id=SEED.reviewer_profile).resolve_layout(
        project_id=SEED.primary_project,
        template_id=SEED.primary_template,
        mode=ExportMode.SINGLE_USER,
        article_ids=[SEED.primary_article],
        include_ai_metadata=False,
        anonymize_reviewer_names=False,
        reviewer_id=SEED.reviewer_profile,
    )

    assert layout.rater_labels[SEED.reviewer_profile] == "Integration Reviewer"
    assert re.fullmatch(r"Member [A-Z]+", layout.rater_labels[SEED.primary_profile])

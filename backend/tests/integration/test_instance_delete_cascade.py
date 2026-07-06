"""Instance deletion must cascade the whole HITL graph atomically.

Reproduces the production "Error removing instance" bug: a PostgREST-direct
``DELETE FROM extraction_instances`` on an instance that has AI-extracted
suggestions aborts with ``new row for relation "extraction_evidence" violates
check constraint "workflow_target_present"`` — the instance cascade deletes
its proposal records, whose ``ON DELETE SET NULL`` action strips the evidence
row of its only workflow target.

Behind that first error sit three RESTRICT constraints on the same cascade
diamond (reviewer_decisions.proposal_record_id from 0011, the reviewer_states
and consensus_decisions composite decision FKs from 0005/#81) — RESTRICT is
checked per cascaded row, so it aborts a same-statement whole-graph delete
even though every referencing row dies in the same transaction (the 0040
finding).

Migration 0044 fixes both layers: evidence target FKs become CASCADE
(evidence follows its sole workflow target — the exactly-one contract in
docs/reference/extraction-hitl-architecture.md), and the three RESTRICT FKs
become NO ACTION DEFERRABLE INITIALLY DEFERRED so the guarantee is enforced
at COMMIT (standalone deletes still fail; atomic graph deletes pass).

Uses ``db_session_real``: deferred checks only fire at a real COMMIT — the
SAVEPOINT fixture would false-pass. Cleanup deletes the run first (its
cascade removes evidence rows before proposals, so it is safe even while
the bug exists), then the instance.
"""

from __future__ import annotations

import uuid
from typing import NamedTuple

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED

pytestmark = pytest.mark.asyncio


class _Graph(NamedTuple):
    instance_id: uuid.UUID
    run_id: uuid.UUID
    proposal_id: uuid.UUID
    decision_id: uuid.UUID
    entity_type_id: uuid.UUID


async def _build_hitl_graph(db: AsyncSession) -> _Graph:
    """Create instance → run → AI proposal → evidence → accept decision →
    reviewer state → consensus selection, all on fresh UUIDs against the
    conftest SEED project/article (pickers scoped by project_id).

    Creates its own cardinality='many' entity type: the SEED entity type is
    cardinality='one' and already instantiated, so the instance-cardinality
    guard trigger would reject a second instance for it.
    """
    template_id = (
        await db.execute(
            text(
                "SELECT id FROM public.project_extraction_templates "
                "WHERE project_id = :pid AND kind = 'extraction' LIMIT 1"
            ),
            {"pid": str(SEED.primary_project)},
        )
    ).scalar_one()
    version_id = (
        await db.execute(
            text(
                "SELECT id FROM public.extraction_template_versions "
                "WHERE project_template_id = :tid AND is_active LIMIT 1"
            ),
            {"tid": str(template_id)},
        )
    ).scalar_one()

    graph = _Graph(
        instance_id=uuid.uuid4(),
        run_id=uuid.uuid4(),
        proposal_id=uuid.uuid4(),
        decision_id=uuid.uuid4(),
        entity_type_id=uuid.uuid4(),
    )
    field_id = uuid.uuid4()

    await db.execute(
        text(
            "INSERT INTO public.extraction_entity_types "
            "(id, project_template_id, name, label, cardinality, role, "
            " parent_entity_type_id, sort_order, is_required) "
            "VALUES (:id, :tid, 'delete_cascade_section', 'Delete Cascade Section', "
            " 'many', 'study_section', NULL, 99, false)"
        ),
        {"id": str(graph.entity_type_id), "tid": str(template_id)},
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_fields "
            "(id, entity_type_id, name, label, field_type, is_required) "
            "VALUES (:id, :etid, 'delete_cascade_field', 'Delete Cascade Field', "
            " 'text', false)"
        ),
        {"id": str(field_id), "etid": str(graph.entity_type_id)},
    )

    await db.execute(
        text(
            "INSERT INTO public.extraction_instances "
            "(id, project_id, template_id, entity_type_id, article_id, label, created_by) "
            "VALUES (:id, :pid, :tid, :etid, :aid, 'delete-cascade-test', :cb)"
        ),
        {
            "id": str(graph.instance_id),
            "pid": str(SEED.primary_project),
            "tid": str(template_id),
            "etid": str(graph.entity_type_id),
            "aid": str(SEED.primary_article),
            "cb": str(SEED.primary_profile),
        },
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_runs "
            "(id, project_id, article_id, template_id, version_id, kind, stage, "
            " status, created_by) "
            "VALUES (:id, :pid, :aid, :tid, :vid, 'extraction', 'extract', "
            " 'completed', :cb)"
        ),
        {
            "id": str(graph.run_id),
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "tid": str(template_id),
            "vid": str(version_id),
            "cb": str(SEED.primary_profile),
        },
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_proposal_records "
            "(id, run_id, instance_id, field_id, source, proposed_value) "
            "VALUES (:id, :rid, :inst, :fid, 'ai', '{}'::jsonb)"
        ),
        {
            "id": str(graph.proposal_id),
            "rid": str(graph.run_id),
            "inst": str(graph.instance_id),
            "fid": str(field_id),
        },
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_evidence "
            "(project_id, article_id, run_id, proposal_record_id, text_content, "
            " rank, created_by) "
            "VALUES (:pid, :aid, :rid, :prid, 'supporting quote', 0, :cb)"
        ),
        {
            "pid": str(SEED.primary_project),
            "aid": str(SEED.primary_article),
            "rid": str(graph.run_id),
            "prid": str(graph.proposal_id),
            "cb": str(SEED.primary_profile),
        },
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_reviewer_decisions "
            "(id, run_id, instance_id, field_id, reviewer_id, decision, proposal_record_id) "
            "VALUES (:id, :rid, :inst, :fid, :rev, 'accept_proposal', :prid)"
        ),
        {
            "id": str(graph.decision_id),
            "rid": str(graph.run_id),
            "inst": str(graph.instance_id),
            "fid": str(field_id),
            "rev": str(SEED.primary_profile),
            "prid": str(graph.proposal_id),
        },
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_reviewer_states "
            "(run_id, reviewer_id, instance_id, field_id, current_decision_id) "
            "VALUES (:rid, :rev, :inst, :fid, :did)"
        ),
        {
            "rid": str(graph.run_id),
            "rev": str(SEED.primary_profile),
            "inst": str(graph.instance_id),
            "fid": str(field_id),
            "did": str(graph.decision_id),
        },
    )
    await db.execute(
        text(
            "INSERT INTO public.extraction_consensus_decisions "
            "(run_id, instance_id, field_id, consensus_user_id, mode, selected_decision_id) "
            "VALUES (:rid, :inst, :fid, :cu, 'select_existing', :did)"
        ),
        {
            "rid": str(graph.run_id),
            "inst": str(graph.instance_id),
            "fid": str(field_id),
            "cu": str(SEED.primary_profile),
            "did": str(graph.decision_id),
        },
    )
    await db.commit()
    return graph


async def _cleanup(db: AsyncSession, graph: _Graph) -> None:
    """Best-effort teardown for the real-commit session. Deleting the run
    first cascades evidence before proposals (FK trigger creation order),
    so this path works even while the instance-delete bug exists."""
    await db.rollback()
    await db.execute(
        text("DELETE FROM public.extraction_runs WHERE id = :rid"),
        {"rid": str(graph.run_id)},
    )
    await db.execute(
        text("DELETE FROM public.extraction_instances WHERE id = :iid"),
        {"iid": str(graph.instance_id)},
    )
    await db.execute(
        text("DELETE FROM public.extraction_entity_types WHERE id = :etid"),
        {"etid": str(graph.entity_type_id)},
    )
    await db.commit()


async def _count(db: AsyncSession, table: str, column: str, value: uuid.UUID) -> int:
    return (
        await db.execute(
            text(f"SELECT count(*) FROM public.{table} WHERE {column} = :v"),  # noqa: S608
            {"v": str(value)},
        )
    ).scalar_one()


async def test_delete_instance_with_full_hitl_graph_succeeds(
    db_session_real: AsyncSession,
) -> None:
    """The production repro: deleting an instance that carries AI proposals,
    evidence, an accepted decision, a reviewer state, and a consensus
    selection must succeed and remove the whole instance-scoped graph."""
    graph = await _build_hitl_graph(db_session_real)
    try:
        await db_session_real.execute(
            text("DELETE FROM public.extraction_instances WHERE id = :iid"),
            {"iid": str(graph.instance_id)},
        )
        await db_session_real.commit()

        assert await _count(db_session_real, "extraction_instances", "id", graph.instance_id) == 0
        assert (
            await _count(
                db_session_real, "extraction_proposal_records", "instance_id", graph.instance_id
            )
            == 0
        )
        assert (
            await _count(
                db_session_real, "extraction_evidence", "proposal_record_id", graph.proposal_id
            )
            == 0
        )
        assert (
            await _count(
                db_session_real, "extraction_reviewer_decisions", "instance_id", graph.instance_id
            )
            == 0
        )
        assert (
            await _count(
                db_session_real, "extraction_reviewer_states", "instance_id", graph.instance_id
            )
            == 0
        )
        assert (
            await _count(
                db_session_real, "extraction_consensus_decisions", "instance_id", graph.instance_id
            )
            == 0
        )
        # The run itself is article-scoped, not instance-scoped: it survives.
        assert await _count(db_session_real, "extraction_runs", "id", graph.run_id) == 1
    finally:
        await _cleanup(db_session_real, graph)


async def test_standalone_proposal_delete_still_blocked(
    db_session_real: AsyncSession,
) -> None:
    """The 0011 guarantee survives the deferral: deleting a proposal that an
    accept_proposal decision references — without deleting the decision —
    must still fail (now at COMMIT instead of immediately)."""
    graph = await _build_hitl_graph(db_session_real)
    try:
        with pytest.raises(IntegrityError):
            await db_session_real.execute(
                text("DELETE FROM public.extraction_proposal_records WHERE id = :prid"),
                {"prid": str(graph.proposal_id)},
            )
            await db_session_real.commit()
    finally:
        await _cleanup(db_session_real, graph)

"""API-only writes and append-only history (migration 0081).

The article-text and extraction-history tables are written by the backend
only. ``authenticated`` keeps SELECT on all of them (and DELETE on
``article_files``) while INSERT/UPDATE/DELETE are revoked, so a member JWT is
refused by the missing privilege before any RLS policy is consulted. The
policies stay as the floor under any future grant.

Three history tables are append-only for every role except the table owner:
a trigger refuses UPDATE and DELETE from any other role. FK cascades and the
backend run as the owner, so instance/article deletes still cascade.

Grants are invisible to mocks, so this runs against real Postgres at head.
Probe helpers come from ``test_config_write_grant_revoked`` (migration 0054).
"""

from __future__ import annotations

import json
import uuid
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED
from tests.integration.test_config_write_grant_revoked import Outcome, _attempt
from tests.integration.test_instance_delete_cascade import (
    _build_hitl_graph,
    _cleanup,
    _count,
)

_ALL_WRITES = (
    "article_text_blocks",
    "extraction_evidence",
    "extraction_reviewer_decisions",
    "extraction_consensus_decisions",
    "extraction_reviewer_states",
    "extraction_published_states",
    "extraction_proposal_records",
)
_REVOKED = [("article_files", "INSERT"), ("article_files", "UPDATE")] + [
    (t, v) for t in _ALL_WRITES for v in ("INSERT", "UPDATE", "DELETE")
]


# =================== 1. Catalogue: the privileges are gone ===================


@pytest.mark.asyncio
@pytest.mark.parametrize(("table", "verb"), _REVOKED)
async def test_privilege_revoked(db_session: AsyncSession, table: str, verb: str) -> None:
    granted = (
        await db_session.execute(
            text("SELECT has_table_privilege('authenticated', :t, :v)"),
            {"t": f"public.{table}", "v": verb},
        )
    ).scalar_one()
    assert granted is False, f"authenticated still holds {verb} on public.{table}"


# has_table_privilege ignores column grants, so the proposal-record cases above
# were already false before this migration (0056 moved INSERT/UPDATE to columns).
# This probe proves the column-level grants are gone too.
@pytest.mark.asyncio
@pytest.mark.parametrize("verb", ["INSERT", "UPDATE"])
async def test_proposal_record_column_grants_revoked(db_session: AsyncSession, verb: str) -> None:
    any_column = (
        await db_session.execute(
            text(
                "SELECT has_any_column_privilege('authenticated', "
                "'public.extraction_proposal_records', :v)"
            ),
            {"v": verb},
        )
    ).scalar_one()
    assert any_column is False, f"authenticated still holds column-level {verb} on proposals"


@pytest.mark.asyncio
async def test_article_files_delete_kept(db_session: AsyncSession) -> None:
    assert (
        await db_session.execute(
            text("SELECT has_table_privilege('authenticated', 'public.article_files', 'DELETE')")
        )
    ).scalar_one() is True


# =================== 2. Refusals are privilege errors ===================


def _assert_privilege_refusal(outcome: Outcome) -> None:
    assert outcome.error is not None, f"the write was not refused (outcome={outcome})"
    # InsufficientPrivilegeError is asyncpg's name for SQLSTATE 42501.
    assert "InsufficientPrivilegeError" in outcome.error, outcome.error
    assert "permission denied for table" in outcome.error, outcome.error
    assert "row-level security" not in outcome.error, outcome.error


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sql", "params"),
    [
        pytest.param(
            "UPDATE public.article_text_blocks SET text = 'probe' WHERE id = :id",
            {"id": str(uuid.uuid4())},
            id="update-text-block",
        ),
        pytest.param(
            "INSERT INTO public.extraction_evidence "
            "(project_id, article_id, run_id, proposal_record_id, text_content, rank, created_by) "
            "VALUES (:pid, :aid, :rid, :prid, 'probe', 0, :cb)",
            {
                "pid": str(SEED.primary_project),
                "aid": str(SEED.primary_article),
                "rid": str(uuid.uuid4()),
                "prid": str(uuid.uuid4()),
                "cb": str(SEED.reviewer_profile),
            },
            id="insert-evidence",
        ),
        pytest.param(
            "UPDATE public.extraction_reviewer_decisions SET rationale = 'probe' WHERE id = :id",
            {"id": str(uuid.uuid4())},
            id="update-reviewer-decision",
        ),
        pytest.param(
            "UPDATE public.extraction_proposal_records "
            "SET proposed_value = '{}'::jsonb WHERE id = :id",
            {"id": str(uuid.uuid4())},
            id="update-proposal-value",
        ),
    ],
)
async def test_reviewer_write_refused_by_privilege(
    db_session: AsyncSession, sql: str, params: dict[str, str]
) -> None:
    outcome = await _attempt(db_session, user_id=SEED.reviewer_profile, sql=sql, params=params)
    _assert_privilege_refusal(outcome)


@pytest.mark.asyncio
async def test_viewer_article_file_update_refused_by_privilege(db_session: AsyncSession) -> None:
    await db_session.execute(
        text(
            "INSERT INTO public.project_members (project_id, user_id, role) "
            "VALUES (:pid, :uid, 'viewer')"
        ),
        {"pid": str(SEED.primary_project), "uid": str(SEED.outsider_profile)},
    )
    try:
        outcome = await _attempt(
            db_session,
            user_id=SEED.outsider_profile,
            sql="UPDATE public.article_files SET content_markdown = 'probe' WHERE article_id = :aid",
            params={"aid": str(SEED.primary_article)},
        )
        _assert_privilege_refusal(outcome)
    finally:
        await db_session.execute(
            text("DELETE FROM public.project_members WHERE project_id = :pid AND user_id = :uid"),
            {"pid": str(SEED.primary_project), "uid": str(SEED.outsider_profile)},
        )


# =================== 3. Reads still work ===================


@pytest.mark.asyncio
@pytest.mark.parametrize("table", ("article_files", *_ALL_WRITES))
async def test_member_can_still_read(db_session: AsyncSession, table: str) -> None:
    outcome = await _attempt(
        db_session,
        user_id=SEED.reviewer_profile,
        sql=f"SELECT count(*) FROM public.{table}",  # noqa: S608
        params={},
    )
    assert outcome.error is None, f"reading public.{table} as a member failed: {outcome.error}"


# =================== 4. Cascades still work ===================


async def _commit_as(db: AsyncSession, *, user_id: UUID, sql: str, params: dict[str, str]) -> None:
    """Committing helper: deferred FK checks fire only at a real COMMIT."""
    await db.execute(
        text("SELECT set_config('request.jwt.claims', :c, true)"),
        {"c": json.dumps({"sub": str(user_id), "role": "authenticated"})},
    )
    await db.execute(text("SET LOCAL ROLE authenticated"))
    await db.execute(text(sql), params)
    await db.commit()


async def _insert_article_file(db: AsyncSession, *, article_id: UUID) -> tuple[UUID, UUID]:
    """One article file with one text block on ``article_id``; returns their ids."""
    file_id, block_id = uuid.uuid4(), uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.article_files (id, project_id, article_id, file_type, storage_key) "
            "VALUES (:id, :pid, :aid, 'pdf', :key)"
        ),
        {
            "id": str(file_id),
            "pid": str(SEED.primary_project),
            "aid": str(article_id),
            "key": f"grant-probe/{file_id}.pdf",
        },
    )
    await db.execute(
        text(
            "INSERT INTO public.article_text_blocks "
            "(id, article_file_id, page_number, block_index, text, char_start, char_end, "
            " bbox, block_type) "
            "VALUES (:id, :fid, 1, 0, 'probe', 0, 5, '{}'::jsonb, 'paragraph')"
        ),
        {"id": str(block_id), "fid": str(file_id)},
    )
    return file_id, block_id


@pytest.mark.asyncio
async def test_manager_instance_delete_cascades_history(db_session_real: AsyncSession) -> None:
    graph = await _build_hitl_graph(db_session_real)
    try:
        await _commit_as(
            db_session_real,
            user_id=SEED.primary_profile,
            sql="DELETE FROM public.extraction_instances WHERE id = :iid",
            params={"iid": str(graph.instance_id)},
        )
        db = db_session_real
        assert await _count(db, "extraction_instances", "id", graph.instance_id) == 0
        assert (
            await _count(db, "extraction_proposal_records", "instance_id", graph.instance_id) == 0
        )
        assert await _count(db, "extraction_evidence", "proposal_record_id", graph.proposal_id) == 0
        assert (
            await _count(db, "extraction_reviewer_decisions", "instance_id", graph.instance_id) == 0
        )
        assert await _count(db, "extraction_reviewer_states", "instance_id", graph.instance_id) == 0
        assert (
            await _count(db, "extraction_consensus_decisions", "instance_id", graph.instance_id)
            == 0
        )
    finally:
        await _cleanup(db_session_real, graph)


@pytest.mark.asyncio
async def test_manager_article_delete_cascades_text(db_session_real: AsyncSession) -> None:
    db = db_session_real
    article_id = uuid.uuid4()
    await db.execute(
        text("INSERT INTO public.articles (id, project_id, title) VALUES (:id, :pid, 'probe')"),
        {"id": str(article_id), "pid": str(SEED.primary_project)},
    )
    file_id, _ = await _insert_article_file(db, article_id=article_id)
    await db.commit()
    try:
        await _commit_as(
            db,
            user_id=SEED.primary_profile,
            sql="DELETE FROM public.articles WHERE id = :id",
            params={"id": str(article_id)},
        )
        assert await _count(db, "articles", "id", article_id) == 0
        assert await _count(db, "article_files", "article_id", article_id) == 0
        assert await _count(db, "article_text_blocks", "article_file_id", file_id) == 0
    finally:
        await db.rollback()
        await db.execute(
            text("DELETE FROM public.articles WHERE id = :id"), {"id": str(article_id)}
        )
        await db.commit()


@pytest.mark.asyncio
async def test_member_article_file_delete_cascades(db_session_real: AsyncSession) -> None:
    db = db_session_real
    graph = await _build_hitl_graph(db)
    file_id, _ = await _insert_article_file(db, article_id=SEED.primary_article)
    await db.execute(
        text(
            "UPDATE public.extraction_evidence SET article_file_id = :fid "
            "WHERE proposal_record_id = :prid"
        ),
        {"fid": str(file_id), "prid": str(graph.proposal_id)},
    )
    await db.commit()
    try:
        await _commit_as(
            db,
            user_id=SEED.reviewer_profile,
            sql="DELETE FROM public.article_files WHERE id = :id",
            params={"id": str(file_id)},
        )
        assert await _count(db, "article_files", "id", file_id) == 0
        assert await _count(db, "article_text_blocks", "article_file_id", file_id) == 0
        file_refs = (
            await db.execute(
                text(
                    "SELECT count(*) AS n, count(article_file_id) AS linked "
                    "FROM public.extraction_evidence WHERE proposal_record_id = :prid"
                ),
                {"prid": str(graph.proposal_id)},
            )
        ).one()
        assert (file_refs.n, file_refs.linked) == (1, 0), file_refs
    finally:
        await db.rollback()
        await db.execute(
            text("DELETE FROM public.article_files WHERE id = :id"), {"id": str(file_id)}
        )
        await db.commit()
        await _cleanup(db, graph)


# =================== 5. Append-only trigger ===================


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "sql",
    [
        pytest.param(
            "UPDATE public.extraction_reviewer_decisions SET rationale = 'x' WHERE id = :id",
            id="update",
        ),
        pytest.param(
            "DELETE FROM public.extraction_reviewer_decisions WHERE id = :id", id="delete"
        ),
    ],
)
async def test_append_only_trigger_refuses_non_owner(db_session: AsyncSession, sql: str) -> None:
    graph = await _build_hitl_graph(db_session)
    await db_session.commit()
    try:
        # The CI stub's service_role may lack the privilege; grant it inside the
        # rolled-back transaction so the trigger, not the ACL, is what refuses.
        await db_session.execute(
            text("GRANT UPDATE, DELETE ON public.extraction_reviewer_decisions TO service_role")
        )
        await db_session.execute(text("SET LOCAL ROLE service_role"))
        with pytest.raises(DBAPIError, match="append-only table"):
            await db_session.execute(text(sql), {"id": str(graph.decision_id)})
    finally:
        await db_session.rollback()

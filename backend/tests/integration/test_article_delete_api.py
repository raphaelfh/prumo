"""POST /api/v1/projects/{id}/articles/delete — rows first, then storage.

The browser used to remove the PDFs from storage and THEN delete the rows,
and the ``articles_delete`` RLS policy lets only a manager delete rows: a
reviewer's delete wiped the PDFs while every row survived. These tests pin the
fix: manager-only, the whole batch or nothing, and storage touched only after
the rows are gone and committed.
"""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_supabase
from app.main import app
from app.models.extraction_attempt import ExtractionAttempt
from tests.integration.conftest import SEED
from tests.integration.helpers import engine_setup

client_as_manager = engine_setup.client_as_manager
client_as_outsider = engine_setup.client_as_outsider
client_as_reviewer = engine_setup.client_as_reviewer

_URL = "/api/v1/projects/{pid}/articles/delete"


@pytest.fixture
def supabase() -> Iterator[MagicMock]:
    """A test-local Supabase client. Request it AFTER the client fixtures: each of
    them installs its own ``get_supabase`` override, and the last one set wins."""
    mock = MagicMock()
    app.dependency_overrides[get_supabase] = lambda: mock
    yield mock
    app.dependency_overrides.pop(get_supabase, None)


def _remove(mock: MagicMock) -> MagicMock:
    return mock.storage.from_.return_value.remove


def _body(*ids: UUID) -> dict[str, object]:
    return {"selection": {"mode": "ids", "ids": [str(i) for i in ids]}}


async def _insert_article(
    db: AsyncSession, project_id: UUID = SEED.primary_project, *, storage_key: str | None = None
) -> UUID:
    article_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'delete-probe', 1)"
        ),
        {"id": str(article_id), "pid": str(project_id)},
    )
    if storage_key is not None:
        await db.execute(
            text(
                "INSERT INTO public.article_files "
                "(project_id, article_id, file_type, storage_key, file_role) "
                "VALUES (:pid, :aid, 'application/pdf', :key, 'MAIN')"
            ),
            {"pid": str(project_id), "aid": str(article_id), "key": storage_key},
        )
    return article_id


async def _count(db: AsyncSession, table: str, column: str, value: UUID) -> int:
    return (
        await db.execute(
            text(f"SELECT count(*) FROM public.{table} WHERE {column} = :v"),  # noqa: S608 — test-local names
            {"v": str(value)},
        )
    ).scalar_one()


async def test_gate_order(
    db_session: AsyncSession,
    client_as_manager: AsyncClient,
    client_as_reviewer: AsyncClient,
    client_as_outsider: AsyncClient,
    supabase: MagicMock,
) -> None:
    key = f"{SEED.primary_project}/gate-{uuid4()}.pdf"
    article_id = await _insert_article(db_session, storage_key=key)
    url = _URL.format(pid=SEED.primary_project)

    reviewer = await client_as_reviewer.post(url, json=_body(article_id))
    outsider = await client_as_outsider.post(url, json=_body(article_id))
    missing = await client_as_manager.post(_URL.format(pid=uuid4()), json=_body(article_id))

    assert reviewer.status_code == 403, reviewer.text
    assert outsider.status_code == 404, outsider.text
    assert missing.status_code == 404, missing.text
    assert missing.json()["error"] == outsider.json()["error"]
    assert await _count(db_session, "articles", "id", article_id) == 1
    assert await _count(db_session, "article_files", "article_id", article_id) == 1
    _remove(supabase).assert_not_called()


async def test_manager_deletes_rows_then_storage(
    db_session: AsyncSession, client_as_manager: AsyncClient, supabase: MagicMock
) -> None:
    key = f"{SEED.primary_project}/ok-{uuid4()}.pdf"
    article_id = await _insert_article(db_session, storage_key=key)
    assert await _count(db_session, "article_files", "article_id", article_id) == 1  # precondition

    res = await client_as_manager.post(
        _URL.format(pid=SEED.primary_project), json=_body(article_id)
    )

    assert res.status_code == 200, res.text
    assert res.json()["data"] == {"deleted": 1, "storage_failures": 0}
    assert await _count(db_session, "articles", "id", article_id) == 0
    assert await _count(db_session, "article_files", "article_id", article_id) == 0
    supabase.storage.from_.assert_called_once_with("articles")
    _remove(supabase).assert_called_once_with([key])


async def test_foreign_id_refuses_whole_batch(
    db_session: AsyncSession, client_as_manager: AsyncClient, supabase: MagicMock
) -> None:
    own = await _insert_article(db_session, storage_key=f"{SEED.primary_project}/own-{uuid4()}.pdf")
    foreign = await _insert_article(db_session, SEED.secondary_project)

    for other in (foreign, uuid4()):
        res = await client_as_manager.post(
            _URL.format(pid=SEED.primary_project), json=_body(own, other)
        )
        assert res.status_code == 404, res.text

    assert await _count(db_session, "articles", "id", own) == 1
    assert await _count(db_session, "articles", "id", foreign) == 1
    _remove(supabase).assert_not_called()


async def test_storage_failure_still_succeeds(
    db_session: AsyncSession, client_as_manager: AsyncClient, supabase: MagicMock
) -> None:
    key = f"{SEED.primary_project}/boom-{uuid4()}.pdf"
    article_id = await _insert_article(db_session, storage_key=key)
    _remove(supabase).side_effect = RuntimeError("storage down")

    res = await client_as_manager.post(
        _URL.format(pid=SEED.primary_project), json=_body(article_id)
    )

    assert res.status_code == 200, res.text
    assert res.json()["data"] == {"deleted": 1, "storage_failures": 1}
    assert await _count(db_session, "articles", "id", article_id) == 0
    _remove(supabase).assert_called_once_with([key])


async def test_article_without_files_makes_no_storage_call(
    db_session: AsyncSession, client_as_manager: AsyncClient, supabase: MagicMock
) -> None:
    article_id = await _insert_article(db_session)

    res = await client_as_manager.post(
        _URL.format(pid=SEED.primary_project), json=_body(article_id)
    )

    assert res.status_code == 200, res.text
    assert res.json()["data"] == {"deleted": 1, "storage_failures": 0}
    assert await _count(db_session, "articles", "id", article_id) == 0
    _remove(supabase).assert_not_called()


async def test_article_with_extraction_run_deletes(
    db_session: AsyncSession, client_as_manager: AsyncClient, supabase: MagicMock
) -> None:
    """``extraction_attempts.article_id`` is a DEFERRED FK with no ondelete: the
    attempt goes with its run, so the check only passes if the run cascade removed it."""
    del supabase
    article_id = await _insert_article(db_session)
    run = await engine_setup.run_in_extract_at(
        db_session,
        project_id=SEED.primary_project,
        article_id=article_id,
        template_id=SEED.primary_template,
    )
    db_session.add(
        ExtractionAttempt(
            request_id=uuid4(),
            owner_id=SEED.primary_profile,
            project_id=run.project_id,
            article_id=article_id,
            template_id=run.template_id,
            run_id=run.id,
            request_payload={},
        )
    )
    await db_session.flush()
    assert await _count(db_session, "extraction_attempts", "run_id", run.id) == 1  # precondition

    res = await client_as_manager.post(
        _URL.format(pid=SEED.primary_project), json=_body(article_id)
    )
    await db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))

    assert res.status_code == 200, res.text
    assert await _count(db_session, "extraction_runs", "id", run.id) == 0
    assert await _count(db_session, "extraction_attempts", "run_id", run.id) == 0
    assert await _count(db_session, "articles", "id", article_id) == 0


@pytest.mark.parametrize(
    "ids", [[], [str(uuid4()) for _ in range(10_001)]], ids=["empty", "over-cap"]
)
async def test_schema_bounds(client_as_manager: AsyncClient, ids: list[str]) -> None:
    res = await client_as_manager.post(
        _URL.format(pid=SEED.primary_project), json={"selection": {"mode": "ids", "ids": ids}}
    )

    assert res.status_code == 422, res.text

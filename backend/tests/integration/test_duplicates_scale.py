"""The duplicates read at 10,000 articles: a loose ceiling that catches an all-pairs blow-up.

The local timing is printed (run with ``-s``) and recorded in the PR body (spec §9).
"""

from __future__ import annotations

import time
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models.article import Article
from tests.integration.conftest import SEED
from tests.integration.helpers.engine_setup import client_as
from tests.integration.helpers.shared_fixtures import make_project

_ARTICLES = 10_000
_PMID_PAIRS = 300
_TITLE_PAIRS = 300


def _rows(project_id: UUID) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(_ARTICLES):
        row: dict[str, Any] = {
            "id": uuid4(),
            "project_id": project_id,
            "title": f"Unique article number {i} about a distinct topic",
            "publication_year": 2000 + i % 25,
            "pmid": str(1_000_000 + i),
            "doi": f"10.1000/unique.{i}",
        }
        if i < 2 * _PMID_PAIRS:
            row["pmid"] = str(500_000 + i // 2)
            row["doi"] = None
        elif i < 2 * (_PMID_PAIRS + _TITLE_PAIRS):
            row["title"] = f"Shared title of duplicated study {i // 2}"
            row["publication_year"] = 2020
            row["pmid"] = None
            row["doi"] = None
        rows.append(row)
    return rows


@pytest.mark.performance
async def test_duplicates_read_at_10k(db_session: AsyncSession) -> None:
    db = db_session
    project_id = await make_project(db)
    await db.execute(insert(Article), _rows(project_id))
    await db.flush()

    try:
        async with client_as(str(SEED.primary_profile), db) as client:
            started = time.perf_counter()
            response = await client.get(f"/api/v1/projects/{project_id}/duplicates")
            ms = (time.perf_counter() - started) * 1000
    finally:
        app.dependency_overrides.clear()

    print(f"duplicates read 10k: {ms:.0f} ms")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert len(data["open"]) == _PMID_PAIRS + _TITLE_PAIRS
    assert [p["tier"] for p in data["open"]].count("exact") == _PMID_PAIRS
    assert ms < 15_000

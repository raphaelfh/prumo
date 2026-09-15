"""owned_article: the one article-in-project pair guard.

Scope in the WHERE clause, so foreign and missing are indistinguishable —
no existence oracle (`.claude/rules/backend.md` § Ownership guards).
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.article_read_service import ArticleNotFoundError, owned_article, owned_articles
from tests.integration.conftest import SEED


async def _article_in(db: AsyncSession, project_id: UUID, title: str) -> UUID:
    article_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, :t, 1)"
        ),
        {"id": str(article_id), "pid": str(project_id), "t": title},
    )
    await db.flush()
    return article_id


@pytest.mark.asyncio
async def test_owned_article_returns_the_id_in_scope(db_session: AsyncSession) -> None:
    article_id = await _article_in(db_session, SEED.primary_project, "In scope")
    got = await owned_article(db_session, project_id=SEED.primary_project, article_id=article_id)
    assert got == article_id


@pytest.mark.asyncio
async def test_a_foreign_article_is_refused_like_a_missing_one(db_session: AsyncSession) -> None:
    foreign = await _article_in(db_session, SEED.secondary_project, "Other project")
    missing = uuid4()

    # PRECONDITION: the foreign row really exists, in the other project.
    # Without this the test would pass against a guard that simply cannot
    # find anything, proving nothing about leak-freedom.
    owner = (
        await db_session.execute(
            text("SELECT project_id FROM public.articles WHERE id = :id"),
            {"id": str(foreign)},
        )
    ).scalar_one()
    assert owner == SEED.secondary_project

    with pytest.raises(ArticleNotFoundError) as foreign_exc:
        await owned_article(db_session, project_id=SEED.primary_project, article_id=foreign)
    with pytest.raises(ArticleNotFoundError) as missing_exc:
        await owned_article(db_session, project_id=SEED.primary_project, article_id=missing)

    # One message template; only the echoed id differs.
    assert str(foreign_exc.value).replace(str(foreign), "<id>") == str(missing_exc.value).replace(
        str(missing), "<id>"
    )
    # The owning project never leaks.
    assert str(SEED.secondary_project) not in str(foreign_exc.value)


async def _second_article(db: AsyncSession):
    article_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.articles (id, project_id, title, row_version) "
            "VALUES (:id, :pid, 'owned_articles test', 1)"
        ),
        {"id": str(article_id), "pid": str(SEED.primary_project)},
    )
    return article_id


@pytest.mark.asyncio
async def test_owned_articles_returns_deduplicated_ids_in_order(db_session: AsyncSession) -> None:
    second = await _second_article(db_session)

    got = await owned_articles(
        db_session,
        project_id=SEED.primary_project,
        article_ids=[second, SEED.primary_article, second],
    )
    assert got == [second, SEED.primary_article]


@pytest.mark.asyncio
async def test_owned_articles_refuses_a_foreign_or_missing_id(db_session: AsyncSession) -> None:

    with pytest.raises(ArticleNotFoundError):
        await owned_articles(
            db_session, project_id=SEED.secondary_project, article_ids=[SEED.primary_article]
        )
    with pytest.raises(ArticleNotFoundError):
        await owned_articles(
            db_session, project_id=SEED.primary_project, article_ids=[SEED.primary_article, uuid4()]
        )


@pytest.mark.asyncio
async def test_owned_article_still_answers_one_id(db_session: AsyncSession) -> None:
    assert (
        await owned_article(
            db_session, project_id=SEED.primary_project, article_id=SEED.primary_article
        )
        == SEED.primary_article
    )

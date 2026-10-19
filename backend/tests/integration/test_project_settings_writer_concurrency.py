"""Concurrent ``projects.settings`` saves keep every sub-key.

``projects.settings`` is one JSONB column shared by four sub-key owners
(``llm_engine``, ``parsing``, ``managers_see_reviewers``, ``ai_context``).
Every save is a read-modify-write of the whole column, so two saves on the
same project serialize on the project row: the second waits for the first
to commit, then writes on top of it instead of over it.

Real sessions and real commits (shape of ``test_hitl_session_concurrency``)
on a throwaway project, because the seeded projects are shared with every
other suite. Sessions are built like the app's (``autoflush=False``): an ORM
re-read that discards an unflushed edit only shows up there.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator, Awaitable, Callable
from typing import Any
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.repositories.project_repository import ProjectRepository
from app.services import (
    llm_engine_service,
    manager_review_visibility_service,
    parser_settings_service,
    project_ai_context,
)
from app.services.llm_engine_service import LlmEngineService
from app.services.manager_review_visibility_service import ManagerReviewVisibilityService
from app.services.parser_settings_service import ParserSettingsService
from app.services.project_ai_context import set_ai_context
from tests.integration.conftest import SEED

#: A project row before any manager saved a setting: the column's server
#: default, which existing rows still carry. A save of another key keeps it.
_UNTOUCHED = {"blind_mode": False}

_PICOTS = {
    "population": {
        "description": "Adults admitted with sepsis",
        "inclusion": ["age >= 18"],
        "exclusion": [],
    }
}

Write = Callable[[AsyncSession], Awaitable[Any]]


@pytest_asyncio.fixture
async def session_factory() -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
    engine = create_async_engine(settings.async_database_url, echo=False, pool_pre_ping=True)
    # Mirrors ``app.core.deps.AsyncSessionLocal``.
    yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)
    await engine.dispose()


@pytest_asyncio.fixture
async def project_id(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[UUID, None]:
    pid = uuid4()
    async with session_factory() as db:
        await db.execute(
            text(
                "INSERT INTO public.projects (id, name, created_by_id, settings) "
                "VALUES (:id, 'settings-writer-race', :uid, CAST(:settings AS jsonb))"
            ),
            {"id": str(pid), "uid": str(SEED.primary_profile), "settings": json.dumps(_UNTOUCHED)},
        )
        await db.commit()
    try:
        yield pid
    finally:
        async with session_factory() as db:
            await db.execute(text("DELETE FROM public.projects WHERE id = :id"), {"id": str(pid)})
            await db.commit()


async def _read_row(
    session_factory: async_sessionmaker[AsyncSession], project_id: UUID
) -> tuple[dict[str, Any], Any]:
    """``(settings, picots_config_ai_review)`` as committed, from a fresh session."""
    async with session_factory() as db:
        row = (
            await db.execute(
                text(
                    "SELECT settings, picots_config_ai_review FROM public.projects WHERE id = :id"
                ),
                {"id": str(project_id)},
            )
        ).one()
    return row.settings, row.picots_config_ai_review


async def _race(
    session_factory: async_sessionmaker[AsyncSession], first: Write, second: Write
) -> None:
    """``first`` saves and keeps its transaction open; ``second`` must wait on
    the project row until ``first`` commits, then save and commit."""
    async with session_factory() as session_a, session_factory() as session_b:
        await first(session_a)
        task_b = asyncio.create_task(second(session_b))
        try:
            await asyncio.sleep(0.2)
            assert not task_b.done(), "the second save did not wait for the first one's row lock"
            await session_a.commit()
            await asyncio.wait_for(task_b, timeout=10)
            await session_b.commit()
        finally:
            if not task_b.done():
                task_b.cancel()


def _save_engine(db: AsyncSession, project_id: UUID) -> Awaitable[Any]:
    return LlmEngineService(db).set_for_project(
        project_id=project_id,
        provider="openai",
        model="gpt-5.6-terra",
        mode="fast",
        updated_by=SEED.primary_profile,
    )


def _save_parsing(db: AsyncSession, project_id: UUID) -> Awaitable[Any]:
    return ParserSettingsService(db).set_for_project(project_id=project_id, parser_type="docling")


def _save_visibility(db: AsyncSession, project_id: UUID) -> Awaitable[Any]:
    return ManagerReviewVisibilityService(db).set_for_project(
        project_id=project_id, kind="extraction", value=True
    )


def _save_ai_switch(db: AsyncSession, project_id: UUID) -> Awaitable[Any]:
    return set_ai_context(db, project_id, picots=None, picots_enabled=True)


@pytest.mark.asyncio
async def test_engine_and_parsing_saves_both_survive(
    session_factory: async_sessionmaker[AsyncSession], project_id: UUID
) -> None:
    await _race(
        session_factory,
        lambda db: _save_engine(db, project_id),
        lambda db: _save_parsing(db, project_id),
    )

    stored, _ = await _read_row(session_factory, project_id)
    assert set(stored) == {"blind_mode", "llm_engine", "parsing"}
    assert stored["llm_engine"]["model"] == "gpt-5.6-terra"
    assert stored["parsing"] == {"type": "docling"}
    assert stored["blind_mode"] is False


@pytest.mark.asyncio
async def test_ai_context_and_visibility_saves_both_survive(
    session_factory: async_sessionmaker[AsyncSession], project_id: UUID
) -> None:
    await _race(
        session_factory,
        lambda db: _save_ai_switch(db, project_id),
        lambda db: _save_visibility(db, project_id),
    )

    stored, _ = await _read_row(session_factory, project_id)
    assert stored == {
        "blind_mode": False,
        "ai_context": {"picots": True},
        "managers_see_reviewers": {"extraction": True, "quality_assessment": False},
    }


@pytest.mark.asyncio
async def test_picots_only_and_parsing_saves_both_survive(
    session_factory: async_sessionmaker[AsyncSession], project_id: UUID
) -> None:
    await _race(
        session_factory,
        lambda db: set_ai_context(db, project_id, picots=_PICOTS, picots_enabled=None),
        lambda db: _save_parsing(db, project_id),
    )

    stored, picots = await _read_row(session_factory, project_id)
    assert stored == {"blind_mode": False, "parsing": {"type": "docling"}}
    assert picots == _PICOTS


@pytest.mark.asyncio
async def test_a_save_in_a_session_holding_an_older_copy_writes_on_the_committed_row(
    session_factory: async_sessionmaker[AsyncSession], project_id: UUID
) -> None:
    """Session B still holds the project it loaded before A's save committed;
    B's own save must start from the committed row, not from that copy."""
    async with session_factory() as session_b:
        held = await ProjectRepository(session_b).get_by_id(project_id)
        assert held is not None and "llm_engine" not in held.settings
        async with session_factory() as session_a:
            await _save_engine(session_a, project_id)
            await session_a.commit()
        await _save_parsing(session_b, project_id)
        await session_b.commit()

    stored, _ = await _read_row(session_factory, project_id)
    assert set(stored) == {"blind_mode", "llm_engine", "parsing"}


@pytest.mark.asyncio
async def test_ai_context_saves_both_halves_in_one_call(
    session_factory: async_sessionmaker[AsyncSession], project_id: UUID
) -> None:
    """The question and the switch in one save, on an app-configured session:
    the settings write re-reads the locked row, and that re-read must not
    discard the question assigned in the same call."""
    async with session_factory() as db:
        await set_ai_context(db, project_id, picots=_PICOTS, picots_enabled=False)
        await db.commit()

    stored, picots = await _read_row(session_factory, project_id)
    assert picots == _PICOTS
    assert stored == {"blind_mode": False, "ai_context": {"picots": False}}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("save", "not_found"),
    [
        (_save_engine, llm_engine_service.ProjectNotFoundError),
        (_save_parsing, parser_settings_service.ProjectNotFoundError),
        (_save_visibility, manager_review_visibility_service.ProjectNotFoundError),
        (_save_ai_switch, project_ai_context.ProjectNotFoundError),
    ],
    ids=["llm_engine", "parsing", "managers_see_reviewers", "ai_context"],
)
async def test_missing_project_still_not_found(
    session_factory: async_sessionmaker[AsyncSession],
    save: Callable[[AsyncSession, UUID], Awaitable[Any]],
    not_found: type[Exception],
) -> None:
    async with session_factory() as db:
        with pytest.raises(not_found):
            await save(db, uuid4())

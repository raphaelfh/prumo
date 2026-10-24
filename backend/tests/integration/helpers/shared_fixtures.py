"""Integration helpers shared by the PubMed import and screening suites.

One home for the fixture-backed PubMed client and the throwaway project, so
the import, screening and PRISMA suites drive the same setup instead of
private copies that drift apart.
"""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID, uuid4

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.services.pubmed_client import PubMedClient
from tests.integration.conftest import SEED

FIXTURE_XML: Path = Path(__file__).resolve().parents[2] / "fixtures" / "pubmed" / "efetch_batch.xml"

Handler = Callable[[httpx.Request], httpx.Response | Awaitable[httpx.Response]]


def _fixture_response(_request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, content=FIXTURE_XML.read_bytes())


async def _no_sleep(_seconds: float) -> None:
    return None


def fixture_client(
    handler: Handler | None = None, *, email: str = "dev@prumo.test"
) -> PubMedClient:
    """A PubMed client over ``httpx.MockTransport``; the default answers the fixture XML."""
    return PubMedClient(
        email=email,
        transport=httpx.MockTransport(handler or _fixture_response),  # type: ignore[arg-type]
        sleep=_no_sleep,
    )


def barrier_handler(barrier: asyncio.Barrier, inner: Handler | None = None) -> Handler:
    """Hold every request until ``barrier`` fills, then answer like ``inner``.

    Two clients sharing one barrier both hold their records before either
    reaches the write lock, which is the race the import must survive.
    """
    answer = inner or _fixture_response

    async def handler(request: httpx.Request) -> httpx.Response:
        async with asyncio.timeout(5):
            await barrier.wait()
        response = answer(request)
        if inspect.isawaitable(response):
            response = await response
        return response

    return handler


async def make_project(db: AsyncSession, *, manager: UUID = SEED.primary_profile) -> UUID:
    """A fresh project with ``manager`` as its manager; flush only."""
    project_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.projects (id, name, created_by_id) VALUES (:id, :name, :created_by)"
        ),
        {"id": str(project_id), "name": f"throwaway {project_id}", "created_by": str(manager)},
    )
    await db.execute(
        text(
            "INSERT INTO public.project_members (id, project_id, user_id, role) "
            "VALUES (gen_random_uuid(), :pid, :uid, 'manager')"
        ),
        {"pid": str(project_id), "uid": str(manager)},
    )
    await db.flush()
    return project_id


@asynccontextmanager
async def throwaway_project(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    manager: UUID = SEED.primary_profile,
) -> AsyncIterator[UUID]:
    """A committed project for real-commit tests, deleted (with its cascade) on exit."""
    async with session_factory() as session:
        project_id = await make_project(session, manager=manager)
        await session.commit()
    try:
        yield project_id
    finally:
        async with session_factory() as session:
            await session.execute(
                text("DELETE FROM public.projects WHERE id = :pid"), {"pid": str(project_id)}
            )
            await session.commit()

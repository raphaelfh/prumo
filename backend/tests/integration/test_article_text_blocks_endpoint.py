"""API contract tests for `GET /api/v1/article-files/{file_id}/text-blocks`.

The endpoint feeds the PDF viewer's typography reader view; population
of `article_text_blocks` is Phase 6 of the ingestion pipeline. Until
now there was no integration test asserting:
- the empty list returned for an unprocessed file
- the `(page_number, block_index)` ordering contract the viewer relies on
- the camelCase wire shape
- 404 for unknown files / 403 for non-members

`article_files` rows are not part of the integration seed, so each test
inserts its own and cleans up via the SAVEPOINT-isolated `db_session`.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import TokenPayload, get_current_user
from app.main import app
from tests.integration.conftest import SEED


@pytest_asyncio.fixture
async def auth_as_primary_member(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Override `get_current_user` so JWT sub matches a real seed profile."""
    del db_session
    profile_id = SEED.primary_profile

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="primary@integration-test.prumo.local",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    yield profile_id


@pytest_asyncio.fixture
async def auth_as_outsider(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    """Authenticated user with no project memberships."""
    outsider_id = uuid.uuid4()
    email = f"outsider-{outsider_id}@text-blocks-test.local"

    await db_session.execute(
        text(
            "INSERT INTO auth.users (id, email, instance_id, aud, role) "
            "VALUES (:id, :email, '00000000-0000-0000-0000-000000000000', "
            "'authenticated', 'authenticated')"
        ),
        {"id": str(outsider_id), "email": email},
    )
    await db_session.execute(
        text(
            "INSERT INTO public.profiles (id, email, full_name) "
            "VALUES (:id, :email, 'Text Blocks Outsider') "
            "ON CONFLICT (id) DO NOTHING"
        ),
        {"id": str(outsider_id), "email": email},
    )
    await db_session.commit()

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(outsider_id),
            email=email,
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    try:
        yield outsider_id
    finally:
        await db_session.execute(
            text("DELETE FROM public.profiles WHERE id = :id"),
            {"id": str(outsider_id)},
        )
        await db_session.execute(
            text("DELETE FROM auth.users WHERE id = :id"),
            {"id": str(outsider_id)},
        )
        await db_session.commit()


async def _insert_article_file(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
) -> UUID:
    file_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.article_files "
            "(id, project_id, article_id, file_type, storage_key, file_role) "
            "VALUES (:id, :pid, :aid, 'pdf', :key, 'MAIN')"
        ),
        {
            "id": str(file_id),
            "pid": str(project_id),
            "aid": str(article_id),
            "key": f"test/{file_id}.pdf",
        },
    )
    await db.commit()
    return file_id


async def _insert_text_block(
    db: AsyncSession,
    *,
    article_file_id: UUID,
    page_number: int,
    block_index: int,
    text_content: str,
    char_start: int = 0,
    char_end: int = 0,
    block_type: str = "paragraph",
) -> UUID:
    block_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO public.article_text_blocks "
            "(id, article_file_id, page_number, block_index, text, "
            " char_start, char_end, bbox, block_type) "
            "VALUES (:id, :fid, :page, :idx, :txt, :cs, :ce, "
            ' \'{"x": 0, "y": 0, "width": 100, "height": 20}\'::jsonb, :bt)'
        ),
        {
            "id": str(block_id),
            "fid": str(article_file_id),
            "page": page_number,
            "idx": block_index,
            "txt": text_content,
            "cs": char_start,
            "ce": char_end,
            "bt": block_type,
        },
    )
    return block_id


@pytest.mark.asyncio
async def test_list_text_blocks_returns_empty_for_unprocessed_file(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_primary_member: UUID,
) -> None:
    """Unprocessed (no rows in `article_text_blocks`) returns []."""
    del auth_as_primary_member
    file_id = await _insert_article_file(
        db_session,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )

    res = await db_client.get(f"/api/v1/article-files/{file_id}/text-blocks")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["data"] == []


@pytest.mark.asyncio
async def test_list_text_blocks_returns_blocks_in_reading_order(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_primary_member: UUID,
) -> None:
    """Rows are ordered by (page_number asc, block_index asc).

    Insert deliberately out of order to ensure the ORDER BY clause —
    not insertion order — drives the response.
    """
    del auth_as_primary_member
    file_id = await _insert_article_file(
        db_session,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    await _insert_text_block(
        db_session,
        article_file_id=file_id,
        page_number=2,
        block_index=0,
        text_content="page2-block0",
    )
    await _insert_text_block(
        db_session,
        article_file_id=file_id,
        page_number=1,
        block_index=1,
        text_content="page1-block1",
    )
    await _insert_text_block(
        db_session,
        article_file_id=file_id,
        page_number=1,
        block_index=0,
        text_content="page1-block0",
    )
    await db_session.commit()

    res = await db_client.get(f"/api/v1/article-files/{file_id}/text-blocks")

    assert res.status_code == 200, res.text
    blocks = res.json()["data"]
    assert [b["text"] for b in blocks] == [
        "page1-block0",
        "page1-block1",
        "page2-block0",
    ]


@pytest.mark.asyncio
async def test_list_text_blocks_uses_camelcase_wire_shape(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_primary_member: UUID,
) -> None:
    """Response keys match the PDF viewer's runtime types (camelCase)."""
    del auth_as_primary_member
    file_id = await _insert_article_file(
        db_session,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )
    await _insert_text_block(
        db_session,
        article_file_id=file_id,
        page_number=1,
        block_index=0,
        text_content="hello",
        char_start=0,
        char_end=5,
    )
    await db_session.commit()

    res = await db_client.get(f"/api/v1/article-files/{file_id}/text-blocks")

    block = res.json()["data"][0]
    assert set(block.keys()) == {
        "id",
        "pageNumber",
        "blockIndex",
        "text",
        "charStart",
        "charEnd",
        "bbox",
        "blockType",
    }
    assert block["pageNumber"] == 1
    assert block["blockIndex"] == 0
    assert block["charStart"] == 0
    assert block["charEnd"] == 5
    assert block["blockType"] == "paragraph"
    assert block["bbox"] == {"x": 0, "y": 0, "width": 100, "height": 20}


@pytest.mark.asyncio
async def test_list_text_blocks_returns_404_for_unknown_file(
    db_client: AsyncClient,
    auth_as_primary_member: UUID,
) -> None:
    del auth_as_primary_member
    unknown_id = uuid.uuid4()

    res = await db_client.get(f"/api/v1/article-files/{unknown_id}/text-blocks")

    assert res.status_code == 404, res.text
    assert str(unknown_id) in res.json()["detail"]


@pytest.mark.asyncio
async def test_list_text_blocks_returns_403_for_non_project_member(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_outsider: UUID,
) -> None:
    """Non-members get 403 even when the file id is valid."""
    del auth_as_outsider
    file_id = await _insert_article_file(
        db_session,
        project_id=SEED.primary_project,
        article_id=SEED.primary_article,
    )

    res = await db_client.get(f"/api/v1/article-files/{file_id}/text-blocks")

    assert res.status_code == 403, res.text

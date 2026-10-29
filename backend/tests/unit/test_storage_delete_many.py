"""Unit tests for batched storage removal (`StorageAdapter.delete_many`)."""

# ruff: noqa: ARG002  (abstract-method stubs ignore most arguments)

from unittest.mock import MagicMock

import pytest

from app.infrastructure.storage.base import StorageAdapter
from app.infrastructure.storage.supabase_storage import SupabaseStorageAdapter


def _paths(n: int) -> list[str]:
    return [f"project/article-{i}.pdf" for i in range(n)]


@pytest.mark.asyncio
async def test_delete_many_chunks_by_1000() -> None:
    client = MagicMock()
    remove = client.storage.from_.return_value.remove
    adapter = SupabaseStorageAdapter(client)

    failed = await adapter.delete_many("articles", _paths(2500))

    assert failed == []
    client.storage.from_.assert_called_with("articles")
    assert [len(call.args[0]) for call in remove.call_args_list] == [1000, 1000, 500]


@pytest.mark.asyncio
async def test_delete_many_returns_failed_chunk_paths() -> None:
    client = MagicMock()
    remove = client.storage.from_.return_value.remove
    remove.side_effect = [None, RuntimeError("boom"), None]
    adapter = SupabaseStorageAdapter(client)
    paths = _paths(2500)

    failed = await adapter.delete_many("articles", paths)

    assert failed == paths[1000:2000]
    assert remove.call_count == 3


@pytest.mark.asyncio
async def test_delete_many_empty_makes_no_call() -> None:
    client = MagicMock()
    adapter = SupabaseStorageAdapter(client)

    failed = await adapter.delete_many("articles", [])

    assert failed == []
    client.storage.from_.return_value.remove.assert_not_called()


class _MinimalStorage(StorageAdapter):
    """Smallest concrete adapter: only `delete` matters to the default."""

    def __init__(self, bad: set[str], raising: set[str] | None = None) -> None:
        self.bad = bad
        self.raising = raising or set()

    async def download(self, bucket: str, path: str) -> bytes:
        return b""

    async def upload(
        self,
        bucket: str,
        path: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        return path

    async def delete(self, bucket: str, path: str) -> bool:
        if path in self.raising:
            raise RuntimeError("boom")
        return path not in self.bad

    async def exists(self, bucket: str, path: str) -> bool:
        return True

    async def get_public_url(self, bucket: str, path: str) -> str:
        return ""

    async def get_signed_url(self, bucket: str, path: str, expires_in: int = 3600) -> str:
        return ""


@pytest.mark.asyncio
async def test_base_default_loops_delete() -> None:
    adapter = _MinimalStorage(bad={"b.pdf"}, raising={"c.pdf"})

    failed = await adapter.delete_many("articles", ["a.pdf", "b.pdf", "c.pdf"])

    assert failed == ["b.pdf", "c.pdf"]

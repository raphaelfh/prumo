"""The local screening seed refuses any database that is not on this machine."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock
from uuid import uuid4

import pytest
from sqlalchemy.engine import make_url

from app import seed_screening
from app.core.config import settings
from app.seed_screening import assert_local_database, build


@pytest.mark.parametrize(
    "url",
    ["postgresql://u:p@db.supabase.co:5432/postgres", "postgresql://u:p@10.0.0.4/x"],
    ids=["supabase-host", "private-ip"],
)
def test_refuses_a_remote_database(url: str) -> None:
    with pytest.raises(SystemExit):
        assert_local_database(url)


@pytest.mark.parametrize(
    "url",
    ["postgresql://u:p@localhost:54322/postgres", "postgresql://u:p@127.0.0.1:55432/x"],
    ids=["localhost", "loopback"],
)
def test_accepts_a_local_database(url: str) -> None:
    assert assert_local_database(url) is None


async def test_build_refuses_a_session_bound_to_a_remote_engine() -> None:
    db = MagicMock()
    db.get_bind = Mock(
        return_value=SimpleNamespace(url=make_url("postgresql://u:p@db.supabase.co/postgres"))
    )
    db.execute, db.flush = AsyncMock(), AsyncMock()

    with pytest.raises(SystemExit):
        await build(db, manager_id=uuid4(), reviewer_ids=(uuid4(), uuid4()))

    db.execute.assert_not_called()
    db.add.assert_not_called()
    db.flush.assert_not_called()


def test_main_guards_before_opening_a_session(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://u:p@db.supabase.co:5432/postgres")
    factory = Mock()
    monkeypatch.setattr(seed_screening, "AsyncSessionLocal", factory)

    with pytest.raises(SystemExit):
        seed_screening.main([])

    factory.assert_not_called()


def test_main_needs_three_profiles(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://u:p@localhost:54322/postgres")
    session = MagicMock()
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=session)
    context.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(seed_screening, "AsyncSessionLocal", Mock(return_value=context))
    refusal = SystemExit("seed_screening needs three local profiles; sign up two more users first")
    monkeypatch.setattr(seed_screening, "resolve_profiles", AsyncMock(side_effect=refusal))
    built = AsyncMock()
    monkeypatch.setattr(seed_screening, "build", built)

    with pytest.raises(SystemExit) as raised:
        seed_screening.main([])

    assert raised.value is refusal
    built.assert_not_awaited()


def _run_collaborators(monkeypatch: pytest.MonkeyPatch, build: AsyncMock) -> MagicMock:
    session = MagicMock()
    session.commit = AsyncMock()
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=session)
    context.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(seed_screening, "AsyncSessionLocal", Mock(return_value=context))
    monkeypatch.setattr(
        seed_screening, "resolve_profiles", AsyncMock(return_value=(uuid4(), (uuid4(), uuid4())))
    )
    monkeypatch.setattr(seed_screening, "build", build)
    storage = MagicMock()
    storage.delete, storage.upload = AsyncMock(), AsyncMock()
    monkeypatch.setattr(seed_screening, "get_supabase_client", Mock())
    monkeypatch.setattr(seed_screening, "create_storage_adapter", Mock(return_value=storage))
    return storage


def test_main_uploads_the_seed_pdf_after_commit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://u:p@localhost:54322/postgres")
    storage = _run_collaborators(monkeypatch, AsyncMock(return_value=seed_screening.PROJECT_ID))

    seed_screening.main([])

    storage.upload.assert_awaited_once_with(
        "articles", seed_screening.SEED_PDF_KEY, seed_screening.SEED_PDF_BYTES, "application/pdf"
    )
    assert seed_screening.SEED_PDF_BYTES.startswith(b"%PDF-")
    assert seed_screening.SEED_PDF_KEY.startswith(f"{seed_screening.PROJECT_ID}/")


def test_main_does_not_upload_when_build_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql://u:p@localhost:54322/postgres")
    storage = _run_collaborators(monkeypatch, AsyncMock(side_effect=SystemExit("no")))

    with pytest.raises(SystemExit):
        seed_screening.main([])

    storage.upload.assert_not_awaited()

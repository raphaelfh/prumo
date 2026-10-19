"""The chat eval fixture's lifecycle on the test transaction, with a recording
storage fake (no network), and scripted E9 / E13 runs through the in-memory
server (FunctionModel, no real model)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from mcp_chat_eval import fixture as eval_fixture
from mcp_chat_eval.fixture import EvalFixture, EvalFixtureError
from mcp_chat_eval.manifest import TASKS
from mcp_chat_eval.runner import apply_interleave, run_task
from mcp_chat_eval.scoring import measure
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.mcp import session as mcp_session
from app.infrastructure.storage.base import StorageAdapter
from app.services.pat_service import resolve_principal
from tests.integration.conftest import SEED
from tests.integration.mcp.conftest import SeededPat

_TASK = {t.id: t for t in TASKS}


class _RecordingStorage(StorageAdapter):
    def __init__(self) -> None:
        self.uploads: list[tuple[str, str, bytes, str]] = []
        self.deletes: list[tuple[str, str]] = []

    async def upload(self, bucket: str, path: str, data: bytes, content_type: str) -> str:
        self.uploads.append((bucket, path, data, content_type))
        return path

    async def download(self, bucket: str, path: str) -> bytes:
        raise NotImplementedError

    async def get_signed_url(self, bucket: str, path: str, expires_in: int = 3600) -> str:
        raise NotImplementedError

    async def delete(self, bucket: str, path: str) -> bool:
        self.deletes.append((bucket, path))
        return True

    async def exists(self, bucket: str, path: str) -> bool:
        raise NotImplementedError

    async def get_public_url(self, bucket: str, path: str) -> str:
        raise NotImplementedError


@pytest.fixture
async def built(db_session: AsyncSession) -> tuple[EvalFixture, _RecordingStorage]:
    rec = _RecordingStorage()
    fx = await eval_fixture.build(
        db_session, user_id=SEED.primary_profile, model_key="test-key", storage=rec
    )
    return fx, rec


async def _count(db: AsyncSession, sql: str, **params: Any) -> int:
    return int((await db.execute(text(sql), {k: str(v) for k, v in params.items()})).scalar_one())


async def test_build_uploads_mints_three_limited_pats_and_fills_facts(
    db_session: AsyncSession, built: tuple[EvalFixture, _RecordingStorage]
) -> None:
    fx, rec = built
    assert len(rec.uploads) == 1
    bucket, path, data, content_type = rec.uploads[0]
    assert (bucket, path, content_type) == ("articles", fx.pdf_storage_key, "application/pdf")
    assert data.startswith(b"%PDF")

    expected_scopes = {
        "read": {"read"},
        "read_write": {"read", "write"},
        "ai_run": {"read", "write", "ai_run"},
    }
    assert set(fx.pats) == set(expected_scopes)
    for kind, (_token_id, secret) in fx.pats.items():
        principal = await resolve_principal(db_session, secret)
        assert principal is not None
        assert set(principal.scopes) == expected_scopes[kind]
        assert principal.project_ids == {fx.project_id, fx.other_project_id}
    ai_expires = (
        await db_session.execute(
            text("SELECT expires_at FROM public.personal_access_tokens WHERE id = :id"),
            {"id": str(fx.pats["ai_run"][0])},
        )
    ).scalar_one()
    assert ai_expires <= datetime.now(UTC) + timedelta(days=30)

    assert set(fx.facts) == set(eval_fixture.Facts.__annotations__) - {"write_tools"}
    assert all(fx.facts[k] for k in fx.facts)  # type: ignore[literal-required]
    eval_articles = await _count(
        db_session, "SELECT count(*) FROM public.articles WHERE project_id = :p", p=fx.project_id
    )
    other_articles = await _count(
        db_session,
        "SELECT count(*) FROM public.articles WHERE project_id = :p",
        p=fx.other_project_id,
    )
    assert eval_articles > other_articles > 0


@pytest.mark.usefixtures("built")
async def test_a_second_build_for_the_same_user_refuses_before_minting(
    db_session: AsyncSession,
) -> None:
    before = await _count(
        db_session,
        "SELECT count(*) FROM public.personal_access_tokens WHERE user_id = :u",
        u=SEED.primary_profile,
    )
    with pytest.raises(EvalFixtureError, match="dedicated eval user"):
        await eval_fixture.build(
            db_session, user_id=SEED.primary_profile, model_key="k", storage=_RecordingStorage()
        )
    after = await _count(
        db_session,
        "SELECT count(*) FROM public.personal_access_tokens WHERE user_id = :u",
        u=SEED.primary_profile,
    )
    assert after == before


async def test_a_build_failing_after_the_upload_deletes_the_uploaded_object(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken_clone(*_a: Any, **_kw: Any) -> Any:
        raise RuntimeError("clone failed")

    monkeypatch.setattr(eval_fixture, "clone_template", broken_clone)
    rec = _RecordingStorage()
    with pytest.raises(RuntimeError, match="clone failed"):
        await eval_fixture.build(
            db_session, user_id=SEED.primary_profile, model_key="k", storage=rec
        )
    assert len(rec.uploads) == 1
    assert rec.deletes == [(rec.uploads[0][0], rec.uploads[0][1])]


async def test_teardown_revokes_deletes_and_is_idempotent(
    db_session: AsyncSession, built: tuple[EvalFixture, _RecordingStorage]
) -> None:
    fx, rec = built
    key, connection_id = fx.pdf_storage_key, fx.llm_connection_id
    await eval_fixture.teardown(db_session, fx, storage=rec)

    assert rec.deletes == [("articles", key)]
    for _token_id, secret in fx.pats.values():
        assert await resolve_principal(db_session, secret) is None
    assert (
        await _count(
            db_session,
            "SELECT count(*) FROM public.projects WHERE id IN (:a, :b)",
            a=fx.project_id,
            b=fx.other_project_id,
        )
        == 0
    )
    assert (
        await _count(
            db_session, "SELECT count(*) FROM public.llm_connections WHERE id = :c", c=connection_id
        )
        == 0
    )

    await eval_fixture.teardown(db_session, fx, storage=rec)
    assert rec.deletes == [("articles", key)]


# --- scripted runs through the in-memory server ----------------------------------


def _opener(mcp_client: Any, db_session: AsyncSession, fx: EvalFixture) -> Any:
    @asynccontextmanager
    async def open_client(kind: str) -> AsyncIterator[Any]:
        principal = await resolve_principal(db_session, fx.pats[kind][1])
        assert principal is not None
        async with mcp_client(SeededPat(fx.pats[kind][1], principal)) as client:
            yield client

    return open_client


def _returns(messages: list[ModelMessage]) -> list[ToolReturnPart]:
    return [
        p
        for m in messages
        if isinstance(m, ModelRequest)
        for p in m.parts
        if isinstance(p, ToolReturnPart)
    ]


async def test_scripted_e9_records_one_readiness_call(
    mcp_client: Any, db_session: AsyncSession, built: tuple[EvalFixture, _RecordingStorage]
) -> None:
    fx, _rec = built

    def model(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        if not _returns(messages):
            return ModelResponse(
                parts=[ToolCallPart("get_setup_readiness", {"project_id": str(fx.project_id)})]
            )
        return ModelResponse(parts=[TextPart("Here is what is missing.")])

    facts = {**fx.facts, "write_tools": []}
    transcript = await run_task(
        _TASK["E9"],
        open_client=_opener(mcp_client, db_session, fx),
        model=FunctionModel(model),
        facts=facts,  # type: ignore[arg-type]
        budget=100_000,
        on_interleave=None,
    )
    assert transcript.error is None
    assert [c.name for c in transcript.calls] == ["get_setup_readiness"]
    assert transcript.calls[0].result_chars > 0
    assert transcript.calls[0].turn == 0
    assert measure(_TASK["E9"], transcript, facts).passed  # type: ignore[arg-type]


def _e13_model(fx: EvalFixture) -> FunctionModel:
    """get_project -> update (expected = what it read) -> on an error,
    get_project again -> update (expected = the re-read value) -> answer."""

    def model(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        returns = _returns(messages)
        pid = str(fx.project_id)
        if not returns:
            return ModelResponse(parts=[ToolCallPart("get_project", {"project_id": pid})])
        last = returns[-1]
        content = last.content if isinstance(last.content, dict) else {}
        if last.tool_name == "get_project":
            return ModelResponse(
                parts=[
                    ToolCallPart(
                        "update_project_details",
                        {
                            "project_id": pid,
                            "fields": {"description": "Systematic review of statin safety"},
                            "expected": {"description": content["details"]["description"]},
                        },
                    )
                ]
            )
        if last.tool_name == "update_project_details" and content.get("code"):
            return ModelResponse(parts=[ToolCallPart("get_project", {"project_id": pid})])
        return ModelResponse(parts=[TextPart("Updated the description.")])

    return FunctionModel(model)


async def test_scripted_e13_interleave_commits_then_stale_then_one_reread(
    mcp_client: Any, db_session: AsyncSession, built: tuple[EvalFixture, _RecordingStorage]
) -> None:
    fx, _rec = built
    counter = {"n": 0}

    async def on_interleave() -> None:
        counter["n"] += 1
        await apply_interleave(fx, session_factory=mcp_session.session_factory)

    facts = {**fx.facts, "write_tools": ["update_project_details"]}
    transcript = await run_task(
        _TASK["E13"],
        open_client=_opener(mcp_client, db_session, fx),
        model=_e13_model(fx),
        facts=facts,  # type: ignore[arg-type]
        budget=100_000,
        on_interleave=on_interleave,
    )
    assert transcript.error is None, transcript.error
    assert counter["n"] == 1
    updates = [c for c in transcript.calls if c.name == "update_project_details"]
    assert [u.error_code for u in updates] == ["STALE_VALUE", None]
    assert [c.name for c in transcript.calls].count("get_project") == 2
    assert measure(_TASK["E13"], transcript, facts).passed  # type: ignore[arg-type]


async def test_scripted_e13_without_the_interleave_is_never_stale(
    mcp_client: Any, db_session: AsyncSession, built: tuple[EvalFixture, _RecordingStorage]
) -> None:
    fx, _rec = built
    transcript = await run_task(
        _TASK["E13"],
        open_client=_opener(mcp_client, db_session, fx),
        model=_e13_model(fx),
        facts={**fx.facts, "write_tools": []},  # type: ignore[arg-type]
        budget=100_000,
        on_interleave=None,
    )
    assert transcript.error is None, transcript.error
    assert all(c.error_code is None for c in transcript.calls)
    assert [c.name for c in transcript.calls] == ["get_project", "update_project_details"]

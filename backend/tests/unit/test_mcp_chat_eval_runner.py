"""The chat eval runner's control flow with stubs: the credential seam, the
local-host guard and ``main_async`` (skip, survive, cancel, teardown, exit
code). No database, no network, no real model."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
from mcp_chat_eval import fixture as fixture_mod
from mcp_chat_eval import runner
from mcp_chat_eval.manifest import TASKS
from mcp_chat_eval.runner import ENV_KEY, RunnerDeps, ensure_local, read_model_key
from pydantic_ai.messages import ModelMessage, ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.core.config import settings

LOCAL_DB = "postgresql+asyncpg://postgres:postgres@localhost:55432/db"


# --- credential seam ------------------------------------------------------------


def test_read_model_key_returns_the_dedicated_variable() -> None:
    assert read_model_key({ENV_KEY: "k"}) == "k"


@pytest.mark.parametrize("environ", [{}, {ENV_KEY: "   "}], ids=["missing", "blank"])
def test_read_model_key_refuses_missing_or_blank(environ: dict[str, str]) -> None:
    with pytest.raises(SystemExit) as exc:
        read_model_key(environ)
    assert ENV_KEY in str(exc.value.code)


def test_read_model_key_ignores_app_settings_and_the_generic_variable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "settings-sentinel")
    with pytest.raises(SystemExit) as exc:
        read_model_key({"ANTHROPIC_API_KEY": "generic-sentinel"})
    message = str(exc.value.code)
    assert ENV_KEY in message
    assert "sentinel" not in message


def _argv(out: Path, *extra: str) -> list[str]:
    return [
        "--user-id",
        str(uuid4()),
        "--model",
        "claude-test",
        "--budget-tokens",
        "1000",
        "--out",
        str(out),
        *extra,
    ]


def test_main_without_the_key_exits_before_building(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv(ENV_KEY, raising=False)

    async def boom(*_a: Any, **_kw: Any) -> None:
        raise AssertionError("fixture.build must not run")

    monkeypatch.setattr(fixture_mod, "build", boom)
    with pytest.raises(SystemExit) as exc:
        runner.main(_argv(tmp_path))
    assert exc.value.code not in (0, None)


# --- local-host guard -----------------------------------------------------------


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "[::1]"])
def test_ensure_local_accepts_loopback(host: str) -> None:
    ensure_local(f"postgresql+asyncpg://u:p@{host}:5432/db", f"http://{host}:8000/mcp")


@pytest.mark.parametrize(
    ("db", "mcp"),
    [
        ("postgresql+asyncpg://u:p@db.example.com:5432/db", "http://localhost:8000/mcp"),
        (LOCAL_DB, "https://api.example.com/mcp"),
    ],
    ids=["remote-db", "remote-mcp"],
)
def test_ensure_local_refuses_a_remote_host(db: str, mcp: str) -> None:
    with pytest.raises(SystemExit):
        ensure_local(db, mcp)


# --- main_async with stubs ------------------------------------------------------


class _FakeClient:
    instructions = "server instructions"

    def __init__(self, tools: list[str], log: list[tuple[str, dict[str, Any]]]) -> None:
        self._tools = tools
        self._log = log

    async def list_tools(self) -> Any:
        return SimpleNamespace(
            tools=[
                SimpleNamespace(
                    name=n,
                    description=f"{n} tool",
                    input_schema={"type": "object", "properties": {}},
                    annotations=SimpleNamespace(read_only_hint=n not in {"start_ai_run"}),
                )
                for n in self._tools
            ]
        )

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        self._log.append((name, arguments))
        body: dict[str, Any] = {"ok": True}
        if name == "start_ai_run":
            body = {"batch_id": "b-1"}
        return SimpleNamespace(
            structured_content=body,
            content=[SimpleNamespace(type="text", text=json.dumps(body))],
            is_error=False,
        )

    async def get_prompt(self, name: str, arguments: dict[str, str]) -> Any:
        return SimpleNamespace(
            messages=[SimpleNamespace(content=SimpleNamespace(type="text", text="prompt"))]
        )


def _scripted(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    """Call start_ai_run once when it is offered, then answer; raise for E2."""
    prompt = str(messages[0].parts[-1].content)  # type: ignore[union-attr]
    if "summarize the methods" in prompt:
        raise RuntimeError("model exploded")
    names = {t.name for t in info.function_tools}
    called = any(
        isinstance(p, ToolCallPart)
        for m in messages
        if isinstance(m, ModelResponse)
        for p in m.parts
    )
    if "start_ai_run" in names and not called:
        return ModelResponse(parts=[ToolCallPart("start_ai_run", {})])
    return ModelResponse(parts=[TextPart("done")])


def _deps(
    tmp_path: Path,
    record: dict[str, Any],
    *,
    tools: list[str],
    database_url: str = LOCAL_DB,
) -> RunnerDeps:
    record.setdefault("build", 0)
    record.setdefault("teardown", 0)
    record.setdefault("calls", [])

    async def build(db: Any, *, user_id: Any, model_key: str, storage: Any) -> Any:
        record["build"] += 1
        facts = dict.fromkeys(
            ["project_name", "most_articles_project", "article_title", "phrase", "sample_size"],
            "x",
        )
        return SimpleNamespace(
            project_id=uuid4(),
            other_project_id=uuid4(),
            pats={},
            facts={**facts, "phrase_article_titles": [], "extracted_fields": []},
        )

    async def teardown(db: Any, fx: Any, *, storage: Any) -> None:
        record["teardown"] += 1

    def open_client_factory(_url: str, _fx: Any) -> Any:
        @asynccontextmanager
        async def open_client(_kind: str) -> AsyncIterator[_FakeClient]:
            yield _FakeClient(tools, record["calls"])

        return open_client

    class _Session:
        async def __aenter__(self) -> _Session:
            return self

        async def __aexit__(self, *_a: Any) -> None:
            return None

        async def commit(self) -> None:
            return None

    return RunnerDeps(
        build=build,
        teardown=teardown,
        open_client_factory=open_client_factory,
        model_factory=lambda _model, _key: FunctionModel(_scripted),
        storage_factory=lambda: object(),
        session_factory=_Session,
        database_url=database_url,
    )


def _args(tmp_path: Path, *extra: str) -> Any:
    return runner.parse_args(_argv(tmp_path, *extra))


async def test_main_async_refuses_a_remote_mcp_url_before_building(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv(ENV_KEY, "k")
    record: dict[str, Any] = {}
    deps = _deps(tmp_path, record, tools=[])
    with pytest.raises(SystemExit):
        await runner.main_async(
            _args(tmp_path, "--mcp-url", "https://api.example.com/mcp"), deps=deps
        )
    assert record["build"] == 0


async def test_main_async_skips_survives_cancels_and_tears_down(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv(ENV_KEY, "k")
    record: dict[str, Any] = {}
    # E1 needs list_projects (missing -> skipped); E2 raises in the model;
    # E14 calls start_ai_run, whose batch must be cancelled.
    deps = _deps(
        tmp_path, record, tools=["get_article_text", "plan_ai_run", "start_ai_run", "cancel_ai_run"]
    )
    code = await runner.main_async(_args(tmp_path, "--only", "E1,E2,E14"), deps=deps)

    assert code == 1  # 0 of 3 passed: thresholds fail
    report = json.loads((tmp_path / "report.json").read_text())
    by_id = {t["task_id"]: t for t in report["tasks"]}
    assert by_id["E1"]["skipped"] is True
    assert by_id["E2"]["skipped"] is False and by_id["E2"]["passed"] is False
    assert by_id["E14"]["calls"] == 1
    assert (tmp_path / "report.md").read_text().startswith("# MCP chat eval: claude-test")
    cancels = [a for n, a in record["calls"] if n == "cancel_ai_run"]
    assert [a["batch_id"] for a in cancels] == ["b-1"]
    assert record["build"] == 1 and record["teardown"] == 1


async def test_main_async_tears_down_once_when_a_task_raises_outside_the_model(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv(ENV_KEY, "k")
    record: dict[str, Any] = {}
    deps = _deps(tmp_path, record, tools=["get_setup_readiness"])

    async def explode(*_a: Any, **_kw: Any) -> Any:
        raise RuntimeError("transport down")

    monkeypatch.setattr(runner, "run_task", explode)
    code = await runner.main_async(_args(tmp_path, "--only", "E9"), deps=deps)
    assert code == 1
    assert record["teardown"] == 1
    report = json.loads((tmp_path / "report.json").read_text())
    assert report["tasks"][0]["passed"] is False


async def test_main_async_returns_zero_when_thresholds_hold_and_the_baseline_is_null(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv(ENV_KEY, "k")
    record: dict[str, Any] = {}
    deps = _deps(tmp_path, record, tools=[])
    baseline = tmp_path / "baseline.md"
    baseline.write_text("<!-- mcp-chat-eval-baseline -->\n```json\nnull\n```\n")
    monkeypatch.setattr(runner, "summarize", lambda tasks, metrics: _met(metrics))
    code = await runner.main_async(
        _args(tmp_path, "--only", "E1", "--baseline", str(baseline)), deps=deps
    )
    assert code == 0


def _met(metrics: Any) -> Any:
    from mcp_chat_eval.scoring import Summary

    return Summary(
        metrics=list(metrics),
        pass_count=18,
        total_tokens=0,
        median_calls=1,
        max_result_chars=0,
        failures=[],
    )


def test_every_manifest_pat_kind_is_minted() -> None:
    assert {t.pat for t in TASKS} == set(fixture_mod.PAT_SPECS)


def test_selected_tasks_keep_manifest_order() -> None:
    picked = runner.select_tasks("E14,E1")
    assert [t.id for t in picked] == ["E1", "E14"]
    assert replace(picked[0]) == TASKS[0]

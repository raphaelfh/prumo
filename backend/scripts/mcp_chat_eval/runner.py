"""Opt-in live runner of the chat eval against a LOCAL /mcp server.

Builds the fixture, drives a model (pydantic-ai) through the server's tools
over the ``mcp`` client, scripts the user turns, scores with ``scoring`` and
writes ``report.json`` / ``report.md``. The model key comes only from
``MCP_CHAT_EVAL_ANTHROPIC_API_KEY``. Starts no worker; refuses a non-local
database or /mcp host. CI drives it with scripted models and stubs only.

    cd backend && MCP_CHAT_EVAL_ANTHROPIC_API_KEY=... PYTHONPATH=scripts \\
        uv run python -m mcp_chat_eval.runner --user-id <uuid> --model <id> \\
        --budget-tokens <n> --out <dir>
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from pydantic_ai import Agent, Tool
from pydantic_ai.models import Model
from pydantic_ai.usage import RunUsage, UsageLimits

from app.api.mcp import session as mcp_session
from app.utils.compact_json import compact_json
from mcp_chat_eval import fixture
from mcp_chat_eval.checks import Facts, ToolCall, Transcript
from mcp_chat_eval.manifest import TASKS, EvalTask, PatKind
from mcp_chat_eval.scoring import (
    measure,
    parse_baseline,
    regressions,
    report_json,
    report_markdown,
    summarize,
)

ENV_KEY = "MCP_CHAT_EVAL_ANTHROPIC_API_KEY"
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
_REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_BASELINE = _REPO_ROOT / "docs" / "reference" / "mcp-chat-eval.md"

OpenClient = Callable[[PatKind], AbstractAsyncContextManager[Any]]


def read_model_key(environ: Mapping[str, str] = os.environ) -> str:
    key = environ.get(ENV_KEY, "").strip()
    if not key:
        raise SystemExit(f"mcp-chat-eval: set {ENV_KEY} to the model key for this run")
    return key


def ensure_local(database_url: str, mcp_url: str) -> None:
    for label, url in (("database", database_url), ("--mcp-url", mcp_url)):
        if urlsplit(url).hostname not in _LOCAL_HOSTS:
            raise SystemExit(f"mcp-chat-eval: the {label} host is not local; refusing to run")


async def apply_interleave(
    fx: fixture.EvalFixture, *, session_factory: Callable[[], Any] | None = None
) -> None:
    """Commit E13's out-of-band change in a FRESH session (row lock released)."""
    factory = session_factory or mcp_session.session_factory
    async with factory() as s:
        await fixture.concurrent_description_change(s, fx)
        await s.commit()


# --- the tool bridge -------------------------------------------------------------


class _Recorder:
    def __init__(
        self, interleave_after: str | None, on_interleave: Callable[[], Awaitable[None]] | None
    ) -> None:
        self.calls: list[ToolCall] = []
        self.turn = 0
        self._after = interleave_after if on_interleave is not None else None
        self._on_interleave = on_interleave

    async def record(self, call: ToolCall) -> None:
        self.calls.append(call)
        if self._after == call.name and self._on_interleave is not None:
            self._after = None  # exactly once, before the result reaches the model
            await self._on_interleave()


def _forwarder(client: Any, name: str, rec: _Recorder) -> Callable[..., Awaitable[Any]]:
    async def forward(**arguments: Any) -> Any:
        result = await client.call_tool(name, arguments)
        structured = result.structured_content
        text = "".join(
            getattr(c, "text", "") for c in result.content if getattr(c, "type", "") == "text"
        )
        is_dict = isinstance(structured, dict)
        code = structured.get("code") if result.is_error and is_dict else None
        await rec.record(
            ToolCall(
                name=name,
                arguments=dict(arguments),
                result=structured if is_dict else None,
                result_chars=len(compact_json(structured)) if is_dict else len(text),
                error_code=code if isinstance(code, str) else None,
                turn=rec.turn,
            )
        )
        return structured if is_dict else text

    return forward


def bridge_tools(client: Any, listed: Sequence[Any], rec: _Recorder) -> list[Tool[Any]]:
    """Each listed MCP tool as a pydantic-ai tool forwarding to ``client``."""
    return [
        Tool.from_schema(_forwarder(client, t.name, rec), t.name, t.description, t.input_schema)
        for t in listed
    ]


def write_tools(listed: Sequence[Any]) -> list[str]:
    return [t.name for t in listed if t.annotations is None or not t.annotations.read_only_hint]


async def _prompt_text(client: Any, name: str, project_id: UUID | None) -> str:
    args = {"project": str(project_id)} if project_id is not None else {}
    rendered = await client.get_prompt(name, args)
    return "\n\n".join(getattr(m.content, "text", "") for m in rendered.messages)


async def run_task(
    task: EvalTask,
    *,
    open_client: OpenClient,
    model: Model,
    facts: Facts,
    budget: int,
    on_interleave: Callable[[], Awaitable[None]] | None,
    project_id: UUID | None = None,
) -> Transcript:
    """One scripted conversation. Turns are numbered from 0; a model or
    budget error ends the task with ``Transcript.error`` set."""
    started = time.monotonic()
    rec = _Recorder(task.interleave.after_tool if task.interleave else None, on_interleave)
    usage = RunUsage()
    final_text, error = "", None
    try:
        async with open_client(task.pat) as client:
            listed = (await client.list_tools()).tools
            agent = Agent(
                model, tools=bridge_tools(client, listed, rec), instructions=client.instructions
            )
            turns = [t.format(**facts) for t in task.turns]
            if task.prompt is not None:
                turns.insert(0, await _prompt_text(client, task.prompt, project_id))
            history = None
            for index, turn in enumerate(turns):
                rec.turn = index
                result = await agent.run(
                    turn,
                    message_history=history,
                    usage=usage,
                    usage_limits=UsageLimits(total_tokens_limit=max(budget, 1)),
                )
                history = result.all_messages()
                final_text = str(result.output)
    except Exception as exc:  # noqa: BLE001 - recorded on the transcript; the run continues
        error = f"{type(exc).__name__}: {exc}"
    return Transcript(
        task_id=task.id,
        calls=tuple(rec.calls),
        final_text=final_text,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        wall_seconds=time.monotonic() - started,
        error=error,
    )


# --- main ---------------------------------------------------------------------------


def _http_client_factory(mcp_url: str, fx: Any) -> OpenClient:
    @asynccontextmanager
    async def open_client(kind: PatKind) -> Any:
        import httpx2
        from mcp import Client
        from mcp.client.streamable_http import streamable_http_client

        headers = {"Authorization": f"Bearer {fx.pats[kind][1]}"}
        async with (
            httpx2.AsyncClient(headers=headers, timeout=120) as http,
            Client(streamable_http_client(mcp_url, http_client=http)) as client,
        ):
            yield client

    return open_client


def _anthropic_model(model: str, key: str) -> Model:
    from pydantic_ai.models.anthropic import AnthropicModel
    from pydantic_ai.providers.anthropic import AnthropicProvider

    return AnthropicModel(model, provider=AnthropicProvider(api_key=key))


def _database_url() -> str:
    from app.core.config import settings

    return str(settings.DATABASE_URL)


@dataclass
class RunnerDeps:
    build: Callable[..., Awaitable[Any]]
    teardown: Callable[..., Awaitable[None]]
    open_client_factory: Callable[[str, Any], OpenClient]
    model_factory: Callable[[str, str], Model]
    storage_factory: Callable[[], Any]
    session_factory: Callable[[], Any]
    database_url: str

    @classmethod
    def default(cls) -> RunnerDeps:
        return cls(
            build=fixture.build,
            teardown=fixture.teardown,
            open_client_factory=_http_client_factory,
            model_factory=_anthropic_model,
            storage_factory=mcp_session.storage_factory,
            session_factory=mcp_session.session_factory,
            database_url=_database_url(),
        )


def select_tasks(only: str | None) -> list[EvalTask]:
    wanted = {i.strip() for i in only.split(",")} if only else None
    return [t for t in TASKS if wanted is None or t.id in wanted]


def _sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return out.stdout.strip()


async def _cancel(open_client: OpenClient, project_id: UUID, batch_ids: list[str]) -> None:
    for batch_id in batch_ids:
        try:
            async with open_client("ai_run") as client:
                await client.call_tool(
                    "cancel_ai_run", {"project_id": str(project_id), "batch_id": batch_id}
                )
        except Exception as exc:  # noqa: BLE001 - reported; teardown still runs
            print(f"mcp-chat-eval: could not cancel batch {batch_id}: {exc}", file=sys.stderr)


async def main_async(args: argparse.Namespace, *, deps: RunnerDeps | None = None) -> int:
    key = read_model_key()
    deps = deps or RunnerDeps.default()
    ensure_local(deps.database_url, args.mcp_url)
    tasks = select_tasks(args.only)
    storage = deps.storage_factory()
    async with deps.session_factory() as s:
        fx = await deps.build(s, user_id=args.user_id, model_key=key, storage=storage)
        await s.commit()
    open_client = deps.open_client_factory(args.mcp_url, fx)
    model = deps.model_factory(args.model, key)
    transcripts: dict[str, Transcript] = {}
    batch_ids: list[str] = []
    facts: Any = dict(fx.facts)
    try:
        async with open_client("ai_run") as client:
            listed = (await client.list_tools()).tools
        available = {t.name for t in listed}
        facts["write_tools"] = write_tools(listed)
        spent = 0
        for task in tasks:
            if not set(task.required_tools) <= available:
                transcripts[task.id] = Transcript(task.id, (), "", 0, 0, 0.0, skipped=True)
                continue

            async def interleave() -> None:
                await apply_interleave(fx, session_factory=deps.session_factory)

            try:
                t = await run_task(
                    task,
                    open_client=open_client,
                    model=model,
                    facts=facts,
                    budget=args.budget_tokens - spent,
                    on_interleave=interleave if task.interleave else None,
                    project_id=fx.project_id,
                )
            except Exception as exc:  # noqa: BLE001 - this task fails; the loop continues
                t = Transcript(task.id, (), "", 0, 0, 0.0, error=f"{type(exc).__name__}: {exc}")
            transcripts[task.id] = t
            spent += t.input_tokens + t.output_tokens
            batch_ids += [
                str(c.result["batch_id"])
                for c in t.calls
                if c.name == "start_ai_run" and c.result and c.result.get("batch_id")
            ]
    finally:
        await _cancel(open_client, fx.project_id, batch_ids)
        async with deps.session_factory() as s:
            await deps.teardown(s, fx, storage=storage)
            await s.commit()

    metrics = [measure(t, transcripts[t.id], facts) for t in tasks]
    summary = summarize(tasks, metrics)
    baseline = parse_baseline(Path(args.baseline).read_text(encoding="utf-8"))
    found = regressions(summary, tasks, baseline) if baseline is not None else []
    sha = _sha()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    payload = report_json(summary, model=args.model, sha=sha, regressions=found)
    (out / "report.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    markdown = report_markdown(summary, model=args.model, sha=sha, regressions=found)
    (out / "report.md").write_text(markdown, encoding="utf-8")
    print(markdown)
    return 0 if not summary.failures and not found else 1


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="mcp_chat_eval.runner", description=__doc__)
    parser.add_argument("--mcp-url", default="http://localhost:8000/mcp")
    parser.add_argument("--user-id", required=True, type=UUID)
    parser.add_argument("--model", required=True)
    parser.add_argument("--budget-tokens", required=True, type=int)
    parser.add_argument("--out", required=True)
    parser.add_argument("--only", default=None, help="comma-separated task ids")
    parser.add_argument("--baseline", default=str(DEFAULT_BASELINE))
    return parser.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    return asyncio.run(main_async(parse_args(argv)))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

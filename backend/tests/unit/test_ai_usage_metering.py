"""``metered``: one sink record per model call, ok or failed, and a ledger
write failure that is surfaced, never swallowed. No database: the sink is the
recording fake or a raising stub."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest
from structlog.testing import capture_logs

from app.llm import entailment, verify
from app.llm.extractor import LlmUsage, UsageLedgerWriteError, attach_failed_usage
from app.llm.prompts import section_extraction
from app.services.ai_usage_metering import UsageContext, metered
from tests.fakes.usage_sink import RecordingUsageSink


def _ctx(**overrides: Any) -> UsageContext:
    return UsageContext(
        **{
            "project_id": uuid4(),
            "owner_id": uuid4(),
            "run_id": uuid4(),
            "attempt_id": uuid4(),
            "provider": "openai",
            "model": "gpt-test",
            "key_scope": "user_byok",
            **overrides,
        }
    )


class _Llm:
    """A fake model call: answers ``usage``, or raises ``fail``."""

    def __init__(self, usage: LlmUsage | None = None, fail: BaseException | None = None) -> None:
        self.usage = usage or LlmUsage(10, 4, ["req-a", "req-b"])
        self.fail = fail
        self.calls = 0

    async def __call__(self, **_kwargs: Any) -> tuple[str, LlmUsage]:
        self.calls += 1
        if self.fail is not None:
            raise self.fail
        return "output", self.usage


class _RaisingSink:
    def __init__(self, error: BaseException) -> None:
        self.error = error

    async def record(self, *_args: Any, **_kwargs: Any) -> None:
        raise self.error


async def _call(llm: Any, prompt_name: str = section_extraction.NAME) -> tuple[Any, LlmUsage]:
    return await llm(
        output_model=object,
        system_prompt="sys",
        user_prompt="user",
        model=None,
        prompt_name=prompt_name,
        prompt_version="v-1",
    )


async def test_a_successful_call_records_one_ok_entry_and_returns_unchanged() -> None:
    sink, llm, ctx = RecordingUsageSink(), _Llm(), _ctx()

    output, usage = await _call(metered(llm, sink, lambda: ctx))

    assert (output, usage) == ("output", LlmUsage(10, 4, ["req-a", "req-b"]))
    (entry,) = sink.entries
    assert (entry.ctx, entry.pass_kind, entry.prompt_version, entry.outcome) == (
        ctx,
        "extract",
        "v-1",
        "ok",
    )
    assert entry.usage == LlmUsage(10, 4, ["req-a", "req-b"])


@pytest.mark.parametrize(
    ("prompt_name", "kind"),
    [(verify.NAME, "verify"), (entailment.NAME, "entailment")],
    ids=["verify", "entailment"],
)
async def test_the_pass_kind_comes_from_the_prompt_map(prompt_name: str, kind: str) -> None:
    sink = RecordingUsageSink()
    await _call(metered(_Llm(), sink, _ctx), prompt_name)
    assert [e.pass_kind for e in sink.entries] == [kind]


async def test_a_raising_call_records_one_failed_entry_with_zero_tokens_and_reraises() -> None:
    sink = RecordingUsageSink()

    with pytest.raises(ValueError, match="model down"):
        await _call(metered(_Llm(fail=ValueError("model down")), sink, _ctx))

    (entry,) = sink.entries
    assert entry.outcome == "failed"
    assert entry.usage == LlmUsage()


async def test_a_raising_call_records_the_usage_the_seam_attached() -> None:
    """The adapter attaches what a failed call consumed (every attempt's
    tokens and response ids) to the exception it raises."""
    error = ValueError("reask budget exhausted")
    attach_failed_usage(error, LlmUsage(30, 9, ["r1", "r2", "r3"]))
    sink = RecordingUsageSink()

    with pytest.raises(ValueError):
        await _call(metered(_Llm(fail=error), sink, _ctx))

    assert [(e.outcome, e.usage) for e in sink.entries] == [
        ("failed", LlmUsage(30, 9, ["r1", "r2", "r3"]))
    ]


async def test_an_unknown_prompt_name_raises_before_the_call() -> None:
    llm, sink = _Llm(), RecordingUsageSink()

    with pytest.raises(KeyError):
        await _call(metered(llm, sink, _ctx), "no_such_prompt")

    assert llm.calls == 0
    assert sink.entries == []


async def test_the_context_is_read_per_call() -> None:
    sink = RecordingUsageSink()
    first, second = uuid4(), uuid4()
    source = {"run_id": first}
    llm = metered(_Llm(), sink, lambda: _ctx(run_id=source["run_id"]))

    await _call(llm)
    source["run_id"] = second
    await _call(llm)

    assert [e.ctx.run_id for e in sink.entries] == [first, second]


async def test_a_sink_failure_on_a_successful_call_is_raised() -> None:
    sink_error = RuntimeError("sink down")
    llm = metered(_Llm(), _RaisingSink(sink_error), _ctx)

    with pytest.raises(UsageLedgerWriteError) as raised:
        await _call(llm)

    assert raised.value.__cause__ is sink_error


async def test_a_sink_failure_on_a_failing_call_keeps_the_model_error_primary() -> None:
    attempt_id, run_id = uuid4(), uuid4()
    llm = metered(
        _Llm(fail=ValueError("model down")),
        _RaisingSink(RuntimeError("sink down")),
        lambda: _ctx(attempt_id=attempt_id, run_id=run_id),
    )

    with capture_logs() as logs, pytest.raises(ValueError, match="model down") as raised:
        await _call(llm)

    assert any("sink down" in note for note in raised.value.__notes__)
    (event,) = [e for e in logs if e["event"] == "usage_ledger_write_failed"]
    assert event["log_level"] == "error"
    assert event["pass_kind"] == "extract"
    assert event["run_id"] == str(run_id)
    assert event["attempt_id"] == str(attempt_id)
    assert event["error_type"] == "RuntimeError"

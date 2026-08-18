"""B5 — unit tests for the capabilities probe ladder.

Everything is mocked at the ``guarded_json_request`` seam (the name the
probe module imports), so these tests prove the LADDER contract, not the
network guard: rung order and short-circuit, sanitized reason classes,
the "no model to probe" typed failure, models_seen capping at the seam,
and that key material never reaches the result or leaves via a header
when absent.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

import app.services.llm_endpoint_probe as probe_module
from app.core.net_guard import EndpointUrlError, VettedUrl
from app.services.llm_endpoint_probe import probe_endpoint

_VETTED = VettedUrl(
    url="https://api.example.com/v1",
    host="api.example.com",
    port=443,
    addresses=("93.184.216.34",),
)


class FakeGuard:
    """Scripted stand-in for ``guarded_json_request`` that records calls."""

    def __init__(self, responses: list[Any]) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    async def __call__(
        self,
        method: str,
        vetted: VettedUrl,
        path: str,
        *,
        headers: dict[str, str] | None = None,
        json_body: dict[str, Any] | None = None,
        **_: Any,
    ) -> tuple[int, Any]:
        self.calls.append(
            {
                "method": method,
                "vetted": vetted,
                "path": path,
                "headers": dict(headers or {}),
                "json_body": json_body,
            }
        )
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def _guard(monkeypatch: pytest.MonkeyPatch, responses: list[Any]) -> FakeGuard:
    fake = FakeGuard(responses)
    monkeypatch.setattr(probe_module, "guarded_json_request", fake)
    return fake


def _models(ids: list[Any]) -> tuple[int, Any]:
    return (200, {"object": "list", "data": [{"id": i} for i in ids]})


def _tool_ok(arguments: str = '{"ok": true}') -> tuple[int, Any]:
    return (
        200,
        {
            "choices": [
                {
                    "message": {
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {"name": "echo_ok", "arguments": arguments},
                            }
                        ]
                    }
                }
            ]
        },
    )


def _content(content: str) -> tuple[int, Any]:
    return (200, {"choices": [{"message": {"content": content}}]})


_TOOL_FAIL = _content("plain text, no tool call")  # tool rung: no tool_calls
_NOT_JSON = _content("sorry, I cannot do that")


# ---------------------------------------------------------------------------
# Ladder ordering
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ladder_short_circuits_at_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    guard = _guard(monkeypatch, [_models(["m1"]), _tool_ok()])

    result = await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=["m1"])

    assert result.validation_status == "ok"
    assert result.output_mode == "tool"
    assert result.error is None
    assert result.models_seen == ["m1"]
    # Exactly GET /models + ONE chat call — native/prompted never fired.
    assert [c["path"] for c in guard.calls] == ["/models", "/chat/completions"]
    rung = guard.calls[1]["json_body"]
    assert rung["model"] == "m1"
    assert rung["tools"] and rung["tool_choice"] in ("auto", "required")
    assert rung["temperature"] == 0


@pytest.mark.asyncio
async def test_tool_failure_falls_to_native(monkeypatch: pytest.MonkeyPatch) -> None:
    guard = _guard(monkeypatch, [_models(["m1"]), _TOOL_FAIL, _content('{"ok": true}')])

    result = await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=["m1"])

    assert result.validation_status == "ok"
    assert result.output_mode == "native"
    native = guard.calls[2]["json_body"]
    assert native["response_format"]["type"] == "json_schema"
    assert "tools" not in native


@pytest.mark.asyncio
async def test_native_failure_falls_to_prompted(monkeypatch: pytest.MonkeyPatch) -> None:
    guard = _guard(
        monkeypatch,
        [_models(["m1"]), _TOOL_FAIL, _NOT_JSON, _content('{"ok": true}')],
    )

    result = await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=["m1"])

    assert result.validation_status == "ok"
    assert result.output_mode == "prompted"
    prompted = guard.calls[3]["json_body"]
    assert "tools" not in prompted
    assert "response_format" not in prompted


@pytest.mark.asyncio
async def test_all_rungs_failing_is_a_typed_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _guard(monkeypatch, [_models(["m1"]), _TOOL_FAIL, _NOT_JSON, _NOT_JSON])

    result = await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=["m1"])

    assert result.validation_status == "failed"
    assert result.output_mode is None
    assert result.error == "no structured output mode succeeded"
    assert result.models_seen == ["m1"]  # the listing survives a ladder failure


@pytest.mark.asyncio
async def test_malformed_tool_arguments_fall_through(monkeypatch: pytest.MonkeyPatch) -> None:
    """A tool_call whose arguments are not JSON is a rung failure, not ok."""
    guard = _guard(
        monkeypatch,
        [_models(["m1"]), _tool_ok(arguments="{not json"), _content('{"ok": true}')],
    )

    result = await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=["m1"])

    assert result.validation_status == "ok"
    assert result.output_mode == "native"
    assert len(guard.calls) == 3


# ---------------------------------------------------------------------------
# /models failures + probe-model selection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_models_unreachable_is_reason_class_only(monkeypatch: pytest.MonkeyPatch) -> None:
    _guard(monkeypatch, [EndpointUrlError("unreachable: evil.example.com")])

    result = await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=["m1"])

    assert result.validation_status == "failed"
    assert result.output_mode is None
    assert result.models_seen == []
    # Reason class ONLY — the host detail never rides along.
    assert result.error == "unreachable"


@pytest.mark.asyncio
async def test_models_5xx_is_failed_without_body_echo(monkeypatch: pytest.MonkeyPatch) -> None:
    _guard(monkeypatch, [(503, {"error": "upstream exploded at 10.0.0.5"})])

    result = await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=["m1"])

    assert result.validation_status == "failed"
    assert result.error == "http_503"
    assert "exploded" not in repr(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [401, 403])
async def test_models_auth_failure_is_unauthorized(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    _guard(monkeypatch, [(status, {"error": {"message": "bad key sk-live-1"}})])

    result = await probe_endpoint(vetted=_VETTED, api_key="sk-live-1", allowed_models=["m1"])

    assert result.validation_status == "failed"
    assert result.error == "unauthorized"
    assert "sk-live-1" not in repr(result)


@pytest.mark.asyncio
async def test_rung_401_short_circuits_to_unauthorized(monkeypatch: pytest.MonkeyPatch) -> None:
    guard = _guard(monkeypatch, [_models(["m1"]), (401, {"error": "expired"})])

    result = await probe_endpoint(vetted=_VETTED, api_key="k", allowed_models=["m1"])

    assert result.validation_status == "failed"
    assert result.error == "unauthorized"
    assert len(guard.calls) == 2  # native/prompted never tried


@pytest.mark.asyncio
async def test_no_model_to_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    guard = _guard(monkeypatch, [_models([])])

    result = await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=[])

    assert result.validation_status == "failed"
    assert result.output_mode is None
    assert result.error == "no model to probe"
    assert result.models_seen == []
    assert len(guard.calls) == 1  # the ladder never started


@pytest.mark.asyncio
async def test_probe_model_prefers_allowed_then_first_seen(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = _guard(monkeypatch, [_models(["seen-1", "seen-2"]), _tool_ok()])
    await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=["chosen"])
    assert guard.calls[1]["json_body"]["model"] == "chosen"

    guard = _guard(monkeypatch, [_models(["seen-1", "seen-2"]), _tool_ok()])
    await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=[])
    assert guard.calls[1]["json_body"]["model"] == "seen-1"


# ---------------------------------------------------------------------------
# models_seen sanitation at the seam
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_models_seen_capped_truncated_strings_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data: list[Any] = (
        [{"id": 42}, {"id": None}, "not-a-dict", {"noid": True}]  # dropped
        + [{"id": "x" * 300}]  # truncated to 200
        + [{"id": f"m{i}"} for i in range(60)]  # capped at 50 total
    )
    _guard(monkeypatch, [(200, {"object": "list", "data": data}), _tool_ok()])

    result = await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=["m0"])

    assert len(result.models_seen) == 50
    assert result.models_seen[0] == "x" * 200
    assert result.models_seen[1] == "m0"
    assert result.models_seen[-1] == "m48"
    assert all(isinstance(m, str) and len(m) <= 200 for m in result.models_seen)


@pytest.mark.asyncio
async def test_models_body_without_data_is_empty_listing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _guard(monkeypatch, [(200, {"weird": 1})])

    result = await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=[])

    assert result.validation_status == "failed"
    assert result.error == "no model to probe"
    assert result.models_seen == []


# ---------------------------------------------------------------------------
# Key hygiene
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_key_never_in_result(monkeypatch: pytest.MonkeyPatch) -> None:
    _guard(monkeypatch, [_models(["m1"]), _TOOL_FAIL, _NOT_JSON, _NOT_JSON])

    result = await probe_endpoint(vetted=_VETTED, api_key="sk-secret", allowed_models=["m1"])

    assert "sk-secret" not in repr(result)
    assert "sk-secret" not in json.dumps(result.model_dump(mode="json"))


@pytest.mark.asyncio
async def test_bearer_header_sent_only_when_key_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = _guard(monkeypatch, [_models(["m1"]), _tool_ok()])
    await probe_endpoint(vetted=_VETTED, api_key="sk-secret", allowed_models=["m1"])
    assert all(c["headers"].get("Authorization") == "Bearer sk-secret" for c in guard.calls)

    guard = _guard(monkeypatch, [_models(["m1"]), _tool_ok()])
    await probe_endpoint(vetted=_VETTED, api_key=None, allowed_models=["m1"])
    assert all("Authorization" not in c["headers"] for c in guard.calls)

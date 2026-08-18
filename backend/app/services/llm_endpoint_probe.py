"""Capabilities probe for custom LLM endpoints (C2 B5).

``probe_endpoint`` asks an OpenAI-compatible endpoint what it can do:
``GET /models`` first, then a three-rung structured-output ladder over
``POST /chat/completions`` — tool call, native ``json_schema`` response
format, plain prompted JSON — recording the FIRST rung that works as the
endpoint's ``output_mode`` (plan decision 9).

Contract: this function NEVER raises on endpoint behavior — every
outcome is an :class:`LlmEndpointProbeResult`. Errors are sanitized
reason classes only (``unreachable``, ``unauthorized``, ``http_503``,
...): never the key, never a URL or host, never a response body. All
traffic rides :func:`~app.core.net_guard.guarded_json_request`, pinned
to the caller's :class:`~app.core.net_guard.VettedUrl`.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Literal

from app.core.net_guard import EndpointUrlError, VettedUrl, guarded_json_request
from app.schemas.llm_endpoint import LlmEndpointProbeResult

#: Ceiling for the WHOLE ladder (up to four bounded requests). The verify
#: route waits on this synchronously, so it is also the bound on how long
#: that request can hold its database connection.
_PROBE_DEADLINE_S = 60.0

_MODELS_SEEN_CAP = 50
_MODEL_ID_MAX_CHARS = 200
_MAX_TOKENS = 32

_PROBE_TOOL = {
    "type": "function",
    "function": {
        "name": "echo_ok",
        "description": "Echo whether everything is ok.",
        "parameters": {
            "type": "object",
            "properties": {"ok": {"type": "boolean"}},
            "required": ["ok"],
            "additionalProperties": False,
        },
    },
}

_PROBE_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "ok_probe",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {"ok": {"type": "boolean"}},
            "required": ["ok"],
            "additionalProperties": False,
        },
    },
}


def _failed(error: str, models_seen: list[str] | None = None) -> LlmEndpointProbeResult:
    return LlmEndpointProbeResult(
        validation_status="failed",
        output_mode=None,
        models_seen=models_seen or [],
        error=error,
    )


def _reason_class(exc: EndpointUrlError) -> str:
    """``"unreachable: host"`` -> ``"unreachable"`` — the class, never the host."""
    return str(exc).split(":", 1)[0]


def _models_seen(body: Any) -> list[str]:
    """Sanitize a ``/models`` listing at the seam: string ids only, first
    ``_MODELS_SEEN_CAP`` entries, each truncated to ``_MODEL_ID_MAX_CHARS``."""
    data = body.get("data") if isinstance(body, dict) else None
    if not isinstance(data, list):
        return []
    seen: list[str] = []
    for entry in data:
        if len(seen) >= _MODELS_SEEN_CAP:
            break
        model_id = entry.get("id") if isinstance(entry, dict) else None
        if isinstance(model_id, str):
            seen.append(model_id[:_MODEL_ID_MAX_CHARS])
    return seen


def _message(body: Any) -> Any:
    """``choices[0].message`` of a chat completion, or ``None``."""
    if not isinstance(body, dict):
        return None
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0]
    return first.get("message") if isinstance(first, dict) else None


def _parses_as_json(text: Any) -> Any | None:
    if not isinstance(text, str):
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def _tool_rung_succeeded(body: Any) -> bool:
    """A tool_calls entry whose function arguments parse as JSON."""
    message = _message(body)
    tool_calls = message.get("tool_calls") if isinstance(message, dict) else None
    if not isinstance(tool_calls, list) or not tool_calls:
        return False
    call = tool_calls[0]
    function = call.get("function") if isinstance(call, dict) else None
    arguments = function.get("arguments") if isinstance(function, dict) else None
    return _parses_as_json(arguments) is not None


def _native_rung_succeeded(body: Any) -> bool:
    """Content parses as JSON matching the trivial schema."""
    message = _message(body)
    parsed = _parses_as_json(message.get("content") if isinstance(message, dict) else None)
    return isinstance(parsed, dict) and isinstance(parsed.get("ok"), bool)


def _prompted_rung_succeeded(body: Any) -> bool:
    """Content parses as JSON at all."""
    message = _message(body)
    content = message.get("content") if isinstance(message, dict) else None
    return _parses_as_json(content) is not None


def _rung_body(rung: str, model: str) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": 'Reply with exactly {"ok": true}'}],
        "temperature": 0,
        "max_tokens": _MAX_TOKENS,
    }
    if rung == "tool":
        body["messages"] = [{"role": "user", "content": "Call the provided tool."}]
        body["tools"] = [_PROBE_TOOL]
        body["tool_choice"] = "required"
    elif rung == "native":
        body["response_format"] = _PROBE_RESPONSE_FORMAT
    return body


_RUNG_CHECKS = {
    "tool": _tool_rung_succeeded,
    "native": _native_rung_succeeded,
    "prompted": _prompted_rung_succeeded,
}


async def probe_endpoint(
    *,
    vetted: VettedUrl,
    api_key: str | None,
    allowed_models: list[str],
) -> LlmEndpointProbeResult:
    """The ladder under ONE overall deadline (``_PROBE_DEADLINE_S``).

    Each request is individually bounded by the guard, but the ladder is
    up to four of them back to back — and the caller (the verify route)
    waits on this with a database connection in hand. Blowing the ceiling
    is a typed ``failed`` result like any other endpoint misbehaviour;
    this function still never raises on endpoint behavior.
    """
    try:
        async with asyncio.timeout(_PROBE_DEADLINE_S):
            return await _run_ladder(vetted=vetted, api_key=api_key, allowed_models=allowed_models)
    except TimeoutError:
        return _failed("timeout")


async def _run_ladder(
    *,
    vetted: VettedUrl,
    api_key: str | None,
    allowed_models: list[str],
) -> LlmEndpointProbeResult:
    """GET /models, then the tool -> native -> prompted ladder.

    Probe model = ``allowed_models[0]``, else the first ``/models`` id,
    else a typed "no model to probe" failure. Never raises on endpoint
    failure — returns ``validation_status="failed"`` plus a sanitized
    error. ``models_seen`` capped at the seam (50 entries, each <=200
    chars, strings only).
    """
    headers: dict[str, str] = {}
    if api_key is not None:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        status, body = await guarded_json_request("GET", vetted, "/models", headers=headers)
    except EndpointUrlError as exc:
        return _failed(_reason_class(exc))
    if status in (401, 403):
        return _failed("unauthorized")
    if not 200 <= status < 300:
        return _failed(f"http_{status}")

    models_seen = _models_seen(body)
    probe_model = allowed_models[0] if allowed_models else models_seen[0] if models_seen else None
    if probe_model is None:
        return _failed("no model to probe", models_seen)

    rungs: list[Literal["tool", "native", "prompted"]] = ["tool", "native", "prompted"]
    for rung in rungs:
        try:
            status, body = await guarded_json_request(
                "POST",
                vetted,
                "/chat/completions",
                headers=headers,
                json_body=_rung_body(rung, probe_model),
            )
        except EndpointUrlError:
            continue  # a mid-ladder network failure is a rung failure
        if status in (401, 403):
            return _failed("unauthorized", models_seen)
        if not 200 <= status < 300:
            continue
        if _RUNG_CHECKS[rung](body):
            return LlmEndpointProbeResult(
                validation_status="ok",
                output_mode=rung,
                models_seen=models_seen,
                error=None,
            )
    return _failed("no structured output mode succeeded", models_seen)

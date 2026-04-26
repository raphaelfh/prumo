"""Assertions for standardized API contract checks in integration tests."""

from uuid import UUID


def assert_trace_id(value: object) -> None:
    """Assert trace_id exists and is a valid UUID string."""
    if not isinstance(value, str) or not value:
        raise AssertionError("trace_id must be a non-empty string")
    try:
        UUID(value)
    except ValueError as exc:
        raise AssertionError(f"trace_id is not a valid UUID: {value}") from exc


def assert_api_response_contract(payload: object, *, expect_ok: bool | None = None) -> dict:
    """Assert payload matches `{ok, data?, error?, trace_id?}` envelope."""
    if not isinstance(payload, dict):
        raise AssertionError(f"expected response payload dict, got {type(payload)!r}")

    if "ok" not in payload:
        raise AssertionError("response missing required 'ok' field")
    if not isinstance(payload["ok"], bool):
        raise AssertionError("response 'ok' must be a boolean")

    if expect_ok is not None and payload["ok"] is not expect_ok:
        raise AssertionError(f"expected ok={expect_ok}, got ok={payload['ok']}")

    if "trace_id" in payload and payload["trace_id"] is not None:
        assert_trace_id(payload["trace_id"])

    if payload["ok"]:
        if "error" in payload and payload["error"] is not None:
            raise AssertionError("successful payload must not include error object")
    else:
        error = payload.get("error")
        if not isinstance(error, dict):
            raise AssertionError("error payload must include error object")
        if "code" not in error or "message" not in error:
            raise AssertionError("error object must include code and message")

    return payload

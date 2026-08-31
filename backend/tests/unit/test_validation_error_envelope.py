"""Request-validation 422s must speak the ApiResponse envelope.

FastAPI's default ``RequestValidationError`` handler answers with a bare
``{"detail": [...]}`` — no ``ok``, no ``error`` — so the typed frontend
client falls back to "Unknown error" and nothing is logged server-side.
That mute shape is exactly how the template-publish double-stringify
outage stayed invisible: three prod 422s, zero envelope, zero logs.
These tests pin the custom handler: envelope on the outside, the
per-field Pydantic errors preserved in ``error.details``.
"""

import pytest


@pytest.mark.asyncio
async def test_body_validation_422_is_enveloped(client) -> None:
    # A JSON *string literal* body — the double-stringify wire shape that
    # Pydantic refuses with model_attributes_type.
    res = await client.post(
        "/api/v1/feedback",
        content='"not an object"',
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 422, res.text
    body = res.json()
    assert body["ok"] is False
    assert "detail" not in body
    assert body["error"]["code"] == "VALIDATION_ERROR"
    # The message names the offending location so the client toast (and a
    # console log) is diagnosable without server access.
    assert "body" in body["error"]["message"]
    errors = body["error"]["details"]["errors"]
    assert isinstance(errors, list) and errors
    assert errors[0]["type"] == "model_attributes_type"


@pytest.mark.asyncio
async def test_422_never_echoes_the_submitted_input(client) -> None:
    """A ``missing``-type error sets Pydantic's ``input`` to the WHOLE body.

    On any endpoint carrying a credential that would echo the secret into
    the logs and back down the wire, so the handler drops ``input``
    entirely. Asserted on a body that omits a required field — the exact
    shape that carries the full payload.
    """
    secret = "sk-must-never-appear-in-a-log"  # noqa: S105 - probe value, not a credential
    res = await client.post(
        "/api/v1/feedback",
        json={"severity": "high", "description": "x" * 40, "api_key": secret},
    )
    assert res.status_code == 422, res.text
    assert secret not in res.text
    for err in res.json()["error"]["details"]["errors"]:
        assert "input" not in err
        assert set(err) == {"type", "loc", "msg"}


@pytest.mark.asyncio
async def test_field_validation_422_keeps_every_error(client) -> None:
    res = await client.post(
        "/api/v1/feedback",
        json={"type": "bug", "severity": "nope", "description": "short"},
    )
    assert res.status_code == 422, res.text
    body = res.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "VALIDATION_ERROR"
    locs = [tuple(err["loc"]) for err in body["error"]["details"]["errors"]]
    # Both offending fields are reported, not just the first.
    assert any("severity" in loc for loc in locs)
    assert any("description" in loc for loc in locs)

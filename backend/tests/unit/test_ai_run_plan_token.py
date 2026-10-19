"""The plan token format: ``aip1.<b64url payload>.<b64url mac>``, HKDF-keyed HMAC."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.api.mcp import ai_run_plan_token
from app.api.mcp.ai_run_plan_token import mint, minting_allowed
from app.core.config import Settings, settings

_TOKEN = re.compile(r"^aip1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")


def _b64decode(segment: str) -> bytes:
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def _claims(selection: object = "remaining") -> dict:
    return {
        "token_id": str(uuid4()),
        "user_id": str(uuid4()),
        "project_id": str(uuid4()),
        "template_id": str(uuid4()),
        "template_version_id": str(uuid4()),
        "selection": selection,
        "rerun": False,
        "will_run_digest": hashlib.sha256(b"x").hexdigest(),
        "will_run_count": 3,
        "engine": {"provider": "openai", "model": "m", "mode": "fast", "connection_id": None},
        "payer": "your_key",
        "iat": 1_760_000_000,
    }


def test_mint_shape_payload_mac_and_digest(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "unit-test-key")
    claims = _claims()

    token, digest = mint(claims)

    assert _TOKEN.match(token)
    _prefix, payload_b64, mac_b64 = token.split(".")
    payload = _b64decode(payload_b64)
    assert json.loads(payload) == {"v": "aip1", **claims}
    key = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=b"prumo:mcp:ai-run-plan:v1"
    ).derive(b"unit-test-key")
    assert _b64decode(mac_b64) == hmac.new(key, payload, hashlib.sha256).digest()
    assert digest == hashlib.sha256(payload).hexdigest()


def test_a_different_key_gives_a_different_mac(monkeypatch: pytest.MonkeyPatch) -> None:
    claims = _claims()
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "key-one")
    first, _ = mint(claims)
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", "key-two")
    second, _ = mint(claims)

    assert first.split(".")[1] == second.split(".")[1]
    assert first.split(".")[2] != second.split(".")[2]


def test_one_hundred_explicit_ids_fit_the_start_argument_cap() -> None:
    ids = b"".join(uuid4().bytes for _ in range(100))
    selection = base64.urlsafe_b64encode(ids).rstrip(b"=").decode()

    token, _ = mint(_claims(selection))

    # start_ai_run caps plan_token at 4,096 chars (its Field max_length).
    assert len(token) <= 4096


def test_ttl_is_thirty_minutes() -> None:
    assert ai_run_plan_token.TOKEN_TTL.total_seconds() == 30 * 60


@pytest.mark.parametrize(
    ("key_is_default", "env", "allowed"),
    [(True, None, False), (True, "local", True), (False, None, True)],
    ids=["placeholder-production", "placeholder-local", "real-key"],
)
def test_minting_allowed(
    monkeypatch: pytest.MonkeyPatch, key_is_default: bool, env: str | None, allowed: bool
) -> None:
    default = Settings.model_fields["ENCRYPTION_KEY"].default
    monkeypatch.setattr(settings, "ENCRYPTION_KEY", default if key_is_default else "real-secret")
    monkeypatch.setattr(settings, "SUPABASE_ENV", env)

    assert minting_allowed() is allowed

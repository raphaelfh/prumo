"""The signed plan token ``plan_ai_run`` mints and ``start_ai_run`` verifies.

``aip1.<b64url payload>.<b64url mac>``: the payload is the compact JSON of the
plan's claims; the MAC is HMAC-SHA256 under a key derived (HKDF) from
``ENCRYPTION_KEY``, so the token carries no secret and cannot be forged or
edited. ``plan_digest`` (sha256 of the payload bytes) names the plan.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import timedelta
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import Settings, settings

TOKEN_VERSION = "aip1"
TOKEN_TTL = timedelta(minutes=30)
_HKDF_INFO = b"prumo:mcp:ai-run-plan:v1"


def minting_allowed() -> bool:
    """False while ``ENCRYPTION_KEY`` is still the placeholder outside local dev."""
    placeholder = Settings.model_fields["ENCRYPTION_KEY"].default == settings.ENCRYPTION_KEY
    return not placeholder or settings.supabase_env == "local"


def _key() -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_HKDF_INFO).derive(
        settings.ENCRYPTION_KEY.encode()
    )


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def mint(claims: dict[str, Any]) -> tuple[str, str]:
    """``(token, plan_digest)`` for ``claims`` (JSON-ready values only)."""
    payload = json.dumps({"v": TOKEN_VERSION, **claims}, separators=(",", ":")).encode()
    mac = hmac.new(_key(), payload, hashlib.sha256).digest()
    return f"{TOKEN_VERSION}.{_b64(payload)}.{_b64(mac)}", hashlib.sha256(payload).hexdigest()

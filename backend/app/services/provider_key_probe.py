"""Cheap authenticated call per HOSTED provider (§4 verify).

The call itself is the registry row's ``probe`` adapter
(``app.llm.adapters``); this wrapper owns the client, the transport
failure class (``unreachable``) and the log line.
"""

from __future__ import annotations

import httpx

from app.core.logging import get_logger
from app.llm.adapters import Outcome
from app.llm.registry import get_provider

logger = get_logger(__name__)


async def probe_hosted_key(provider: str, api_key: str) -> Outcome:
    spec = get_provider(provider)
    if spec is None or spec.probe is None:
        raise ValueError(f"{provider!r} is not a hosted provider")
    try:
        async with httpx.AsyncClient() as client:
            return await spec.probe(client, api_key)
    except Exception:
        # Never echo transport detail (it can embed request data); the log has it.
        logger.warning("provider_key_probe_unreachable", provider=provider, exc_info=True)
        return ("failed", "unreachable")

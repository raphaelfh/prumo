"""Capabilities probe for custom LLM endpoints (C2 — implemented in B5).

B4 seam: :meth:`LlmEndpointService.verify` imports and calls this per the
plan signature; the actual ladder (GET /models, then tool -> native ->
prompted via ``guarded_json_request``) lands in task B5, which replaces
this stub body. B4's tests monkeypatch the name imported into
``llm_endpoint_service``.
"""

from app.core.net_guard import VettedUrl
from app.schemas.llm_endpoint import LlmEndpointProbeResult


async def probe_endpoint(
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
    raise NotImplementedError("implemented in C2 task B5")

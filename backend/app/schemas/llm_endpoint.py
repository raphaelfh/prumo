"""Probe shapes shared by the host probe and the connection read.

The credential CRUD that used to live here went with
``project_llm_endpoints`` (migration 0073); what remains is the pair of
shapes the endpoint probe produces and the connection read re-validates
from JSONB. Secrets have no field on either — key material never crosses
this boundary.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, field_validator

from app.core.logging import get_logger

logger = get_logger(__name__)

_OUTPUT_MODES = ("tool", "native", "prompted")


class LlmEndpointCapabilities(BaseModel):
    """What the probe learned about an endpoint.

    ``output_mode`` is the highest probe-ladder rung the endpoint passed
    (tool → native → prompted); ``None`` means never probed.
    ``models_seen`` is the sanitized ``/models`` listing captured at
    probe time (capped at the probe seam, not here).
    """

    output_mode: Literal["tool", "native", "prompted"] | None = None
    models_seen: list[str] = []

    @field_validator("output_mode", mode="before")
    @classmethod
    def _normalize_output_mode(cls, v: Any) -> Any:
        """An unknown stored mode degrades to ``None`` — loudly, never fatally.

        This model is re-validated from JSONB on every read (the LIST route,
        the engine-choice gate), so a value written by another build — or by
        hand — must not 500 the whole manager surface. Same posture as
        ``LlmEngineStored.mode``; ``None`` simply means "capability unknown",
        which every consumer already handles.
        """
        if v is None or v in _OUTPUT_MODES:
            return v
        logger.warning("llm_endpoint_unknown_output_mode_normalized", stored_output_mode=str(v))
        return None


class LlmEndpointProbeResult(BaseModel):
    """Outcome of a verify probe, as returned to the manager.

    ``error`` is sanitized — a reason class only (timeout, refused,
    TLS, HTTP status), never raw upstream bodies or connection detail.
    """

    validation_status: Literal["ok", "failed"]
    output_mode: Literal["tool", "native", "prompted"] | None
    models_seen: list[str]
    error: str | None  # sanitized: reason class only

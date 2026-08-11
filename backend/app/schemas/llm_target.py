"""Typed spine for the engine a run is pinned to.

The single source of truth for the ``engine`` payload the extraction service
freezes into ``extraction_runs.results["provenance"]["engine"]``. Built once at
the write site and stored via ``.model_dump()``; the repository merges the
resulting dict and hands it back. Same pattern as ``prompt_composition`` — the
JSONB bag is otherwise untyped, so a key typo at the write site would ship
silently, and here it would silently un-pin the engine.

Provider and model travel together because they are only meaningful together:
``build_model`` takes the pair, and a provenance record naming one without the
other cannot be reproduced.
"""

from __future__ import annotations

from pydantic import BaseModel


class LlmTarget(BaseModel):
    """The provider + model an extraction run is pinned to for its whole life.

    Frozen on the run's first LLM call and reused by every later one — a Celery
    retry re-enters with the same payload but a fresh ``settings`` read, so
    without the pin attempt 2 could run a different engine than attempt 1.
    """

    provider: str
    model: str

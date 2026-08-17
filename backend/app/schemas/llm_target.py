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

    ``mode_requested`` / ``mode_executed`` (C1b, §5) ride on the same spine so
    the freeze dump/validate contract stays single-sourced; they default to
    ``"fast"`` so pre-C1b pinned snapshots (which carry only the pair) still
    validate. Both frozen fields are a REQUEST-ECHO — frozen before
    execution, per-run; sections can diverge individually — never an
    execution claim. Execution truth lives ONLY in
    ``results.provenance.sections[et_id].mode_executed`` / ``passes``;
    renderers must never surface these engine-level fields as what actually
    ran. They stay bare ``str`` on purpose: ``read_pinned_engine``
    model_validates legacy pinned snapshots, and a Literal would turn a
    corrupt old snapshot into a hard read failure on a pinned run.
    """

    provider: str
    model: str
    mode_requested: str = "fast"
    mode_executed: str = "fast"

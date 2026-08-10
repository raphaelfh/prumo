"""Resolve which engine (LLM model) actually produced a run's AI suggestions.

The answer has exactly one trustworthy source: ``run.results["provenance"]``.
Only the server writes it — ``SectionExtractionService._build_run_provenance``
fills it from the extractor's own constants and
``ExtractionRunRepository.merge_provenance_section`` merges it under a row
lock. No request body can reach it.

The obvious-looking alternative, ``run.parameters["model"]``, is NOT a record
of what ran:

* ``CreateRunRequest.parameters`` is a free-form ``dict[str, Any]`` with no
  allow-list, ``POST /api/v1/runs`` is authorized by
  ``ensure_project_reviewer``, and the bag is persisted verbatim — so an
  ordinary project reviewer can hand-write the engine name that ends up in a
  published export.
* It is usually absent anyway. A run opened through the HITL session carries
  ``{"opened_via": "hitl_session", "kind": ...}`` and no ``model`` key, which
  is why the export's "Model used" column read blank for the normal path while
  the review UI — which reads provenance — displayed the real engine.

``parameters["model"]`` therefore survives only as the last-resort fallback for
legacy runs recorded before provenance existed, where it is the only record
there is.

The per-section snapshot shape read here is the same one the review UI renders;
see ``_resolve_section_provenance`` in ``extraction_suggestion_read_service``.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

#: Joins the candidates when a proposal cannot be attributed to one section's
#: snapshot. Matches the ``evidence_text`` joiner on the same sheet.
_CANDIDATE_SEPARATOR = " | "


def resolve_model_used(
    parameters: dict[str, Any] | None,
    results: dict[str, Any] | None,
    *,
    entity_type_id: UUID | None,
) -> str:
    """The engine to report for one AI proposal, most trustworthy source first.

    1. The proposal's OWN section snapshot. Exact even when a run's sections
       ran different engines, so it is always preferred when present.
    2. The run's other section snapshots, when this section has none. A single
       distinct engine across them is unambiguous: report it.
    3. More than one distinct engine at step 2 — report ALL of them, sorted and
       joined. Nothing on the row says which produced this proposal, so naming
       one would be a guess printed as a fact; sorting keeps the cell stable
       across export builds instead of following dict order.
    4. The flat pre-``sections`` snapshot, for legacy runs.
    5. ``parameters["model"]`` — legacy runs only; see the module docstring for
       why this ranks last rather than first.
    6. ``""`` when nothing was ever recorded. An empty cell is the truthful
       rendering of "no record"; a default engine name would invent one.
    """
    provenance = (results or {}).get("provenance") or {}
    raw_sections = provenance.get("sections") if isinstance(provenance, dict) else None
    sections = raw_sections if isinstance(raw_sections, dict) else {}

    own = _model_of(sections.get(str(entity_type_id))) if entity_type_id else ""
    if own:
        return own
    candidates = sorted({model for s in sections.values() if (model := _model_of(s))})
    if candidates:
        return _CANDIDATE_SEPARATOR.join(candidates)
    return _model_of(provenance) or _model_of(parameters)


def _model_of(snapshot: object) -> str:
    """One snapshot's ``model`` as a string; ``""`` when absent or malformed."""
    if not isinstance(snapshot, dict):
        return ""
    model = snapshot.get("model")
    return model if isinstance(model, str) else ""


__all__ = ["resolve_model_used"]

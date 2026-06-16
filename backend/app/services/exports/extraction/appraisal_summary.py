"""Appraisal-summary sub-builder (§7).

Pure, no-IO. Computes a per-domain-verdict + worst-case Overall sheet for
quality-assessment templates. Consumes already-resolved scalars from the
layout's value_map (resolve_value ran upstream); never re-handles envelopes.
"""

from __future__ import annotations

from typing import Any

# Worst-case severity order, most severe first. Case-insensitive match.
# Covers PROBAST (High/Unclear/Low), QUADAS-2 (High/Unclear/Low),
# ROB-2 / ROBINS-I (High/Some concerns/Moderate/Serious/Critical/Low).
_SEVERITY_RANK: tuple[str, ...] = (
    "critical",
    "serious",
    "high",
    "some concerns",
    "moderate",
    "unclear",
    "low",
)

# Recognised risk-label vocabulary (case-folded). Single source of truth for
# "which SELECT field is a domain verdict": a domain's verdict field is the
# first SELECT whose allowed_values are all drawn from this set, which
# separates the judgment fields (Low/High/Unclear) from the SELECT-typed
# signalling questions (Y/PY/PN/N/NI/NA, Y/N/Unclear). Reused by
# extraction_export_service._build_appraisal_model (§7 verdict selection).
_RISK_LABELS: frozenset[str] = frozenset(_SEVERITY_RANK)


def _verdict_rank(verdict: Any) -> int:
    """Severity rank for one verdict; higher == worse. Blank == -1 (ignored).

    A non-empty verdict not in the known table outranks every known label
    (rank == len(table)) so a novel risk label never silently downgrades the
    Overall — the rollup fails toward caution, not toward a green light.
    """
    if verdict is None:
        return -1
    text = str(verdict).strip()
    if not text:
        return -1
    lowered = text.casefold()
    for rank, label in enumerate(reversed(_SEVERITY_RANK)):
        if lowered == label:
            return rank
    # Unknown non-empty label: most severe.
    return len(_SEVERITY_RANK)


def _appraisal_overall(verdicts: tuple[Any, ...]) -> Any:
    """Worst-case rollup over a record's domain verdicts (§7).

    Returns the original (label-preserving) verdict with the highest severity
    rank; blanks are ignored; an all-blank record yields None (blank Overall).
    Ties resolve to the first encountered, keeping output deterministic.
    """
    worst: Any = None
    worst_rank = -1
    for verdict in verdicts:
        rank = _verdict_rank(verdict)
        if rank > worst_rank:
            worst_rank = rank
            worst = verdict
    return worst if worst_rank >= 0 else None

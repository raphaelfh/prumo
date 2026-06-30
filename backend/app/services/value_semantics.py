"""Pure predicates for extraction value emptiness (no DB, no IO).

ONE rule, two polarities, shared by the two callers that previously each kept
their own copy:

- ``is_value_filled`` — the finalize completeness gate
  (``run_lifecycle_service``): a run may not publish while a required field is
  empty. The authoritative server-side mirror of the frontend ``progress.ts``
  metric, so it must never be STRICTER than the form the user just saw.
- ``is_value_empty`` — the AI-suggestion "no information" rule
  (``extraction_suggestion_read_service``): a later abstention must not bury an
  earlier real value in the dedup.

Both mirror the frontend ``isNoInfoValue`` (``value === null | undefined | ''``):
only ``None`` and the empty string are empty. Whitespace, ``0``, ``False``,
``[]`` and non-envelope dicts all count as filled. Layer-legal (services, no IO)
under ``scripts/fitness/check_layered_arch.py``.
"""

from __future__ import annotations

from typing import Any


def unwrap_value_envelope(raw: Any) -> Any:
    """Peel a single ``{"value": X}`` envelope, matching the frontend's one-level
    unwrap in ``progress.ts`` / ``useReviewerSummary``. A bare scalar (or any dict
    without a ``value`` key) is returned untouched.
    """
    if isinstance(raw, dict) and "value" in raw:
        return raw["value"]
    return raw


def is_value_empty(raw: Any) -> bool:
    """True when *raw* carries no information — ``None`` or the empty string,
    after peeling one ``{"value": X}`` envelope. The inverse of
    ``is_value_filled``.
    """
    value = unwrap_value_envelope(raw)
    return value is None or (isinstance(value, str) and value == "")


def is_value_filled(raw: Any) -> bool:
    """True when a stored value counts as "filled" for completeness — the
    negation of ``is_value_empty``.
    """
    return not is_value_empty(raw)

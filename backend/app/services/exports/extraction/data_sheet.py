"""The machine-readable Data sheet (spec §4.1) and its AI-provenance rules (§7).

Origin is computed here only, against the run's PINNED field through
``values.canonical_equal`` (both-sides fallback to peeled raw values).
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date
from typing import TYPE_CHECKING, Final, Literal

from app.services.exports.values import canonical_equal
from app.services.run_lifecycle_service import APPROVE_ALL_RATIONALE
from app.services.value_semantics import is_value_filled

if TYPE_CHECKING:
    from app.schemas.extraction_run import RunViewField
    from app.services.exports.cell_record import CellRecord

Origin = Literal["ai_accepted", "ai_edited", "human", "rule", "mixed"]
ConsensusMethod = Literal["select_existing", "no_conflict", "override"]

# PR2 (proposal links on every write) reached prod at 2026-10-31T21:41:32Z,
# recorded on PR #1067 (R21). Before it, a value typed over an AI suggestion
# was saved unlinked and reads ``human`` with ``ai_proposed=true``.
LINEAGE_EXACT_SINCE: Final[date] = date(2026, 10, 31)


def origin_of(cell: CellRecord, pinned_field: RunViewField | None) -> Origin:
    """``ai_accepted`` / ``ai_edited`` for a filled value linked to an AI proposal,
    else ``human`` (unlinked, a non-AI link such as a reopen's ``system`` seed,
    or nothing filled)."""
    link = cell.linked_proposal
    if link is None or link.source != "ai" or not is_value_filled(cell.envelope):
        return "human"
    if canonical_equal(cell.envelope, link.proposed_value, pinned_field):
        return "ai_accepted"
    return "ai_edited"


def consensus_origin_of(
    cell: CellRecord,
    reviewers: Sequence[CellRecord],
    pinned_field: RunViewField | None,
) -> tuple[Origin, ConsensusMethod]:
    """A consensus row's origin and method. ``cell.linked_proposal`` already is the
    selected decision's own link (D10); ``reviewers`` are the coordinate's
    reviewer cells, read only for an approve-all (``no_conflict``) row."""
    if cell.decision.kind == "select_existing":
        return origin_of(cell, pinned_field), "select_existing"
    if cell.decision.rationale == APPROVE_ALL_RATIONALE:
        origins = {origin_of(r, pinned_field) for r in reviewers if is_value_filled(r.envelope)}
        return (origins.pop() if len(origins) == 1 else "mixed"), "no_conflict"
    return "human", "override"

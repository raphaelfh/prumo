"""One loaded cell of the export: its envelope, the decision behind it and its proposal link.

PURE value types. Lives directly under ``exports/`` (not ``exports/extraction/``):
that package's ``__init__`` imports the workbook, which imports the export
service, so a runtime import from there would close a cycle.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal
from uuid import UUID

from app.services.exports.values import to_export_value

if TYPE_CHECKING:
    from app.services.exports.descriptors import ValueKey
    from app.services.exports.values import ExportValue, OptionLabels
    from app.services.extraction_export_service import FieldDescriptor

DecisionKind = Literal["accept_proposal", "edit", "reject", "select_existing", "manual_override"]


@dataclass(frozen=True, slots=True)
class DecisionFact:
    """The decision a cell was read from: a reviewer decision (``accept_proposal``,
    ``edit``, ``reject``) or a consensus decision (``select_existing``,
    ``manual_override``)."""

    id: UUID
    kind: DecisionKind
    actor_id: UUID
    created_at: datetime
    rationale: str | None
    selected_decision_id: UUID | None


@dataclass(frozen=True, slots=True)
class LinkedProposal:
    """The proposal a decision links to; ``run_id`` may differ from the cell's run."""

    id: UUID
    run_id: UUID
    source: str
    proposed_value: Any


@dataclass(frozen=True, slots=True)
class CellRecord:
    """On a consensus cell, ``linked_proposal`` is the SELECTED decision's own
    link (D10), which need not be that reviewer's current decision."""

    envelope: Any
    decision: DecisionFact
    linked_proposal: LinkedProposal | None


def value_map_from_cells(
    cells: Mapping[ValueKey, CellRecord],
    *,
    slots: Literal["consensus", "reviewer", "both"],
    fields: Mapping[UUID, FieldDescriptor],
    labels: OptionLabels,
) -> dict[ValueKey, ExportValue]:
    """The export values of ``cells`` under their own keys (R1); ``slots`` keeps
    the consensus slot (rater ``None``), the reviewer slots, or both."""
    return {
        k: to_export_value(c.envelope, fields[k[2]], labels, rejected=c.decision.kind == "reject")
        for k, c in cells.items()
        if slots == "both" or (k[3] is None) == (slots == "consensus")
    }

"""One loaded cell of the export: its envelope, the decision behind it and its proposal link.

PURE value types. Lives directly under ``exports/`` (not ``exports/extraction/``):
that package's ``__init__`` imports the workbook, which imports the export
service, so a runtime import from there would close a cycle.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

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

"""Screening outcome derivation: pure rules over each reviewer's current decision.

Nothing here touches the database. ``derive_state`` turns the current decisions
and the latest ruling into a phase and an outcome; ``caller_status`` and
``reveals_peers`` decide what one caller is told about it. ``reveals_peers`` is
THE blind-review rule: every read that could show another reviewer's decision
asks it.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID

from app.schemas.screening import (
    ScreeningCallerStatus,
    ScreeningDecisionValue,
    ScreeningOutcomeKind,
)


@dataclass(frozen=True, slots=True)
class CurrentDecision:
    """One reviewer's latest decision on one assignment.

    ``rationale`` plays no part in the derivation; it rides along so a read
    that shows the decision needs no second query.
    """

    id: UUID
    reviewer_id: UUID
    decision: ScreeningDecisionValue
    exclusion_reason: str | None
    created_at: datetime
    rationale: str | None = None


@dataclass(frozen=True, slots=True)
class CurrentRuling:
    """The latest arbitration on one assignment."""

    id: UUID
    decision: ScreeningDecisionValue
    exclusion_reason: str | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class Outcome:
    kind: ScreeningOutcomeKind
    decision: ScreeningDecisionValue
    exclusion_reason: str | None
    reasons_differ: bool


@dataclass(frozen=True, slots=True)
class AssignmentState:
    phase: Literal["pending", "conflict", "decided"]
    outcome: Outcome | None


_PENDING = AssignmentState("pending", None)
_CONFLICT = AssignmentState("conflict", None)


def derive_state(
    reviewer_count: int,
    decisions: Sequence[CurrentDecision],
    ruling: CurrentRuling | None,
) -> AssignmentState:
    """The assignment's phase and outcome; ``decisions`` holds each reviewer's CURRENT one.

    The latest ruling stands even when a reviewer changes their decision later.
    """
    if ruling is not None:
        return AssignmentState(
            "decided", Outcome("arbitrated", ruling.decision, ruling.exclusion_reason, False)
        )
    if len(decisions) < reviewer_count:
        return _PENDING
    values = {d.decision for d in decisions}
    if len(values) != 1:
        return _CONFLICT
    reasons = {d.exclusion_reason for d in decisions}
    differ = len(reasons) > 1
    kind: ScreeningOutcomeKind = "solo" if reviewer_count == 1 else "consensus"
    reason = None if differ else next(iter(reasons))
    return AssignmentState("decided", Outcome(kind, values.pop(), reason, differ))


def caller_status(
    state: AssignmentState,
    decisions: Sequence[CurrentDecision],
    caller_id: UUID,
    *,
    is_arbitrator: bool,
    can_review: bool,
) -> ScreeningCallerStatus:
    """What the assignment asks of the caller.

    A conflict reads as ``awaiting_others`` to anyone but an arbitrator, so a
    reviewer never learns that a peer disagreed; a viewer is never asked to act.
    """
    if state.outcome is not None:
        return "decided"
    if state.phase == "conflict":
        return "conflict" if is_arbitrator else "awaiting_others"
    has_decided = any(d.reviewer_id == caller_id for d in decisions)
    return "awaiting_me" if can_review and not has_decided else "awaiting_others"


def reveals_peers(state: AssignmentState, *, is_arbitrator: bool) -> bool:
    """THE blind-review rule: peers show once there is an outcome, or to an arbitrator in conflict."""
    return state.outcome is not None or (state.phase == "conflict" and is_arbitrator)

"""Screening outcome derivation: pure rules over each reviewer's current decision.

Nothing here touches the database. ``derive_state`` turns the current decisions
and the latest ruling into a phase and an outcome; ``caller_status`` and
``reveals_peers`` decide what one caller is told about it; ``record_status``
is the records list's reading of ``caller_status``. ``reveals_peers`` is
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
    ScreeningRecordStatus,
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
    """The assignment's phase and outcome; ``decisions`` holds each reviewer's decision.

    A reviewer's latest decision is their current one: final in dual review,
    re-decidable by a solo reviewer until a ruling (§6.3); the latest ruling is
    the last word.
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
    *,
    seated: bool,
    is_arbitrator: bool,
    can_review: bool,
) -> ScreeningCallerStatus:
    """What the assignment asks of the caller; ``seated`` = the caller has a decision on it.

    A conflict reads as ``awaiting_others`` to anyone but an unseated arbitrator,
    so a reviewer never learns that a peer disagreed and a seated arbitrator is
    never asked to resolve their own record; a viewer is never asked to act.
    """
    if state.outcome is not None:
        return "decided"
    if state.phase == "conflict":
        return "conflict" if is_arbitrator and not seated else "awaiting_others"
    return "awaiting_me" if can_review and not seated else "awaiting_others"


_DECIDED_STATUS: dict[ScreeningDecisionValue, ScreeningRecordStatus] = {
    "include": "included",
    "exclude": "excluded",
    "maybe": "maybe",
}


def record_status(
    state: AssignmentState,
    *,
    seated: bool,
    is_arbitrator: bool,
    can_review: bool,
) -> ScreeningRecordStatus:
    """The records-list status of an enrolled record for one caller, through ``caller_status``.

    ``awaiting_others`` splits on the seat rule: ``waiting`` for a caller who
    decided, ``in_review`` for anyone else, so a conflict never shows to a
    reviewer as anything but those two.
    """
    status = caller_status(state, seated=seated, is_arbitrator=is_arbitrator, can_review=can_review)
    if status == "decided":
        assert state.outcome is not None  # caller_status answers decided only with an outcome
        return _DECIDED_STATUS[state.outcome.decision]
    if status == "awaiting_me":
        return "to_screen"
    if status == "conflict":
        return "conflict"
    return "waiting" if seated else "in_review"


def reveals_peers(state: AssignmentState, *, seated: bool, is_arbitrator: bool) -> bool:
    """THE blind-review rule: peers show once there is an outcome, or to an unseated arbitrator in conflict."""
    return state.outcome is not None or (state.phase == "conflict" and is_arbitrator and not seated)

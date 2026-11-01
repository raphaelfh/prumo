"""Screening outcome derivation: the pure rules every screening read goes through."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from app.services.screening_outcome import (
    AssignmentState,
    CurrentDecision,
    CurrentRuling,
    Outcome,
    caller_status,
    derive_state,
    record_status,
    reveals_peers,
)

A, B, C = uuid4(), uuid4(), uuid4()
_AT = datetime(2026, 1, 1, tzinfo=UTC)


def _d(reviewer: UUID, decision: str, reason: str | None = None) -> CurrentDecision:
    return CurrentDecision(
        id=uuid4(), reviewer_id=reviewer, decision=decision, exclusion_reason=reason, created_at=_AT
    )  # type: ignore[arg-type]


def _ruling(decision: str, reason: str | None = None) -> CurrentRuling:
    return CurrentRuling(id=uuid4(), decision=decision, exclusion_reason=reason, created_at=_AT)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("rc", "decisions", "ruling", "phase", "outcome"),
    [
        (1, [], None, "pending", None),
        (1, [_d(A, "exclude", "R1")], None, "decided", ("solo", "exclude", "R1", False)),
        (2, [_d(A, "include")], None, "pending", None),
        (
            2,
            [_d(A, "include"), _d(B, "include")],
            None,
            "decided",
            ("consensus", "include", None, False),
        ),
        (2, [_d(A, "include"), _d(B, "exclude")], None, "conflict", None),
        (
            2,
            [_d(A, "exclude", "R1"), _d(B, "exclude", "R1")],
            None,
            "decided",
            ("consensus", "exclude", "R1", False),
        ),
        (
            2,
            [_d(A, "exclude", "R1"), _d(B, "exclude", "R2")],
            None,
            "decided",
            ("consensus", "exclude", None, True),
        ),
        (
            2,
            [_d(A, "exclude", "R1"), _d(B, "exclude")],
            None,
            "decided",
            ("consensus", "exclude", None, True),
        ),
        (3, [_d(A, "include"), _d(B, "include")], None, "pending", None),
        (
            3,
            [_d(A, "include"), _d(B, "include"), _d(C, "include")],
            None,
            "decided",
            ("consensus", "include", None, False),
        ),
        (3, [_d(A, "include"), _d(B, "include"), _d(C, "maybe")], None, "conflict", None),
        (
            2,
            [_d(A, "include"), _d(B, "include")],
            _ruling("exclude", "R2"),
            "decided",
            ("arbitrated", "exclude", "R2", False),
        ),
    ],
    ids=[
        "solo-pending",
        "solo",
        "dual-pending",
        "dual-consensus",
        "dual-conflict",
        "dual-same-reason",
        "dual-reasons-differ",
        "reason-vs-none",
        "triple-pending",
        "triple-consensus",
        "triple-conflict",
        "ruling-stands",
    ],
)
def test_derive_state(
    rc: int,
    decisions: list[CurrentDecision],
    ruling: CurrentRuling | None,
    phase: str,
    outcome: tuple[str, str, str | None, bool] | None,
) -> None:
    state = derive_state(rc, decisions, ruling)

    assert state.phase == phase
    assert state.outcome == (None if outcome is None else Outcome(*outcome))  # type: ignore[arg-type]


_PENDING = AssignmentState("pending", None)
_CONFLICT = AssignmentState("conflict", None)
_DECIDED = AssignmentState("decided", Outcome("consensus", "include", None, False))


def test_caller_status() -> None:
    assert caller_status(_PENDING, seated=True, is_arbitrator=False, can_review=True) == (
        "awaiting_others"
    )
    assert caller_status(_PENDING, seated=False, is_arbitrator=False, can_review=True) == (
        "awaiting_me"
    )
    assert caller_status(_PENDING, seated=False, is_arbitrator=False, can_review=False) == (
        "awaiting_others"
    )
    assert caller_status(_CONFLICT, seated=False, is_arbitrator=True, can_review=True) == (
        "conflict"
    )
    assert caller_status(_CONFLICT, seated=True, is_arbitrator=False, can_review=True) == (
        "awaiting_others"
    )
    assert caller_status(_DECIDED, seated=True, is_arbitrator=False, can_review=True) == "decided"


def test_a_seated_arbitrator_sees_their_own_conflict_as_awaiting_others() -> None:
    assert caller_status(_CONFLICT, seated=True, is_arbitrator=True, can_review=True) == (
        "awaiting_others"
    )
    assert caller_status(_DECIDED, seated=True, is_arbitrator=True, can_review=True) == "decided"


@pytest.mark.parametrize(
    ("state", "seated", "is_arbitrator", "revealed"),
    [
        (_CONFLICT, False, True, True),
        (_CONFLICT, False, False, False),
        (_CONFLICT, True, True, False),
        (_CONFLICT, True, False, False),
        (_PENDING, False, True, False),
        (_PENDING, True, True, False),
        (_PENDING, False, False, False),
        (_DECIDED, False, True, True),
        (_DECIDED, True, True, True),
        (_DECIDED, True, False, True),
    ],
    ids=[
        "conflict-arbitrator",
        "conflict-reviewer",
        "conflict-seated-arbitrator",
        "conflict-seated-reviewer",
        "pending-arbitrator",
        "pending-seated-arbitrator",
        "pending-reviewer",
        "decided-arbitrator",
        "decided-seated-arbitrator",
        "decided-seated-reviewer",
    ],
)
def test_reveals_peers(
    state: AssignmentState, seated: bool, is_arbitrator: bool, revealed: bool
) -> None:
    assert reveals_peers(state, seated=seated, is_arbitrator=is_arbitrator) is revealed


def _decided(decision: str) -> AssignmentState:
    return AssignmentState("decided", Outcome("consensus", decision, None, False))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("state", "seated", "is_arbitrator", "can_review", "expected"),
    [
        (_decided("include"), True, False, True, "included"),
        (_decided("exclude"), False, False, True, "excluded"),
        (_decided("maybe"), False, False, False, "maybe"),
        (_PENDING, False, False, True, "to_screen"),
        (_PENDING, True, False, True, "waiting"),
        (_PENDING, False, False, False, "in_review"),
        (_CONFLICT, False, True, True, "conflict"),
        (_CONFLICT, True, True, True, "waiting"),
        (_CONFLICT, False, False, True, "in_review"),
    ],
    ids=[
        "decided-include",
        "decided-exclude",
        "decided-maybe",
        "pending-unseated-reviewer",
        "pending-seated",
        "pending-viewer",
        "conflict-unseated-arbitrator",
        "conflict-seated-arbitrator",
        "conflict-unseated-non-arbitrator",
    ],
)
def test_record_status(
    state: AssignmentState, seated: bool, is_arbitrator: bool, can_review: bool, expected: str
) -> None:
    assert (
        record_status(state, seated=seated, is_arbitrator=is_arbitrator, can_review=can_review)
        == expected
    )

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
    mine = [_d(A, "include")]

    assert caller_status(_PENDING, mine, A, is_arbitrator=False, can_review=True) == (
        "awaiting_others"
    )
    assert caller_status(_PENDING, mine, B, is_arbitrator=False, can_review=True) == "awaiting_me"
    assert caller_status(_PENDING, mine, C, is_arbitrator=False, can_review=False) == (
        "awaiting_others"
    )
    both = [_d(A, "include"), _d(B, "exclude")]
    assert caller_status(_CONFLICT, both, C, is_arbitrator=True, can_review=True) == "conflict"
    assert caller_status(_CONFLICT, both, A, is_arbitrator=False, can_review=True) == (
        "awaiting_others"
    )
    assert caller_status(_DECIDED, both, A, is_arbitrator=False, can_review=True) == "decided"


def test_reveals_peers() -> None:
    assert reveals_peers(_CONFLICT, is_arbitrator=True) is True
    assert reveals_peers(_CONFLICT, is_arbitrator=False) is False
    assert reveals_peers(_PENDING, is_arbitrator=True) is False
    assert reveals_peers(_PENDING, is_arbitrator=False) is False
    assert reveals_peers(_DECIDED, is_arbitrator=True) is True
    assert reveals_peers(_DECIDED, is_arbitrator=False) is True

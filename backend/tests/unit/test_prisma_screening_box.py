"""The PRISMA screening box: pure counting over derived assignment states."""

from __future__ import annotations

from app.schemas.prisma import PrismaCountsRead
from app.services.prisma_service import ScreeningBox, screening_box
from app.services.screening_outcome import AssignmentState, Outcome

PENDING = AssignmentState("pending", None)
CONFLICT = AssignmentState("conflict", None)


def _decided(kind: str, decision: str, reason: str | None = None, differ: bool = False):
    return AssignmentState("decided", Outcome(kind, decision, reason, differ))  # type: ignore[arg-type]


def test_screening_box_counts_outcomes_only() -> None:
    states = [
        PENDING,
        CONFLICT,
        _decided("solo", "exclude", "Not ML"),
        _decided("solo", "exclude", "Not ML"),
        _decided("consensus", "exclude", None, differ=True),
        _decided("consensus", "exclude", None),
        _decided("consensus", "include"),
        _decided("consensus", "include"),
        _decided("arbitrated", "maybe"),
    ]

    assert screening_box(states) == ScreeningBox(
        screened=9,
        excluded=4,
        excluded_by_reason={"Not ML": 2},
        excluded_reasons_differ=1,
        excluded_without_reason=1,
        sought_for_retrieval=3,
    )


def test_pending_and_conflict_are_indistinguishable() -> None:
    only_one = ScreeningBox(
        screened=1,
        excluded=0,
        excluded_by_reason={},
        excluded_reasons_differ=0,
        excluded_without_reason=0,
        sought_for_retrieval=0,
    )

    assert screening_box([PENDING]) == only_one
    assert screening_box([CONFLICT]) == only_one


def test_prisma_payload_has_no_pending_or_conflict_field() -> None:
    assert set(PrismaCountsRead.model_fields) == {
        "identified",
        "identified_total",
        "duplicates_removed",
        "not_retrieved",
        "other_removed",
        "screened",
        "excluded",
        "excluded_by_reason",
        "excluded_reasons_differ",
        "excluded_without_reason",
        "sought_for_retrieval",
    }

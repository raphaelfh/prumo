"""The named stage sets on ``ExtractionRunStage`` — the read side of stage semantics.

One table per set so a stage-semantics change (an ADR-0017-style new edge)
is a one-line diff here and in the enum, never a hunt across services.
"""

from __future__ import annotations

import pytest

from app.models.extraction import ExtractionRunStage, StageSet


@pytest.mark.parametrize(
    ("stage_set", "members"),
    [
        pytest.param(ExtractionRunStage.live(), {"pending", "extract", "consensus"}, id="live"),
        pytest.param(ExtractionRunStage.editable(), {"pending", "extract"}, id="editable"),
        pytest.param(ExtractionRunStage.reviewing(), {"extract", "consensus"}, id="reviewing"),
        pytest.param(
            ExtractionRunStage.with_current_values(),
            {"extract", "consensus", "finalized"},
            id="with_current_values",
        ),
        pytest.param(ExtractionRunStage.EXTRACT.only(), {"extract"}, id="only"),
    ],
)
def test_stage_set_members(stage_set: StageSet, members: set[str]) -> None:
    assert stage_set == frozenset(members)
    assert isinstance(stage_set, frozenset)


def test_terminal_stages_are_not_live() -> None:
    live = ExtractionRunStage.live()
    assert ExtractionRunStage.FINALIZED.value not in live
    assert ExtractionRunStage.CANCELLED.value not in live
    assert live | {ExtractionRunStage.FINALIZED.value, ExtractionRunStage.CANCELLED.value} == {
        stage.value for stage in ExtractionRunStage
    }

"""Pure classifiers of the ``evidence_repair`` operator command."""

from __future__ import annotations

import pytest

from app.services.evidence_repair import RepairAction, classify_llm_page, classify_version

_ANCHORED = {
    "version": 1,
    "anchor": {"kind": "text", "range": {"page": 2, "charStart": 0, "charEnd": 5}},
}


@pytest.mark.parametrize(
    ("position", "page_number", "expected"),
    [
        ({}, 3, RepairAction.CLEAR_LLM_PAGE),
        (None, 3, RepairAction.CLEAR_LLM_PAGE),
        (_ANCHORED, 2, RepairAction.NONE),
        ({}, None, RepairAction.NONE),
        (None, None, RepairAction.NONE),
    ],
    ids=["empty-with-page", "null-with-page", "anchored", "empty-no-page", "null-no-page"],
)
def test_classify_llm_page(position: dict | None, page_number: int | None, expected) -> None:
    assert classify_llm_page(position=position, page_number=page_number) is expected


@pytest.mark.parametrize(
    ("slice_matches", "reanchorable", "expected"),
    [
        (True, True, RepairAction.STAMP_CURRENT),
        (True, False, RepairAction.STAMP_CURRENT),
        (False, True, RepairAction.REANCHOR),
        (False, False, RepairAction.STAMP_STALE),
    ],
    ids=["slice-and-anchor", "slice-only", "anchor-only", "neither"],
)
def test_classify_version(slice_matches: bool, reanchorable: bool, expected) -> None:
    assert classify_version(slice_matches=slice_matches, reanchorable=reanchorable) is expected

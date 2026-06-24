"""
TDD: block_ids persisted on CitationAnchor models (Task 6).

Verifies that build_anchor passes ``match.block_ids`` through to the anchor
returned inside PositionV1, so the reader can highlight deterministically
without re-running the matcher.
"""

from __future__ import annotations

from app.infrastructure.parsing.base import ParsedBlock, assign_char_offsets_to_blocks
from app.services.evidence_anchor_service import build_anchor


def _block(
    page: int,
    idx: int,
    text: str,
    *,
    block_type: str = "paragraph",
    bbox: dict | None = None,
) -> ParsedBlock:
    b = ParsedBlock(
        page_number=page,
        block_index=idx,
        text=text,
        char_start=0,
        char_end=0,
        bbox=bbox or {"x": 0.0, "y": 0.0, "width": 100.0, "height": 20.0},
        block_type=block_type,
    )
    return b


def _with_offsets(blocks: list[ParsedBlock]) -> list[ParsedBlock]:
    """Return NEW blocks with real char offsets assigned (does not mutate input)."""
    copies = [
        ParsedBlock(
            page_number=b.page_number,
            block_index=b.block_index,
            text=b.text,
            char_start=0,
            char_end=0,
            bbox=b.bbox,
            block_type=b.block_type,
        )
        for b in blocks
    ]
    assign_char_offsets_to_blocks(copies)
    return copies


class TestBuildAnchorBlockIds:
    def test_text_anchor_carries_block_ids(self) -> None:
        """Single prose block → TextCitationAnchor.block_ids == [0]."""
        blocks = _with_offsets([_block(1, 0, "The mitochondria is the powerhouse of the cell.")])
        pos = build_anchor("powerhouse of the cell", blocks)
        assert pos is not None
        assert pos.anchor.block_ids == [0]  # type: ignore[union-attr]

    def test_hybrid_anchor_carries_block_ids(self) -> None:
        """Table-cell block forces HybridCitationAnchor; block_ids must be set."""
        blocks = _with_offsets(
            [
                _block(
                    1,
                    0,
                    "Mean survival was 14 months.",
                    block_type="table_cell",
                    bbox={"x": 10.0, "y": 50.0, "width": 80.0, "height": 12.0},
                )
            ]
        )
        pos = build_anchor("Mean survival was 14 months", blocks)
        assert pos is not None
        assert pos.anchor.block_ids == [0]  # type: ignore[union-attr]

    def test_multi_block_span_carries_both_block_ids(self) -> None:
        """Quote crossing two blocks → block_ids contains both indices."""
        blocks = _with_offsets(
            [
                _block(1, 0, "the treatment group showed"),
                _block(1, 1, "a marked improvement in outcomes"),
            ]
        )
        pos = build_anchor("treatment group showed a marked improvement", blocks)
        assert pos is not None
        assert pos.anchor.block_ids == [0, 1]  # type: ignore[union-attr]

    def test_block_ids_round_trips_as_blockIds(self) -> None:
        """PositionV1.model_dump(by_alias=True) must serialise as 'blockIds'."""
        blocks = _with_offsets([_block(1, 0, "Alpha beta gamma delta.")])
        pos = build_anchor("beta gamma", blocks)
        assert pos is not None
        dumped = pos.model_dump(by_alias=True, mode="json")
        anchor_dict = dumped["anchor"]
        assert "blockIds" in anchor_dict
        assert anchor_dict["blockIds"] == [0]

    def test_no_match_returns_none(self) -> None:
        """Absent quote → build_anchor returns None (regression guard)."""
        blocks = _with_offsets([_block(1, 0, "Some unrelated text here.")])
        assert build_anchor("quantum entanglement of photons", blocks) is None

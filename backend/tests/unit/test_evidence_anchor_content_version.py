"""
TDD / regression: evidence records the content_version it anchors against
(issue #1000 — evidence anchors silently drift when an article is re-parsed).

Anchors (block_index + char range) are only meaningful against the exact
``article_text_blocks`` set they were built from. A re-parse deletes and
re-inserts every block and bumps ``article_files.content_version``, so a stored
anchor that does not record its content_version silently points at different
text after a re-parse with no way to detect the drift.

These tests pin the RECORDING of content_version on PositionV1 and the pure
staleness predicate that lets a reader flag such an anchor.
"""

from __future__ import annotations

from app.infrastructure.parsing.base import ParsedBlock, assign_char_offsets_to_blocks
from app.schemas.extraction import anchor_is_stale, parse_position
from app.services.evidence_anchor_service import build_anchor


def _block(page: int, idx: int, text: str) -> ParsedBlock:
    return ParsedBlock(
        page_number=page,
        block_index=idx,
        text=text,
        char_start=0,
        char_end=0,
        bbox={"x": 0.0, "y": 0.0, "width": 100.0, "height": 20.0},
        block_type="paragraph",
    )


def _with_offsets(blocks: list[ParsedBlock]) -> list[ParsedBlock]:
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


class TestBuildAnchorRecordsContentVersion:
    def test_anchor_records_content_version(self) -> None:
        """build_anchor stamps the content_version it was built against."""
        blocks = _with_offsets([_block(1, 0, "The mitochondria is the powerhouse of the cell.")])
        pos = build_anchor("powerhouse of the cell", blocks, content_version=7)
        assert pos is not None
        assert pos.content_version == 7

    def test_content_version_defaults_to_none_when_unknown(self) -> None:
        """A caller that cannot supply a version records None (unknown), not a lie."""
        blocks = _with_offsets([_block(1, 0, "Alpha beta gamma delta.")])
        pos = build_anchor("beta gamma", blocks)
        assert pos is not None
        assert pos.content_version is None

    def test_content_version_survives_json_round_trip(self) -> None:
        """The version must round-trip through the stored JSONB position payload."""
        blocks = _with_offsets([_block(1, 0, "Alpha beta gamma delta.")])
        pos = build_anchor("beta gamma", blocks, content_version=3)
        assert pos is not None
        dumped = pos.model_dump(by_alias=True, mode="json")
        parsed = parse_position(dumped)
        assert parsed is not None
        assert parsed.content_version == 3


class TestAnchorIsStale:
    def test_matching_version_is_not_stale(self) -> None:
        """Anchor built at the file's current version → not stale."""
        blocks = _with_offsets([_block(1, 0, "Alpha beta gamma delta.")])
        pos = build_anchor("beta gamma", blocks, content_version=4)
        assert pos is not None
        assert anchor_is_stale(pos, current_content_version=4) is False

    def test_higher_current_version_is_stale(self) -> None:
        """Re-parse bumped the file (4 -> 5); the anchor still records 4 → stale."""
        blocks = _with_offsets([_block(1, 0, "Alpha beta gamma delta.")])
        pos = build_anchor("beta gamma", blocks, content_version=4)
        assert pos is not None
        assert anchor_is_stale(pos, current_content_version=5) is True

    def test_unknown_recorded_version_is_not_stale(self) -> None:
        """Legacy anchor with no recorded version cannot be proven stale → not stale."""
        blocks = _with_offsets([_block(1, 0, "Alpha beta gamma delta.")])
        pos = build_anchor("beta gamma", blocks)
        assert pos is not None
        assert anchor_is_stale(pos, current_content_version=9) is False

    def test_none_position_is_not_stale(self) -> None:
        """Unanchored evidence (no position) is never reported stale."""
        assert anchor_is_stale(None, current_content_version=4) is False

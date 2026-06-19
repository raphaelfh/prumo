"""
Unit tests for the evidence-anchor service (quote → block matcher).

The matcher anchors an LLM's evidence quote back to a verifiable span in the
source document.  It is a PURE function: no DB, no IO, deterministic.

Coverage:
- exact quote → correct block + char range (offsets index the ORIGINAL page
  string produced by ``concat_page_text``).
- ligature / smart-quote / collapsed-whitespace quote still matches under
  Unicode NFKC + whitespace folding, AND the returned offsets index the
  ORIGINAL (un-normalised) page text.
- a quote spanning two adjacent blocks → merged char range + both block_ids +
  unioned bbox.
- a genuinely absent quote → ``None``.
- bounded fuzz: an OCR-noisy quote within threshold matches; beyond threshold
  returns ``None``.
- deterministic tie-break: when the quote appears twice, the earliest page /
  block wins.

The key invariant asserted throughout: slicing the returned
``[char_start, char_end)`` out of the ORIGINAL ``concat_page_text`` page string
and applying the SAME NFKC + whitespace fold yields the folded quote.
"""

from __future__ import annotations

from app.infrastructure.parsing.base import (
    ParsedBlock,
    assign_char_offsets_to_blocks,
    concat_page_text,
)
from app.services.evidence_anchor_service import (
    AnchorMatch,
    _normalize,
    match,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_block(
    page_number: int,
    block_index: int,
    text: str,
    *,
    block_type: str = "paragraph",
    bbox: dict[str, float] | None = None,
) -> ParsedBlock:
    """Build a ParsedBlock with PLACEHOLDER char offsets (0/0).

    The matcher must derive offsets itself from ``concat_page_text`` /
    ``assign_char_offsets_to_blocks``, so the offsets passed in here are
    intentionally wrong (0/0) to prove the matcher does not trust them.
    """
    return ParsedBlock(
        page_number=page_number,
        block_index=block_index,
        text=text,
        char_start=0,
        char_end=0,
        bbox=bbox if bbox is not None else {"x": 0.0, "y": 0.0, "width": 100.0, "height": 20.0},
        block_type=block_type,
    )


def _fold(s: str) -> str:
    """The canonical comparison surface (NFKC + punctuation + whitespace fold).

    Delegates to the service's own ``_normalize`` so the test asserts against
    the real folding surface rather than a reimplementation that could drift.
    """
    return _normalize(s)


def _original_page_text(blocks: list[ParsedBlock]) -> dict[int, str]:
    """Build the ORIGINAL per-page text the matcher's offsets must index.

    Uses LOCAL copies so the test's input blocks are never mutated (mirrors
    what the matcher does internally).
    """
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
    return concat_page_text(copies)


def _assert_slice_folds_to_quote(
    result: AnchorMatch,
    blocks: list[ParsedBlock],
    quote: str,
) -> None:
    """Core invariant: the returned span, sliced from the ORIGINAL page text
    and folded, equals the folded quote."""
    page_text = _original_page_text(blocks)[result.page]
    sliced = page_text[result.char_start : result.char_end]
    assert _fold(sliced) == _fold(quote), (
        f"sliced original {sliced!r} folds to {_fold(sliced)!r}, "
        f"expected folded quote {_fold(quote)!r}"
    )


# ---------------------------------------------------------------------------
# Exact match
# ---------------------------------------------------------------------------


class TestExactMatch:
    def test_exact_quote_anchors_to_correct_block_and_range(self) -> None:
        blocks = [
            make_block(1, 0, "The mitochondria is the powerhouse of the cell."),
            make_block(1, 1, "Ribosomes synthesize proteins from amino acids."),
        ]
        quote = "powerhouse of the cell"
        result = match(quote, blocks)
        assert result is not None
        assert result.page == 1
        assert result.block_ids == [0]
        _assert_slice_folds_to_quote(result, blocks, quote)

        page_text = _original_page_text(blocks)[1]
        assert page_text[result.char_start : result.char_end] == "powerhouse of the cell"

    def test_exact_full_block_quote(self) -> None:
        blocks = [
            make_block(2, 0, "Alpha beta gamma."),
            make_block(2, 1, "Delta epsilon zeta."),
        ]
        quote = "Delta epsilon zeta."
        result = match(quote, blocks)
        assert result is not None
        assert result.page == 2
        assert result.block_ids == [1]
        _assert_slice_folds_to_quote(result, blocks, quote)

    def test_match_on_second_page(self) -> None:
        blocks = [
            make_block(1, 0, "First page content here."),
            make_block(2, 0, "Second page has the target sentence."),
        ]
        result = match("the target sentence", blocks)
        assert result is not None
        assert result.page == 2
        assert result.block_ids == [0]
        _assert_slice_folds_to_quote(result, blocks, "the target sentence")


# ---------------------------------------------------------------------------
# Normalization: ligatures / smart quotes / collapsed whitespace
# ---------------------------------------------------------------------------


class TestNormalization:
    def test_ligature_quote_matches_and_offsets_index_original(self) -> None:
        # Block contains the ligature 'ﬁ' (U+FB01); quote uses ASCII "fi".
        blocks = [make_block(1, 0, "The classiﬁcation of cells is complex.")]
        quote = "classification of cells"
        result = match(quote, blocks)
        assert result is not None
        assert result.block_ids == [0]
        # Offsets index the ORIGINAL string, which still contains the ligature.
        page_text = _original_page_text(blocks)[1]
        sliced = page_text[result.char_start : result.char_end]
        assert "ﬁ" in sliced  # original ligature preserved in the slice
        _assert_slice_folds_to_quote(result, blocks, quote)

    def test_smart_quotes_match_straight_quotes(self) -> None:
        # Block uses a curly apostrophe (U+2019); quote uses a straight one.
        blocks = [make_block(1, 0, "The cell’s membrane is selectively permeable.")]
        quote = "cell's membrane"
        result = match(quote, blocks)
        assert result is not None
        _assert_slice_folds_to_quote(result, blocks, quote)

    def test_collapsed_whitespace_matches(self) -> None:
        # Block has a newline + multiple spaces; quote has single spaces.
        blocks = [make_block(1, 0, "The   sample\n   was   incubated   overnight.")]
        quote = "sample was incubated overnight"
        result = match(quote, blocks)
        assert result is not None
        _assert_slice_folds_to_quote(result, blocks, quote)

    def test_quote_with_extra_whitespace_matches(self) -> None:
        blocks = [make_block(1, 0, "Results were significant.")]
        quote = "  Results   were    significant.  "
        result = match(quote, blocks)
        assert result is not None
        _assert_slice_folds_to_quote(result, blocks, quote)


# ---------------------------------------------------------------------------
# Multi-block span
# ---------------------------------------------------------------------------


class TestMultiBlockSpan:
    def test_quote_spanning_two_adjacent_blocks(self) -> None:
        blocks = [
            make_block(
                1,
                0,
                "the treatment group showed",
                bbox={"x": 10.0, "y": 100.0, "width": 200.0, "height": 20.0},
            ),
            make_block(
                1,
                1,
                "a marked improvement in outcomes",
                bbox={"x": 12.0, "y": 70.0, "width": 220.0, "height": 22.0},
            ),
        ]
        # The quote crosses the block boundary (the "\n" separator folds to " ").
        quote = "treatment group showed a marked improvement"
        result = match(quote, blocks)
        assert result is not None
        assert result.page == 1
        assert result.block_ids == [0, 1]
        _assert_slice_folds_to_quote(result, blocks, quote)

        # bbox_union: min x, min y, max (x+width), max (y+height).
        # block 0: x in [10, 210], y in [100, 120]
        # block 1: x in [12, 232], y in [70, 92]
        assert result.bbox_union["x"] == 10.0
        assert result.bbox_union["y"] == 70.0
        assert result.bbox_union["width"] == 232.0 - 10.0
        assert result.bbox_union["height"] == 120.0 - 70.0

    def test_single_block_bbox_union_is_that_block(self) -> None:
        bbox = {"x": 5.0, "y": 50.0, "width": 80.0, "height": 12.0}
        blocks = [make_block(1, 0, "A single isolated sentence here.", bbox=bbox)]
        result = match("isolated sentence", blocks)
        assert result is not None
        assert result.block_ids == [0]
        assert result.bbox_union == bbox


# ---------------------------------------------------------------------------
# Absent quote
# ---------------------------------------------------------------------------


class TestAbsentQuote:
    def test_absent_quote_returns_none(self) -> None:
        blocks = [
            make_block(1, 0, "The mitochondria is the powerhouse of the cell."),
        ]
        assert match("quantum entanglement of photons", blocks) is None

    def test_empty_quote_returns_none(self) -> None:
        blocks = [make_block(1, 0, "Some text.")]
        assert match("", blocks) is None

    def test_empty_blocks_returns_none(self) -> None:
        assert match("anything", []) is None

    def test_whitespace_only_quote_returns_none(self) -> None:
        blocks = [make_block(1, 0, "Some text.")]
        assert match("   \n  ", blocks) is None


# ---------------------------------------------------------------------------
# Bounded fuzz
# ---------------------------------------------------------------------------


class TestBoundedFuzz:
    def test_ocr_noisy_quote_within_threshold_matches(self) -> None:
        # Source is clean; quote has a couple of OCR-style character errors.
        blocks = [
            make_block(
                1,
                0,
                "The patients received a daily dose of the experimental compound.",
            )
        ]
        # "patients" -> "patlents", "experimental" -> "experirnental" (rn for m)
        quote = "patlents received a daily dose of the experirnental compound"
        result = match(quote, blocks)
        assert result is not None
        assert result.block_ids == [0]
        # The matched original slice corresponds to the clean source span.
        page_text = _original_page_text(blocks)[1]
        sliced = page_text[result.char_start : result.char_end]
        assert "received a daily dose" in sliced

    def test_quote_beyond_fuzz_threshold_returns_none(self) -> None:
        blocks = [
            make_block(
                1,
                0,
                "The patients received a daily dose of the experimental compound.",
            )
        ]
        # Garble most of the characters — far beyond any sane threshold.
        quote = "Xhq zatuqxlk rqmqwxqg z xzuzk xqkq"
        assert match(quote, blocks) is None

    def test_tight_threshold_rejects_noisy_quote(self) -> None:
        blocks = [make_block(1, 0, "The quick brown fox jumps over the lazy dog.")]
        noisy = "The qulck brown fox jximps over the lazy dog"
        # With fuzz disabled (threshold 1.0 = exact only) the noisy quote fails.
        assert match(noisy, blocks, fuzz_threshold=1.0) is None
        # With the default (looser) threshold it matches.
        assert match(noisy, blocks) is not None


# ---------------------------------------------------------------------------
# Deterministic tie-break
# ---------------------------------------------------------------------------


class TestDeterministicTieBreak:
    def test_duplicate_quote_earliest_page_wins(self) -> None:
        blocks = [
            make_block(2, 0, "The repeated phrase appears here."),
            make_block(1, 0, "The repeated phrase appears here."),
        ]
        result = match("repeated phrase", blocks)
        assert result is not None
        assert result.page == 1  # earliest page wins, not list order

    def test_duplicate_quote_earliest_block_wins(self) -> None:
        blocks = [
            make_block(1, 0, "The repeated phrase appears here."),
            make_block(1, 1, "The repeated phrase appears here too."),
        ]
        result = match("repeated phrase", blocks)
        assert result is not None
        assert result.page == 1
        assert result.block_ids == [0]  # earliest block within the page

    def test_same_inputs_same_output(self) -> None:
        blocks = [
            make_block(1, 0, "Alpha beta gamma delta."),
            make_block(1, 1, "Epsilon zeta eta theta."),
            make_block(2, 0, "Iota kappa lambda."),
        ]
        quote = "zeta eta"
        first = match(quote, blocks)
        second = match(quote, blocks)
        assert first == second
        assert first is not None
        assert first.block_ids == [1]


# ---------------------------------------------------------------------------
# Input integrity
# ---------------------------------------------------------------------------


class TestInputIntegrity:
    def test_input_blocks_are_not_mutated(self) -> None:
        blocks = [
            make_block(1, 0, "Alpha beta."),
            make_block(1, 1, "Gamma delta."),
        ]
        # Offsets start as placeholders (0/0).
        match("Gamma delta", blocks)
        # Matcher must NOT have written real offsets onto the input blocks.
        assert all(b.char_start == 0 and b.char_end == 0 for b in blocks)


class TestAnchorMatchShape:
    def test_anchor_match_fields(self) -> None:
        blocks = [make_block(3, 0, "Find me in here please.")]
        result = match("Find me", blocks)
        assert result is not None
        assert result.page == 3
        assert isinstance(result.char_start, int)
        assert isinstance(result.char_end, int)
        assert result.char_start < result.char_end
        assert result.block_ids == [0]
        assert set(result.bbox_union.keys()) == {"x", "y", "width", "height"}


# ---------------------------------------------------------------------------
# Fold-back invariant at NFKC-expansion boundaries (Fix 1)
# ---------------------------------------------------------------------------


class TestExpansionBoundaryInvariant:
    """A match boundary that lands inside a 1→many NFKC expansion must never
    return a span that folds WIDER than the matched text.

    ``norm_to_orig`` maps every sub-character of an expansion (e.g. the ligature
    ``ﬁ`` → ``f``, ``i``) to the SAME original index, so the naive map-back of a
    boundary on a non-first sub-char would include the whole original expansion
    char.  The matcher must instead honour the advertised guarantee:
    ``_fold(original[char_start:char_end]) == _fold(matched span)``.
    """

    def test_quote_starting_mid_ligature_is_unrepresentable_returns_none(self) -> None:
        # NFKC-normalised "aﬁnal result" == "afinal result"; the quote "inal
        # result" starts on the SECOND sub-char ('i') of the ligature 'ﬁ'.  No
        # original slice folds to exactly "inal result" (the ligature is one
        # indivisible original char), so the matcher must return None rather than
        # the span-too-wide [1:12] -> "ﬁnal result" -> "final result".
        blocks = [make_block(1, 0, "aﬁnal result")]
        assert match("inal result", blocks) is None

    def test_quote_covering_whole_ligature_matches_and_folds_exactly(self) -> None:
        # "final result" starts BEFORE the ligature and covers the whole 'ﬁ'
        # expansion, so it is representable: the original slice still contains the
        # ligature and folds exactly to the quote.
        blocks = [make_block(1, 0, "aﬁnal result")]
        result = match("final result", blocks)
        assert result is not None
        page_text = _original_page_text(blocks)[1]
        sliced = page_text[result.char_start : result.char_end]
        assert "ﬁ" in sliced
        assert _fold(sliced) == _fold("final result")
        _assert_slice_folds_to_quote(result, blocks, "final result")

    def test_quote_starting_after_ligature_snaps_to_narrower_span(self) -> None:
        # "nal result" starts AFTER the full ligature expansion ('fi'); the start
        # boundary fell inside the expansion but the quote is representable as the
        # narrower original slice beginning at 'n'.  The matcher must snap to that
        # narrower span (dropping the ligature), not widen to include it.
        blocks = [make_block(1, 0, "aﬁnal result")]
        result = match("nal result", blocks)
        assert result is not None
        page_text = _original_page_text(blocks)[1]
        sliced = page_text[result.char_start : result.char_end]
        assert "ﬁ" not in sliced  # ligature dropped by the snap
        assert _fold(sliced) == _fold("nal result")
        _assert_slice_folds_to_quote(result, blocks, "nal result")


# ---------------------------------------------------------------------------
# Whitespace-tight span (Fix 2)
# ---------------------------------------------------------------------------


class TestWhitespaceTrim:
    """The returned span must not carry leading/trailing ORIGINAL whitespace.

    When a match ends just before a collapsed-whitespace run or a block
    separator, the naive map-back can include that trailing ``\\n`` / spaces.  A
    downstream highlighter would render them, so the span is trimmed tight.
    """

    def test_match_adjacent_to_block_separator_has_no_trailing_newline(self) -> None:
        # The quote ends exactly at the end of block 0; the naive map-back would
        # carry the "\n" block separator into the slice.
        blocks = [
            make_block(1, 0, "the result was"),
            make_block(1, 1, "clearly positive"),
        ]
        result = match("result was", blocks)
        assert result is not None
        assert result.block_ids == [0]
        page_text = _original_page_text(blocks)[1]
        sliced = page_text[result.char_start : result.char_end]
        assert sliced == "result was"
        assert sliced == sliced.strip()  # no leading/trailing whitespace
        _assert_slice_folds_to_quote(result, blocks, "result was")

    def test_match_adjacent_to_collapsed_whitespace_run_is_tight(self) -> None:
        # In-block whitespace run after the matched word; the slice must stop at
        # the word, not run into the spaces/newline.
        blocks = [make_block(1, 0, "The   sample\n   was   incubated   overnight.")]
        result = match("sample", blocks)
        assert result is not None
        page_text = _original_page_text(blocks)[1]
        sliced = page_text[result.char_start : result.char_end]
        assert sliced == "sample"
        assert sliced == sliced.strip()


# ---------------------------------------------------------------------------
# Fuzzy tier: determinism + multi-block coverage (Fix 3)
# ---------------------------------------------------------------------------


class TestFuzzyDeterminismAndCoverage:
    def test_fuzzy_quote_spanning_two_blocks_merges_range_and_bboxes(self) -> None:
        # An OCR-noisy quote (within threshold) that crosses the block boundary
        # must still return the merged char range, BOTH block_ids, and the bbox
        # union over both blocks.
        blocks = [
            make_block(
                1,
                0,
                "the treatment group showed",
                bbox={"x": 10.0, "y": 100.0, "width": 200.0, "height": 20.0},
            ),
            make_block(
                1,
                1,
                "a marked improvement in outcomes",
                bbox={"x": 12.0, "y": 70.0, "width": 220.0, "height": 22.0},
            ),
        ]
        # "treatment" -> "treatrnent" (rn for m), "improvement" -> "irnprovement".
        quote = "treatrnent group showed a marked irnprovement"
        result = match(quote, blocks)
        assert result is not None
        assert result.page == 1
        assert result.block_ids == [0, 1]
        # Merged range covers text from block 0 into block 1.
        page_text = _original_page_text(blocks)[1]
        sliced = page_text[result.char_start : result.char_end]
        assert "treatment group showed" in sliced
        assert "marked improvement" in sliced
        # bbox union over both blocks.
        assert result.bbox_union["x"] == 10.0
        assert result.bbox_union["y"] == 70.0
        assert result.bbox_union["width"] == 232.0 - 10.0
        assert result.bbox_union["height"] == 120.0 - 70.0

    def test_fuzzy_equal_ratio_windows_resolve_to_earliest_start(self) -> None:
        # Two windows match the noisy quote with the SAME ratio; the earliest
        # start must win and repeated calls must agree (determinism).
        blocks = [
            make_block(
                1,
                0,
                "alpha bravo charlie delta alpha bravo charlie delta",
            )
        ]
        # OCR-noisy version of "alpha bravo charlie" — present twice in the source
        # with identical surrounding context, so both windows score equally.
        noisy = "alpha bravo charlle"
        first = match(noisy, blocks)
        second = match(noisy, blocks)
        assert first is not None
        assert first == second  # fully deterministic
        # Earliest start wins: the matched slice is the FIRST occurrence.
        page_text = _original_page_text(blocks)[1]
        assert page_text[: first.char_start] == ""  # anchored at the very start
        sliced = page_text[first.char_start : first.char_end]
        assert sliced.startswith("alpha bravo")

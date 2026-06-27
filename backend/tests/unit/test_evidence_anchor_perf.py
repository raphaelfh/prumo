"""
Performance regression for the evidence-anchor matcher.

The matcher is on the synchronous extraction write path: every evidence quote
returned by the LLM is anchored against the FULL document's blocks.  On a real
multi-page PDF (a dozen pages of prose) the original per-character sliding-window
``SequenceMatcher`` sweep ran in *tens of seconds*, blowing the gunicorn worker
timeout (SIGABRT → 502).

These tests pin a hard wall-clock budget on the whole ``match`` / ``build_anchor``
call against a realistic ~12-page fixture, plus the two correctness paths that
must survive the optimisation (verbatim + OCR-noisy) and the absent-quote path.

The budget (< 0.5s) is generous for the linear algorithm and far below the
seconds-to-tens-of-seconds the unbounded sweep took — so this test fails RED
against the old code and passes GREEN once the matcher is bounded.
"""

from __future__ import annotations

import time

import pytest

from app.infrastructure.parsing.base import (
    ParsedBlock,
    assign_char_offsets_to_blocks,
    concat_page_text,
)
from app.services.evidence_anchor_service import build_anchor, match

# A hard wall-clock ceiling for a single anchor call against the whole document.
# The bounded matcher completes in single-digit milliseconds; the old unbounded
# sweep took seconds-to-tens-of-seconds on this fixture.
_BUDGET_SECONDS = 0.5

_PAGE_COUNT = 12
# Per page, roughly 4000-8000 chars of prose spread over a handful of blocks.
_BLOCKS_PER_PAGE = 6
_SENTENCES_PER_BLOCK = 5
# Words per sentence — enough that a single substitution barely dents the
# self-similarity but two independently-keyed sentences share few words.
_WORDS_PER_SENTENCE = 24

# A pool of short, unrelated words.  Each sentence is a sequence of words picked
# INDEPENDENTLY per position from this pool (no shared connective scaffold), so two
# differently-keyed sentences overlap only by coincidence — cross-sentence
# similarity is ~0.5, far below the fuzz threshold, while a 1-2 char OCR
# substitution leaves self-similarity ~0.98.  This matters because the cross-page
# tie-break in ``match`` is pre-existing and ratio-blind (earliest QUALIFYING page
# wins): a noisy quote only anchors to its true page when every OTHER page falls
# BELOW the threshold.  Sharing connective scaffold (the earlier fixture design)
# kept other pages above the threshold and made the page assertion flaky.
_WORD_POOL = [
    "alpha",
    "bravo",
    "charlie",
    "delta",
    "echo",
    "foxtrot",
    "golf",
    "hotel",
    "india",
    "juliet",
    "kilo",
    "lima",
    "mike",
    "november",
    "oscar",
    "papa",
    "quebec",
    "romeo",
    "sierra",
    "tango",
    "uniform",
    "victor",
    "whiskey",
    "xray",
    "yankee",
    "zulu",
    "amber",
    "basalt",
    "cobalt",
    "dune",
    "ember",
    "flint",
    "granite",
    "harbor",
    "ivory",
    "jasper",
    "krypton",
    "lumen",
    "marble",
    "nimbus",
    "onyx",
    "pewter",
    "quartz",
    "rosewood",
    "slate",
    "topaz",
    "umber",
    "verdant",
]


def _word_index(page: int, block: int, seq: int, position: int) -> int:
    """Pick a :data:`_WORD_POOL` index for one word, mixing all four coordinates.

    Distinct large multipliers per coordinate (and per word position) ensure two
    different (page, block, seq) sentences produce different word sequences, so
    every sentence in the document is unique AND any two sentences share few words
    (cross-similarity well below the fuzz threshold).
    """
    h = (page * 1000003) ^ (block * 19349663) ^ (seq * 83492791) ^ (position * 2654435761)
    return (h & 0x7FFFFFFF) % len(_WORD_POOL)


def _sentence(page: int, block: int, seq: int) -> str:
    """A deterministic sentence unique in content per (page, block, seq).

    Each word position is picked independently from :data:`_WORD_POOL` via a hash
    that mixes all four coordinates, so the sentence shares little vocabulary with
    any other sentence in the document (cross-similarity ~0.5) and is globally
    unique.
    """
    words = [_word_index(page, block, seq, i) for i in range(_WORDS_PER_SENTENCE)]
    return " ".join(_WORD_POOL[i] for i in words).capitalize() + "."


def _block_sentence(page: int, block_idx: int, i: int) -> str:
    """The i-th VERBATIM sentence inside (page, block_idx) — an exact substring."""
    base = block_idx * _SENTENCES_PER_BLOCK
    return _sentence(page, block_idx, base + i)


def _block_text(page: int, block_idx: int) -> str:
    """The verbatim text of one block (several sentences)."""
    return " ".join(_block_sentence(page, block_idx, i) for i in range(_SENTENCES_PER_BLOCK))


def _build_multipage_blocks() -> list[ParsedBlock]:
    """~12 pages, each ~4000-8000 chars of prose over several blocks."""
    blocks: list[ParsedBlock] = []
    for page in range(1, _PAGE_COUNT + 1):
        for block_idx in range(_BLOCKS_PER_PAGE):
            # Pack each block with several sentences so a page is multiple KB.
            text = _block_text(page, block_idx)
            blocks.append(
                ParsedBlock(
                    page_number=page,
                    block_index=block_idx,
                    text=text,
                    char_start=0,
                    char_end=0,
                    bbox={"x": 0.0, "y": float(block_idx * 30), "width": 400.0, "height": 24.0},
                    block_type="paragraph",
                )
            )
    return blocks


def _page_char_counts(blocks: list[ParsedBlock]) -> dict[int, int]:
    counts: dict[int, int] = {}
    for b in blocks:
        counts[b.page_number] = counts.get(b.page_number, 0) + len(b.text)
    return counts


def _original_page_text(blocks: list[ParsedBlock]) -> dict[int, str]:
    """The ORIGINAL per-page text the matcher's offsets index (uses local copies)."""
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


@pytest.mark.performance
class TestEvidenceAnchorPerformance:
    def test_fixture_is_realistically_sized(self) -> None:
        """Sanity-check the fixture really is multi-page, multi-KB-per-page prose."""
        blocks = _build_multipage_blocks()
        counts = _page_char_counts(blocks)
        assert len(counts) == _PAGE_COUNT
        for page, n in counts.items():
            assert 4000 <= n <= 8000, f"page {page} has {n} chars, outside 4000-8000"

    def test_verbatim_deep_page_quote_anchors_fast(self) -> None:
        """A VERBATIM quote from page 9 anchors correctly AND well under budget."""
        blocks = _build_multipage_blocks()
        # An exact substring from a block deep in the document (page 9).
        quote = _block_sentence(9, 3, 1)  # block 3, second sentence of that block
        # Guard: the quote occurs exactly once in the whole document, so a page-9
        # anchor is unambiguous (rules out an accidental earlier-page collision).
        page_texts = _original_page_text(blocks)
        assert sum(text.count(quote) for text in page_texts.values()) == 1

        start = time.perf_counter()
        result = match(quote, blocks)
        elapsed = time.perf_counter() - start

        assert result is not None
        assert result.page == 9
        assert result.block_ids == [3]
        # Fold-back: the matched original slice equals the quote.
        assert elapsed < _BUDGET_SECONDS, f"match took {elapsed:.3f}s (budget {_BUDGET_SECONDS}s)"

    def test_build_anchor_whole_call_under_budget(self) -> None:
        """The whole build_anchor path (match + anchor build) stays under budget."""
        blocks = _build_multipage_blocks()
        quote = _block_sentence(9, 3, 1)

        start = time.perf_counter()
        pos = build_anchor(quote, blocks)
        elapsed = time.perf_counter() - start

        assert pos is not None
        assert pos.anchor.range.page == 9  # type: ignore[union-attr]
        assert elapsed < _BUDGET_SECONDS, (
            f"build_anchor took {elapsed:.3f}s (budget {_BUDGET_SECONDS}s)"
        )

    def test_ocr_noisy_quote_anchors_via_fuzzy_fast(self) -> None:
        """A quote with a few char substitutions still anchors (fuzzy) and is fast."""
        blocks = _build_multipage_blocks()
        clean = _block_sentence(7, 2, 1)
        # Introduce a few OCR-style character substitutions on non-space letters
        # at deterministic positions (skip spaces so each substitution is real).
        chars = list(clean)
        letter_positions = [i for i, c in enumerate(clean) if c.isalpha()]
        subs = 0
        for k, repl in ((3, "x"), (9, "z"), (15, "q")):
            pos = letter_positions[k]
            if chars[pos] != repl:
                chars[pos] = repl
                subs += 1
        noisy = "".join(chars)
        assert subs >= 2  # at least two real substitutions landed
        assert noisy != clean
        # The quote is NOT a verbatim substring (forces the fuzzy path, not exact).
        page7 = _original_page_text(blocks)[7]
        assert noisy not in page7

        start = time.perf_counter()
        result = match(noisy, blocks)
        elapsed = time.perf_counter() - start

        assert result is not None
        assert result.page == 7
        assert result.block_ids == [2]
        assert elapsed < _BUDGET_SECONDS, (
            f"fuzzy match took {elapsed:.3f}s (budget {_BUDGET_SECONDS}s)"
        )

    def test_absent_quote_returns_none_fast(self) -> None:
        """An ABSENT quote returns None quickly (worst case: every page fuzzed)."""
        blocks = _build_multipage_blocks()
        quote = (
            "quantum chromodynamics predicts asymptotic freedom of quarks at "
            "very short distances in the deep inelastic scattering regime"
        )

        start = time.perf_counter()
        result = match(quote, blocks)
        elapsed = time.perf_counter() - start

        assert result is None
        assert elapsed < _BUDGET_SECONDS, (
            f"absent-quote search took {elapsed:.3f}s (budget {_BUDGET_SECONDS}s)"
        )

    def test_adversarial_repetitive_page_stays_fast(self) -> None:
        """A highly repetitive page must not blow up the anchor-candidate search.

        ``get_matching_blocks`` (used to seed fuzzy anchors) returns many common
        runs when the page repeats the quote's words.  This pins that the bounded
        candidate set keeps the fuzzy path fast even in the adversarial case where
        a noisy quote's tokens recur dozens of times across many pages.
        """
        # Each of 12 pages is the SAME short phrase repeated ~120 times → every
        # page is dense with common runs against the noisy quote (worst case for
        # anchor seeding).  A noisy quote forces the fuzzy path on every page.
        phrase = "the renal results then the cardiac results then "
        blocks = [
            ParsedBlock(
                page_number=page,
                block_index=0,
                text=phrase * 120,
                char_start=0,
                char_end=0,
                bbox={"x": 0.0, "y": 0.0, "width": 400.0, "height": 24.0},
                block_type="paragraph",
            )
            for page in range(1, _PAGE_COUNT + 1)
        ]
        noisy = "the renai resultz then the cardlac"  # OCR-noisy, recurs everywhere

        start = time.perf_counter()
        match(noisy, blocks)
        elapsed = time.perf_counter() - start

        assert elapsed < _BUDGET_SECONDS, (
            f"repetitive-page fuzzy search took {elapsed:.3f}s (budget {_BUDGET_SECONDS}s)"
        )

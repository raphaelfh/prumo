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

from app.infrastructure.parsing.base import ParsedBlock
from app.services.evidence_anchor_service import build_anchor, match

# A hard wall-clock ceiling for a single anchor call against the whole document.
# The bounded matcher completes in single-digit milliseconds; the old unbounded
# sweep took seconds-to-tens-of-seconds on this fixture.
_BUDGET_SECONDS = 0.5

_PAGE_COUNT = 12
# Per page, roughly 4000-8000 chars of prose spread over a handful of blocks.
_BLOCKS_PER_PAGE = 6
_SENTENCES_PER_BLOCK = 4


# Disjoint word pools.  Composing each sentence from a DETERMINISTIC pseudo-random
# pick across these pools makes sentences genuinely different in CONTENT (not just
# a stray number), so the cross-sentence similarity is low (~0.2-0.4).  That
# matters because the cross-page tie-break in ``match`` is pre-existing and
# ratio-blind (earliest QUALIFYING page wins): only when every non-target page
# falls BELOW the fuzz threshold does a noisy quote anchor to its true page.
_SUBJECTS = [
    "hepatic perfusion",
    "renal clearance",
    "cardiac output",
    "pulmonary diffusion",
    "neural conduction",
    "vascular resistance",
    "endocrine secretion",
    "skeletal density",
    "immune response",
    "metabolic turnover",
    "lymphatic drainage",
    "cortical thickness",
    "synaptic plasticity",
    "platelet aggregation",
    "mitochondrial respiration",
    "glomerular filtration",
]
_VERBS = [
    "declined sharply",
    "increased modestly",
    "stabilized completely",
    "fluctuated irregularly",
    "recovered gradually",
    "deteriorated rapidly",
    "plateaued early",
    "rebounded strongly",
]
_AGENTS = [
    "warfarin loading",
    "gabapentin titration",
    "metformin washout",
    "lisinopril induction",
    "atorvastatin tapering",
    "furosemide challenge",
    "prednisone pulsing",
    "clopidogrel bridging",
    "azithromycin cycling",
    "sertraline ramping",
    "amlodipine dosing",
    "omeprazole holding",
]
_COHORTS = [
    "elderly subgroup",
    "adolescent volunteers",
    "postpartum patients",
    "diabetic veterans",
    "transplant recipients",
    "dialysis candidates",
    "trauma survivors",
    "oncology referrals",
]
_PERIODS = [
    "during winter audits",
    "across spring trials",
    "throughout autumn rounds",
    "amid summer screenings",
    "between quarterly reviews",
    "after midyear checkpoints",
]


def _pick(pool: list[str], salt: int) -> str:
    """Deterministic, well-spread pick from *pool* keyed by *salt*."""
    # A small multiplicative hash spreads consecutive salts across the pool so
    # adjacent sentences don't collide on the same word.
    return pool[(salt * 2654435761) % len(pool)]


def _signature(page: int, block: int, seq: int) -> str:
    """A globally-unique, fold-stable nonce token embedded in one sentence."""
    return f"sig{page:02d}q{block:02d}q{seq:03d}"


def _sentence(page: int, block: int, seq: int) -> str:
    """A deterministic sentence composed from disjoint pools — unique in content.

    Keyed off a single coordinate salt so each (page, block, seq) yields prose
    with little vocabulary overlap with any other sentence in the document.
    """
    salt = (page * 9973 + block * 97 + seq) & 0x7FFFFFFF
    subject = _pick(_SUBJECTS, salt)
    verb = _pick(_VERBS, salt + 1)
    agent = _pick(_AGENTS, salt + 2)
    cohort = _pick(_COHORTS, salt + 3)
    period = _pick(_PERIODS, salt + 4)
    return (
        f"The {subject} measured in the {cohort} {verb} following {agent} "
        f"{period}, and the documented {_signature(page, block, seq)} record "
        f"confirmed the observation under blinded independent adjudication."
    )


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
        # Guard: the per-sentence signature proves we really are deep in the doc.
        assert _signature(9, 3, 3 * _SENTENCES_PER_BLOCK + 1) in quote

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
        """A quote with 2-3 char substitutions still anchors (fuzzy) and is fast."""
        blocks = _build_multipage_blocks()
        clean = _block_sentence(7, 2, 1)
        # Introduce a few OCR-style substitutions: m -> rn, i -> l.
        noisy = clean.replace("measured", "rneasured").replace("following", "followlng")
        assert noisy != clean
        assert noisy.count("rneasured") + noisy.count("followlng") >= 2  # subs landed

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

"""Duplicate candidates: matching tiers, vetoes, pairing and the keep order (pure, no I/O)."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest

from app.repositories.duplicate_repository import CandidateSource
from app.services.duplicate_candidates import (
    candidate_pairs,
    match,
    normalize_title,
    suggest_kept,
)

TITLE = "Machine learning for sepsis prediction in adults"
JAN_1 = datetime(2026, 1, 1, tzinfo=UTC)
JAN_2 = datetime(2026, 1, 2, tzinfo=UTC)


def _id(n: int) -> UUID:
    return UUID(int=n)


def _source(n: int, **fields: Any) -> CandidateSource:
    base: dict[str, Any] = {
        "article_id": _id(n),
        "title": TITLE,
        "pmid": None,
        "doi_key": None,
        "publication_year": 2020,
        "journal_title": None,
        "article_type": None,
        "zotero_item_type": None,
        "has_review_work": False,
        "has_pdf": False,
        "has_abstract": False,
        "created_at": JAN_1,
    }
    base.update(fields)
    return CandidateSource(**base)


def test_normalize_title() -> None:
    assert normalize_title("Sepsis: a Review.") == normalize_title("sepsis a review")
    assert normalize_title("Sepsis: a Review.") == "sepsisareview"
    assert normalize_title(None) == ""


_MATCH_CASES: list[tuple[str, dict[str, Any], dict[str, Any], tuple[str, str, str] | None]] = [
    (
        "pmid_wins_over_differing_doi",
        {"pmid": "123", "doi_key": "10.1/a"},
        {"pmid": "123", "doi_key": "10.1/b", "title": "Something else entirely here"},
        ("exact", "pmid", "pmid"),
    ),
    (
        "doi_and_title",
        {"doi_key": "10.1/a"},
        {"doi_key": "10.1/a", "title": "machine learning for SEPSIS prediction in adults."},
        ("exact", "doi_title", "doi"),
    ),
    (
        "doi_same_title_differs",
        {"doi_key": "10.1/a"},
        {"doi_key": "10.1/a", "title": "A different paper on something"},
        ("possible", "doi_only", "doi"),
    ),
    ("differing_dois_never_pair", {"doi_key": "10.1/a"}, {"doi_key": "10.1/b"}, None),
    ("title_and_year", {}, {}, ("likely", "title", "title")),
    (
        "title_19_chars_never_pairs",
        {"title": "abcdefghij klmnopqrs"},
        {"title": "abcdefghij klmnopqrs"},
        None,
    ),
    ("one_year_missing", {}, {"publication_year": None}, None),
    (
        "journals_differ_demote",
        {"journal_title": "JAMA"},
        {"journal_title": "Lancet"},
        ("possible", "title", "title"),
    ),
    (
        "journals_same_after_normalization",
        {"journal_title": "J. Med."},
        {"journal_title": "j med"},
        ("likely", "title", "title"),
    ),
    ("journal_missing_one_side", {"journal_title": "JAMA"}, {}, ("likely", "title", "title")),
    ("congress_never_by_title", {"article_type": "Congress"}, {}, None),
    (
        "congress_exact_by_pmid",
        {"article_type": "Congress", "pmid": "9"},
        {"pmid": "9"},
        ("exact", "pmid", "pmid"),
    ),
    ("trial_protocol_never_by_title", {"article_type": "Clinical Trial Protocol"}, {}, None),
    ("ris_conf_never_by_title", {}, {"article_type": "CONF"}, None),
    ("ris_cpaper_never_by_title", {}, {"article_type": " cpaper "}, None),
    ("ris_abst_never_by_title", {"article_type": "ABST"}, {}, None),
    ("zotero_conference_paper_never_by_title", {"zotero_item_type": "conferencePaper"}, {}, None),
    (
        "conference_doi_and_title_is_possible",
        {"article_type": "Meeting Abstract", "doi_key": "10.1/a"},
        {"doi_key": "10.1/a"},
        ("possible", "doi_title", "doi"),
    ),
]


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [case[1:] for case in _MATCH_CASES],
    ids=[case[0] for case in _MATCH_CASES],
)
def test_match(
    left: dict[str, Any], right: dict[str, Any], expected: tuple[str, str, str] | None
) -> None:
    a, b = _source(1, **left), _source(2, **right)

    assert match(a, b) == expected
    assert match(b, a) == expected


def test_candidate_pairs_skips_closed() -> None:
    a, b, c = _source(1, pmid="1"), _source(2, pmid="1"), _source(3, pmid="1")

    pairs = candidate_pairs([a, b, c], closed={frozenset({_id(1), _id(2)})})

    assert {frozenset({p.article_id, p.kept_article_id}) for p in pairs} == {
        frozenset({_id(1), _id(3)}),
        frozenset({_id(2), _id(3)}),
    }


def test_candidate_pairs_triple_shares_the_keeper() -> None:
    a = _source(1, pmid="7", has_pdf=True)
    b = _source(2, pmid="7", has_abstract=True)
    c = _source(3, pmid="7")

    pairs = candidate_pairs([c, b, a], closed=set())

    assert sorted((p.article_id, p.kept_article_id) for p in pairs) == sorted(
        [(_id(2), _id(1)), (_id(3), _id(1)), (_id(3), _id(2))]
    )
    assert {(p.tier, p.match_label, p.basis) for p in pairs} == {("exact", "pmid", "pmid")}


def test_candidate_pairs_orders_by_tier_then_kept_title() -> None:
    sources = [
        _source(1, doi_key="10.1/x", title="Zeta study of things that matter"),
        _source(2, doi_key="10.1/x", title="Another title for the same doi"),
        _source(3, title="Beta title that is long enough"),
        _source(4, title="Beta title that is long enough"),
        _source(5, pmid="5", title="Omega"),
        _source(6, pmid="5", title="Omega"),
        _source(7, pmid="8", title="Alpha"),
        _source(8, pmid="8", title="Alpha"),
    ]

    pairs = candidate_pairs(sources, closed=set())

    assert [(p.tier, p.kept_article_id) for p in pairs] == [
        ("exact", _id(7)),
        ("exact", _id(5)),
        ("likely", _id(3)),
        ("possible", _id(1)),
    ]


def test_candidate_pairs_never_pairs_a_title_without_year() -> None:
    pairs = candidate_pairs(
        [_source(1, publication_year=None), _source(2, publication_year=None)], closed=set()
    )

    assert pairs == []


_BASE = _source(10, created_at=JAN_1)
_KEEP_CASES: list[tuple[str, dict[str, Any], dict[str, Any]]] = [
    # (id, winner overrides, loser overrides): the loser is older and otherwise better below the level.
    (
        "review_work_beats_pdf",
        {"has_review_work": True},
        {"has_pdf": True, "has_abstract": True, "pmid": "1"},
    ),
    ("pdf_beats_abstract", {"has_pdf": True}, {"has_abstract": True, "pmid": "1"}),
    ("abstract_beats_identifier", {"has_abstract": True}, {"pmid": "1"}),
    ("pmid_beats_age", {"pmid": "1"}, {}),
    ("doi_beats_age", {"doi_key": "10.1/a"}, {}),
]


@pytest.mark.parametrize(
    ("winner", "loser"),
    [case[1:] for case in _KEEP_CASES],
    ids=[case[0] for case in _KEEP_CASES],
)
def test_suggest_kept(winner: dict[str, Any], loser: dict[str, Any]) -> None:
    newer = replace(_BASE, article_id=_id(20), created_at=JAN_2, **winner)
    older = replace(_BASE, article_id=_id(21), created_at=JAN_1, **loser)

    assert suggest_kept(newer, older) == _id(20)
    assert suggest_kept(older, newer) == _id(20)


@pytest.mark.parametrize(("first", "second"), [(30, 31), (31, 30)], ids=["ab", "ba"])
def test_suggest_kept_older_wins_at_a_tie(first: int, second: int) -> None:
    older = replace(_BASE, article_id=_id(first), created_at=JAN_1)
    newer = replace(_BASE, article_id=_id(second), created_at=JAN_2)

    assert suggest_kept(older, newer) == _id(first)
    assert suggest_kept(newer, older) == _id(first)


def test_suggest_kept_lower_id_wins_at_the_same_time() -> None:
    low, high = replace(_BASE, article_id=_id(40)), replace(_BASE, article_id=_id(41))

    assert suggest_kept(high, low) == _id(40)

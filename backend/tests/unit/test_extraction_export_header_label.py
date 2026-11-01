"""Unit tests for the "Surname Year" article label and its D2 suffixes."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.services.extraction_export_service import _base_label, _short_id, _suffix_labels


@pytest.mark.parametrize(
    "authors, year, expected",
    [
        # Compound surname with a lowercase particle — must NOT drop "De".
        (["Carlo De Feo"], 2012, "De Feo 2012"),
        (["van der Berg, Anna"], 2019, "van der Berg 2019"),
        (["von Neumann"], 1945, "von Neumann 1945"),
        (["da Silva, João"], 2021, "da Silva 2021"),
        (["Andrew Gaca"], 2011, "Gaca 2011"),
        # "Comma, given" form: surname is before the comma.
        (["Smith, John"], 2000, "Smith 2000"),
        # No year — bare surname.
        (["De Feo, Carlo"], None, "De Feo"),
    ],
)
def test_base_label_is_surname_space_year(authors, year, expected):
    assert _base_label(None, authors, year, uuid4()) == expected


def test_blank_author_falls_back_to_title():
    assert _base_label("A Long Study Title", [""], 2020, uuid4()) == "A Long Study Title"


def test_title_only_articles_sharing_60_chars_get_suffixes():  # Review Focus 4
    a, b = uuid4(), uuid4()
    base = _base_label("T" * 70, None, None, a)
    assert base == "T" * 60
    out = _suffix_labels(
        [
            (b, base, datetime(2026, 1, 2, tzinfo=UTC)),
            (a, base, datetime(2026, 1, 1, tzinfo=UTC)),
        ]
    )
    assert out == {a: "T" * 60, b: "T" * 60 + "b"}


def test_suffixes_continue_c_and_leave_distinct_labels_bare():
    a, b, c, d = uuid4(), uuid4(), uuid4(), uuid4()
    t = datetime(2026, 1, 1, tzinfo=UTC)
    out = _suffix_labels(
        [
            (c, "Smith 2020", t.replace(day=3)),
            (d, "Jones 2021", t.replace(day=4)),
            (a, "Smith 2020", t.replace(day=1)),
            (b, "Smith 2020", t.replace(day=2)),
        ]
    )
    assert out == {a: "Smith 2020", b: "Smith 2020b", c: "Smith 2020c", d: "Jones 2021"}


def test_same_created_at_breaks_ties_by_id():
    t = datetime(2026, 1, 1, tzinfo=UTC)
    low, high = sorted([uuid4(), uuid4()], key=str)
    out = _suffix_labels([(high, "X", t), (low, "X", t)])
    assert out == {low: "X", high: "Xb"}


def test_no_title_no_author_falls_back_to_8_hex_short_id():
    aid = uuid4()
    assert _base_label(None, None, None, aid) == _short_id(aid)
    assert len(_short_id(aid)) == 8

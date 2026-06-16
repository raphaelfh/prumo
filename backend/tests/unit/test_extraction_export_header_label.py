"""Unit tests for particle-aware compound-surname header labels."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.services.extraction_export_service import _build_header_label


@pytest.mark.parametrize(
    "authors, year, expected",
    [
        # Compound surname with a lowercase particle — must NOT drop "De".
        (["Carlo De Feo"], 2012, "De Feo, 2012"),
        (["van der Berg, Anna"], 2019, "van der Berg, 2019"),
        (["von Neumann"], 1945, "von Neumann, 1945"),
        (["da Silva, João"], 2021, "da Silva, 2021"),
        # Plain single surname unchanged.
        (["Gaca, Andrew"], 2011, "Gaca, 2011"),
        (["Andrew Gaca"], 2011, "Gaca, 2011"),
        # "Comma, given" form: surname is before the comma.
        (["Smith, John"], 2000, "Smith, 2000"),
        # No year — bare surname.
        (["De Feo, Carlo"], None, "De Feo"),
    ],
)
def test_compound_surname_preserves_particles(authors, year, expected):
    assert _build_header_label(None, authors, year, uuid4()) == expected


def test_no_authors_falls_back_to_title_then_id():
    aid = uuid4()
    assert _build_header_label("A Long Study Title", None, 2020, aid) == "A Long Study Title"
    assert _build_header_label(None, None, None, aid) == str(aid).split("-")[0]

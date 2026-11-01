"""The screened-article wire shape: the reading fields the panel renders."""

from __future__ import annotations

from app.schemas.screening import ScreeningArticle


def test_screening_article_wire_fields() -> None:
    fields = ScreeningArticle.model_fields
    assert set(fields) == {
        "id",
        "title",
        "abstract",
        "authors",
        "journal_title",
        "publication_year",
        "pmid",
        "doi",
        "mesh_terms",
        "keywords",
        "article_type",
        "language",
    }
    assert fields["mesh_terms"].annotation == list[str] | None
    assert fields["keywords"].annotation == list[str] | None
    assert fields["article_type"].annotation == str | None
    assert fields["language"].annotation == str | None

"""Duplicate detection vocabulary, the duplicates read and the verdicts write.

Support layer: models, repositories and services import from here.
"""

from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

DuplicateVerdictValue = Literal["duplicate", "distinct", "cleared"]
DuplicateBasis = Literal["pmid", "doi", "title", "manual"]
DuplicateTier = Literal["exact", "likely", "possible"]
MatchLabel = Literal["pmid", "doi_title", "title", "doi_only"]


class DuplicateSide(BaseModel):
    """One side of a pair: the fields the compare panel shows."""

    article_id: UUID
    title: str
    authors: list[str]
    publication_year: int | None
    journal_title: str | None
    doi: str | None
    pmid: str | None
    ingestion_source: str | None
    has_pdf: bool
    has_abstract: bool
    screening_decisions: int
    has_review_work: bool
    has_refusing_work: bool = Field(
        description="Full-text or extraction work: the server refuses removing this side."
    )


class DuplicatePair(BaseModel):
    """A candidate pair (open) or a ruled one (resolved).

    ``kept_article_id`` is the keep order's suggestion for an open pair and the
    recorded keeper for a resolved one. ``tier`` and ``match_label`` are
    recomputed from today's metadata; a resolved pair that no longer matches
    carries ``None``.
    """

    article_id: UUID
    kept_article_id: UUID
    tier: DuplicateTier | None
    basis: DuplicateBasis
    match_label: MatchLabel | None
    removed: DuplicateSide
    kept: DuplicateSide
    verdict: Literal["duplicate", "distinct"] | None = None
    decided_by_name: str | None = None
    created_at: datetime | None = None


class DuplicatesRead(BaseModel):
    """Open pairs (tier, then kept title) and resolved pairs (newest first)."""

    open: list[DuplicatePair]
    resolved: list[DuplicatePair]


class DuplicateVerdictCreate(BaseModel):
    """One ruling: ``article_id`` is removed (or judged distinct), ``kept_article_id`` stays.

    The basis is derived by the server from today's metadata, never sent.
    """

    model_config = ConfigDict(extra="forbid")

    article_id: UUID
    kept_article_id: UUID
    verdict: DuplicateVerdictValue

    @model_validator(mode="after")
    def _two_articles(self) -> Self:
        if self.article_id == self.kept_article_id:
            raise ValueError("A record cannot be a duplicate of itself")
        return self


class DuplicateVerdictsCreate(BaseModel):
    """A batch of rulings, applied in order in one transaction."""

    model_config = ConfigDict(extra="forbid")

    items: list[DuplicateVerdictCreate] = Field(min_length=1, max_length=500)


class DuplicateVerdictsResult(BaseModel):
    """Rows written (skips excluded) and kept records enrolled at title/abstract."""

    written: int
    enrolled_kept: int

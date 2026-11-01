"""Duplicate detection vocabulary and the duplicates read.

Support layer: models, repositories and services import from here.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

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

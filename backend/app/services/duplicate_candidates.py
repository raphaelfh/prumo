"""Duplicate candidates (spec §8.2): matching, vetoes, pairing and the keep order.

Pure: no I/O. The sources come from ``DuplicateRepository.candidate_sources``,
one row per non-removed project article. Pairs are found by grouping on PMID,
DOI key and (normalized title, year), never by comparing all pairs.

PubMed stores only the first PublicationType in ``article_type``, so a congress
abstract typed otherwise first escapes the conference veto (R8): it surfaces as
Likely and the manager still decides.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Hashable, Sequence
from dataclasses import dataclass
from itertools import combinations
from uuid import UUID

from app.repositories.duplicate_repository import CandidateSource
from app.schemas.duplicates import DuplicateBasis, DuplicateTier, MatchLabel

_MIN_TITLE_LENGTH = 20
_CONFERENCE_WORDS = ("congress", "conference", "meeting", "protocol")
_CONFERENCE_RIS_TAGS = frozenset({"CONF", "CPAPER", "ABST"})
_TIER_ORDER: dict[DuplicateTier, int] = {"exact": 0, "likely": 1, "possible": 2}

Match = tuple[DuplicateTier, MatchLabel, DuplicateBasis]


@dataclass(frozen=True)
class Candidate:
    article_id: UUID
    kept_article_id: UUID
    tier: DuplicateTier
    match_label: MatchLabel
    basis: DuplicateBasis


def normalize_title(title: str | None) -> str:
    """Case-folded alphanumerics only: punctuation, spaces and case never split a pair."""
    return "".join(c for c in (title or "").casefold() if c.isalnum())


def is_conference_like(source: CandidateSource) -> bool:
    """A conference or protocol record: never Likely or Exact by title, only by PMID."""
    if source.zotero_item_type == "conferencePaper":
        return True
    if source.article_type is None:
        return False
    folded = source.article_type.casefold()
    return (
        any(word in folded for word in _CONFERENCE_WORDS)
        or source.article_type.strip().upper() in _CONFERENCE_RIS_TAGS
    )


def match(a: CandidateSource, b: CandidateSource) -> Match | None:
    """The tier, chip and basis of a pair, or ``None`` when the two never pair."""
    if a.pmid is not None and a.pmid == b.pmid:
        return "exact", "pmid", "pmid"
    if a.doi_key is not None and b.doi_key is not None and a.doi_key != b.doi_key:
        return None
    conference = is_conference_like(a) or is_conference_like(b)
    title_a, title_b = normalize_title(a.title), normalize_title(b.title)
    if a.doi_key is not None and a.doi_key == b.doi_key:
        if title_a == title_b:
            return ("possible" if conference else "exact"), "doi_title", "doi"
        return "possible", "doi_only", "doi"
    if (
        conference
        or title_a != title_b
        or len(title_a) < _MIN_TITLE_LENGTH
        or a.publication_year is None
        or a.publication_year != b.publication_year
    ):
        return None
    if (
        a.journal_title is not None
        and b.journal_title is not None
        and normalize_title(a.journal_title) != normalize_title(b.journal_title)
    ):
        return "possible", "title", "title"
    return "likely", "title", "title"


def _keep_rank(source: CandidateSource) -> tuple[bool, bool, bool, bool, object, UUID]:
    """Lower ranks first: review work → PDF → abstract → identifier → oldest (then id)."""
    has_identifier = source.pmid is not None or source.doi_key is not None
    return (
        not source.has_review_work,
        not source.has_pdf,
        not source.has_abstract,
        not has_identifier,
        source.created_at,
        source.article_id,
    )


def suggest_kept(a: CandidateSource, b: CandidateSource) -> UUID:
    """The one keep order (spec §8.4)."""
    return min(a, b, key=_keep_rank).article_id


def candidate_pairs(
    sources: Sequence[CandidateSource], closed: set[frozenset[UUID]]
) -> list[Candidate]:
    """Open pairs among ``sources``, minus the ``closed`` ones (latest verdict duplicate|distinct).

    Ordered by tier (exact, likely, possible), then the kept article's title, then ids.
    """
    groups: defaultdict[Hashable, list[CandidateSource]] = defaultdict(list)
    for source in sources:
        if source.pmid is not None:
            groups["pmid", source.pmid].append(source)
        if source.doi_key is not None:
            groups["doi", source.doi_key].append(source)
        title = normalize_title(source.title)
        if len(title) >= _MIN_TITLE_LENGTH and source.publication_year is not None:
            groups["title", title, source.publication_year].append(source)

    by_id = {source.article_id: source for source in sources}
    seen: set[frozenset[UUID]] = set()
    pairs: list[Candidate] = []
    for members in groups.values():
        for a, b in combinations(members, 2):
            key = frozenset({a.article_id, b.article_id})
            if key in seen or key in closed:
                continue
            seen.add(key)
            found = match(a, b)
            if found is None:
                continue
            kept = suggest_kept(a, b)
            removed = b.article_id if kept == a.article_id else a.article_id
            pairs.append(Candidate(removed, kept, *found))

    pairs.sort(
        key=lambda p: (
            _TIER_ORDER[p.tier],
            by_id[p.kept_article_id].title,
            str(p.article_id),
            str(p.kept_article_id),
        )
    )
    return pairs

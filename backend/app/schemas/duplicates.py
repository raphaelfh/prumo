"""Duplicate detection vocabulary. Support layer: models, repositories and services import from here."""

from typing import Literal

DuplicateVerdictValue = Literal["duplicate", "distinct", "cleared"]
DuplicateBasis = Literal["pmid", "doi", "title", "manual"]
DuplicateTier = Literal["exact", "likely", "possible"]
MatchLabel = Literal["pmid", "doi_title", "title", "doi_only"]

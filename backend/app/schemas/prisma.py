"""PRISMA flow counts: identification, the title/abstract box and the reports box.

Deliberately no pending or in-conflict count: the payload is served to every
member, and a reviewer must not learn that a peer disagreed. The one exception
is ``full_text_in_progress``, which merges pending and conflict (and records not
yet sent) and is never split.
"""

from __future__ import annotations

from pydantic import BaseModel


class PrismaSourceCount(BaseModel):
    source: str
    count: int


class PrismaReasonCount(BaseModel):
    reason: str
    count: int


class PrismaCountsRead(BaseModel):
    identified: list[PrismaSourceCount]
    identified_total: int
    duplicates_removed: int
    records_not_found: int
    other_removed: int
    screened: int
    excluded: int
    excluded_by_reason: list[PrismaReasonCount]
    excluded_reasons_differ: int
    excluded_without_reason: int
    sought_for_retrieval: int
    ta_included: int
    ta_maybe: int
    # None when full text is off: every reports_* field and the flag.
    reports_not_retrieved: int | None
    reports_assessed: int | None
    reports_excluded_by_reason: list[PrismaReasonCount] | None
    reports_included: int | None
    full_text_in_progress: bool | None

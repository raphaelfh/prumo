"""PRISMA flow counts: identification and the title/abstract screening box.

Deliberately no pending or in-conflict count: the payload is served to every
member, and a reviewer must not learn that a peer disagreed.
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
    imported_not_enrolled: int
    screened: int
    excluded: int
    excluded_by_reason: list[PrismaReasonCount]
    excluded_reasons_differ: int
    excluded_without_reason: int
    sought_for_retrieval: int

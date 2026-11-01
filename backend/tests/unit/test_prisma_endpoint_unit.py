"""The GET /projects/{id}/prisma handler coroutine, called directly.

Handler lines driven through httpx ASGITransport register no coverage, so the
handler's own body needs a direct call.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.api.v1.endpoints import prisma
from app.schemas.prisma import PrismaCountsRead, PrismaReasonCount, PrismaSourceCount

#: The handler body without ``@limiter.limit``'s wrapper (slowapi insists on a real Request).
_handler = prisma.get_prisma_counts.__wrapped__


async def test_prisma_handler_returns_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    counts = PrismaCountsRead(
        identified=[PrismaSourceCount(source="pubmed", count=3)],
        identified_total=3,
        duplicates_removed=0,
        records_not_found=1,
        imported_not_enrolled=0,
        screened=3,
        excluded=1,
        excluded_by_reason=[PrismaReasonCount(reason="Not ML", count=1)],
        excluded_reasons_differ=0,
        excluded_without_reason=0,
        sought_for_retrieval=2,
        ta_included=1,
        ta_maybe=1,
        reports_not_retrieved=0,
        reports_assessed=1,
        reports_excluded_by_reason=[PrismaReasonCount(reason="Wrong outcome", count=1)],
        reports_included=0,
        full_text_in_progress=False,
    )
    project_id = uuid4()
    db = object()
    patched = AsyncMock(return_value=counts)
    monkeypatch.setattr(prisma, "prisma_counts", patched)

    response = await _handler(
        request=SimpleNamespace(state=SimpleNamespace(trace_id="t-1")),
        project_id=project_id,
        db=db,
        _user_sub=uuid4(),
    )

    assert response.ok is True
    assert response.data == counts
    patched.assert_awaited_once_with(db, project_id)

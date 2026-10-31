"""HTTP-level tests for the extraction export endpoint family."""

from __future__ import annotations

import io
from uuid import UUID

from httpx import AsyncClient
from openpyxl import load_workbook

from tests.integration.conftest import SEED

_URL = "/api/v1/projects/{pid}/extraction-export"
_BODY = {
    "template_id": str(SEED.primary_template),
    "mode": "consensus",
    "article_ids": [],
    "shape": "dictionary",
}


async def test_dictionary_with_empty_article_ids_returns_200(
    db_client: AsyncClient, auth_as_profile: UUID
) -> None:
    assert auth_as_profile == SEED.primary_profile
    res = await db_client.post(_URL.format(pid=SEED.primary_project), json=_BODY)
    assert res.status_code == 200, res.text
    assert "Data dictionary" in load_workbook(io.BytesIO(res.content)).sheetnames

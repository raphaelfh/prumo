"""Non-raising role-check helpers (spec §3, the MCP choke point)."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.security import is_project_manager
from tests.integration.conftest import SEED


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("profile_name", "project_name", "expected"),
    [
        ("primary", "primary_project", True),
        ("reviewer", "primary_project", False),
        ("outsider", "primary_project", False),
        ("primary", None, False),
    ],
    ids=["manager", "reviewer-not-manager", "outsider-not-member", "foreign-project"],
)
async def test_is_project_manager(
    db_session: AsyncSession, profile_name: str, project_name: str | None, expected: bool
) -> None:
    profile = {
        "primary": SEED.primary_profile,
        "reviewer": SEED.reviewer_profile,
        "outsider": SEED.outsider_profile,
    }[profile_name]
    project = SEED.primary_project if project_name == "primary_project" else uuid4()

    assert await is_project_manager(db_session, project, profile) is expected

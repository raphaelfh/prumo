"""``McpPrincipal.project_ids`` has no default: "every project" is never
implied by an omitted field, only by an explicit ``None`` from the token row."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.mcp_auth import McpPrincipal

_BASE = {
    "user_sub": uuid4(),
    "token_id": uuid4(),
    "scope": "read",
    "token_expires_at": datetime(2099, 1, 1, tzinfo=UTC),
}


def test_project_ids_is_required() -> None:
    with pytest.raises(ValidationError, match="project_ids"):
        McpPrincipal(**_BASE)  # type: ignore[arg-type]


def test_an_explicit_none_reaches_every_project_and_a_set_only_its_own() -> None:
    inside, outside = uuid4(), uuid4()

    assert McpPrincipal(**_BASE, project_ids=None).reaches(outside) is True  # type: ignore[arg-type]
    restricted = McpPrincipal(**_BASE, project_ids=frozenset({inside}))  # type: ignore[arg-type]
    assert restricted.reaches(inside) is True
    assert restricted.reaches(outside) is False

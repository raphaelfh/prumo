"""``project_details_service.update_details`` against the real schema.

The service is the one writer of the 11 descriptive project columns. What it
owes every caller: only the named keys move, and nothing moves when any
``expected`` value is no longer current (canonical JSON equality).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import NotFoundError
from app.schemas.project_details import ProjectDetailsFields as F
from app.services.project_details_service import StaleProjectValueError, update_details
from tests.integration.conftest import SEED

_JSONB = {"eligibility_criteria", "study_design", "review_keywords"}


async def _set(db: AsyncSession, **cols: Any) -> None:
    assignments = ", ".join(
        f"{col} = CAST(:{col} AS jsonb)"
        if col in _JSONB
        else f"{col} = CAST(:{col} AS review_type)"
        if col == "review_type"
        else f"{col} = :{col}"
        for col in cols
    )
    params = {col: json.dumps(v) if col in _JSONB else v for col, v in cols.items()}
    await db.execute(
        text(f"UPDATE public.projects SET {assignments} WHERE id = :pid"),  # noqa: S608 — test-local column names
        {**params, "pid": str(SEED.primary_project)},
    )
    await db.flush()


async def _row(db: AsyncSession, *cols: str) -> dict[str, Any]:
    result = await db.execute(
        text(f"SELECT {', '.join(cols)} FROM public.projects WHERE id = :pid"),  # noqa: S608 — test-local column names
        {"pid": str(SEED.primary_project)},
    )
    return dict(result.mappings().one())


@pytest.mark.asyncio
async def test_applies_only_the_named_keys_and_reports_before_after(
    db_session: AsyncSession,
) -> None:
    await _set(db_session, description="old", review_title="keep")

    change = await update_details(
        db_session,
        project_id=SEED.primary_project,
        fields=F(description="new"),
        expected=F(description="old"),
    )

    assert change.before == {"description": "old"}
    assert change.after == {"description": "new"}
    assert change.details.description == "new"
    assert change.details.review_title == "keep"
    assert isinstance(change.details.updated_at, datetime)
    assert await _row(db_session, "description", "review_title") == {
        "description": "new",
        "review_title": "keep",
    }


@pytest.mark.asyncio
async def test_stale_value_raises_with_current_and_writes_nothing(
    db_session: AsyncSession,
) -> None:
    await _set(db_session, name="Agent name", description="d")

    with pytest.raises(StaleProjectValueError) as info:
        await update_details(
            db_session,
            project_id=SEED.primary_project,
            fields=F(name="Mine", description="d2"),
            expected=F(name="Old name", description="d"),
        )

    assert info.value.status_code == 409
    assert info.value.code == "STALE_VALUE"
    assert info.value.details == {"current": {"name": "Agent name"}}
    assert await _row(db_session, "name", "description") == {
        "name": "Agent name",
        "description": "d",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("column", "stored", "expected_value", "new_value", "stale"),
    [
        (
            "eligibility_criteria",
            {"inclusion": ["a"], "notes": ""},
            {"notes": "", "inclusion": ["a"]},
            {"inclusion": ["z"]},
            False,
        ),
        ("review_keywords", ["a", "b"], ["b", "a"], ["z"], True),
        ("description", None, "", "new", True),
        ("description", "x ", "x", "new", True),
        ("review_type", "diagnostic", "diagnostic", "qualitative", False),
    ],
    ids=["jsonb-key-order", "list-order", "null-vs-empty", "trailing-space", "enum-equal"],
)
async def test_precondition_is_canonical_json_equality(
    db_session: AsyncSession,
    column: str,
    stored: Any,
    expected_value: Any,
    new_value: Any,
    stale: bool,
) -> None:
    await _set(db_session, **{column: stored})

    call = update_details(
        db_session,
        project_id=SEED.primary_project,
        fields=F.model_validate({column: new_value}),
        expected=F.model_validate({column: expected_value}),
    )
    if stale:
        with pytest.raises(StaleProjectValueError):
            await call
        assert (await _row(db_session, column))[column] == stored
    else:
        await call
        assert (await _row(db_session, column))[column] == new_value


@pytest.mark.asyncio
async def test_jsonb_columns_round_trip(db_session: AsyncSession) -> None:
    before = await _row(db_session, "study_design", "review_keywords")

    await update_details(
        db_session,
        project_id=SEED.primary_project,
        fields=F(study_design={"types": ["RCT"], "notes": "n"}, review_keywords=["k1"]),
        expected=F.model_validate(before),
    )

    assert await _row(db_session, "study_design", "review_keywords") == {
        "study_design": {"types": ["RCT"], "notes": "n"},
        "review_keywords": ["k1"],
    }


@pytest.mark.asyncio
async def test_missing_project_is_not_found(db_session: AsyncSession) -> None:
    with pytest.raises(NotFoundError) as info:
        await update_details(
            db_session, project_id=uuid4(), fields=F(name="n"), expected=F(name="o")
        )
    assert info.value.status_code == 404

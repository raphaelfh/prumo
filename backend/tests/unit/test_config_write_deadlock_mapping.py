"""A deadlocked config write is a retry, not a server fault.

`template_discard_service` already treats 40P01 as a retryable 409
(`DiscardRacedError`, "Nothing was changed — try again"), because its own
docstring notes the publish/discard lock order can deadlock with a
concurrent editor. The B-7 structure-write endpoints acquire the SAME
advisory locks through `claim_draft_lock` (B-9f) and had no such mapping,
so a lost deadlock race surfaced as a 500 — telling the manager prumo
broke when the honest answer is "someone else was editing; try again".
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import DBAPIError

import app.api.v1.endpoints.template_structure as endpoint_module
from app.api.v1.endpoints._integrity import DEADLOCK_RETRY_DETAIL, is_deadlock

_EP = "app.api.v1.endpoints.template_structure"


class _PgLikeError(Exception):
    def __init__(self, sqlstate: str) -> None:
        super().__init__("deadlock detected")
        self.sqlstate = sqlstate


def _dbapi_error(sqlstate: str) -> DBAPIError:
    return DBAPIError("stmt", {}, _PgLikeError(sqlstate))


def test_is_deadlock_matches_40P01() -> None:
    assert is_deadlock(_dbapi_error("40P01")) is True


def test_is_deadlock_matches_pgcode_when_sqlstate_is_absent() -> None:
    """asyncpg exposes `sqlstate`; psycopg exposes `pgcode`.

    The repo talks to Postgres through asyncpg, but `DiscardRacedError`'s
    own detection reads pgcode — so both spellings are accepted rather than
    betting on which driver raised.
    """

    class _PgcodeOnly(Exception):
        pgcode = "40P01"

    assert is_deadlock(DBAPIError("stmt", {}, _PgcodeOnly())) is True


def test_is_deadlock_matches_through_the_cause_chain() -> None:
    """SQLAlchemy's adapter can wrap the driver error one level down."""
    inner = _PgLikeError("40P01")
    outer = Exception("adapter")
    outer.__cause__ = inner
    assert is_deadlock(DBAPIError("stmt", {}, outer)) is True


def test_is_deadlock_rejects_other_sqlstates() -> None:
    """A serialization failure or an FK violation is NOT a deadlock.

    Mapping them to "try again" would tell a user to retry something that
    will fail identically every time.
    """
    for state in ("40001", "23503", "23505", "22P02"):
        assert is_deadlock(_dbapi_error(state)) is False


#: Every write endpoint, with the service symbol it delegates to and the
#: extra path params it needs. A table rather than eight near-identical
#: tests: the failure this guards is a NEW write endpoint landing without a
#: deadlock arm, and that shows up here as a missing row a reviewer reads.
WRITE_ENDPOINTS = [
    ("create_template_field", "create_field", {"body": MagicMock()}),
    ("update_template_field", "update_field", {"field_id": uuid.uuid4(), "body": MagicMock()}),
    ("delete_template_field", "delete_field", {"field_id": uuid.uuid4()}),
    ("move_template_field", "move_field", {"field_id": uuid.uuid4(), "body": MagicMock()}),
    ("reorder_template_fields", "reorder_fields", {"body": MagicMock()}),
    ("create_template_section", "create_section", {"body": MagicMock()}),
    (
        "update_template_section",
        "update_section",
        {"section_id": uuid.uuid4(), "body": MagicMock()},
    ),
    ("delete_template_section", "delete_section", {"section_id": uuid.uuid4()}),
]


@pytest.mark.parametrize("endpoint,service,extra", WRITE_ENDPOINTS)
@pytest.mark.asyncio
async def test_every_write_endpoint_maps_a_deadlock_to_409(endpoint, service, extra) -> None:
    """All eight, not a representative one.

    They acquire the same advisory locks, so they lose the same race; an
    endpoint without the arm turns it into a 500.
    """
    db = AsyncMock()
    with (
        patch(f"{_EP}.claim_draft_lock", AsyncMock()),
        patch(f"{_EP}.{service}", AsyncMock(side_effect=_dbapi_error("40P01"))),
        pytest.raises(HTTPException) as exc,
    ):
        await getattr(endpoint_module, endpoint)(
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            request=MagicMock(),
            db=db,
            user_sub=uuid.uuid4(),
            **extra,
        )

    assert exc.value.status_code == 409
    assert exc.value.detail == DEADLOCK_RETRY_DETAIL
    db.commit.assert_not_awaited()


@pytest.mark.parametrize("endpoint,service,extra", WRITE_ENDPOINTS)
@pytest.mark.asyncio
async def test_a_deadlock_while_CLAIMING_the_lock_is_also_a_409(endpoint, service, extra) -> None:
    """The claim is itself an UPDATE on the template row, so it deadlocks too.

    The service is patched to a NO-OP on purpose: it proves the 409 came
    from the claim and not from the write, which a bare patch of the claim
    alone would leave ambiguous.
    """
    db = AsyncMock()
    with (
        patch(f"{_EP}.claim_draft_lock", AsyncMock(side_effect=_dbapi_error("40P01"))),
        patch(f"{_EP}.{service}", AsyncMock()),
        pytest.raises(HTTPException) as exc,
    ):
        await getattr(endpoint_module, endpoint)(
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            request=MagicMock(),
            db=db,
            user_sub=uuid.uuid4(),
            **extra,
        )

    assert exc.value.status_code == 409
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_non_deadlock_DBAPIError_still_propagates() -> None:
    """Only 40P01 is retryable; a real fault must not hide behind "try again"."""
    with (
        patch(f"{_EP}.claim_draft_lock", AsyncMock()),
        patch(f"{_EP}.delete_field", AsyncMock(side_effect=_dbapi_error("22P02"))),
        pytest.raises(DBAPIError),
    ):
        await endpoint_module.delete_template_field(
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            field_id=uuid.uuid4(),
            request=MagicMock(),
            db=AsyncMock(),
            user_sub=uuid.uuid4(),
        )

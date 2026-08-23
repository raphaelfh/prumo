"""``app.core.integrity.violates_constraint`` and its two consumers' race
branches, which the integration suites never reach (they only take the
flush-succeeds path).

The fake errors mirror what asyncpg + SQLAlchemy actually produce: the
driver error carries ``constraint_name``; SQLAlchemy's dbapi adapter may wrap
it one level deeper (``orig.__cause__``); and Postgres always names the
constraint in the message, which is the fallback.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.error_handler import ConflictError
from app.core.integrity import violates_constraint
from app.services.project_template_active_service import SINGLE_ACTIVE_INDEX, flush_activation
from app.services.template_delete_service import (
    TemplateActiveError,
    TemplateInUseError,
    delete_template,
)

NAME = "uq_one_active_extraction_template_per_project"


def _integrity_error(orig: object) -> IntegrityError:
    return IntegrityError("INSERT ...", {}, orig)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("orig", "expected"),
    [
        (SimpleNamespace(constraint_name=NAME), True),
        (SimpleNamespace(__cause__=SimpleNamespace(constraint_name=NAME)), True),
        (Exception(f'duplicate key value violates unique constraint "{NAME}"'), True),
        (SimpleNamespace(constraint_name="some_other_constraint"), False),
        (Exception("deadlock detected"), False),
    ],
)
def test_violates_constraint_matches_driver_attribute_then_message(orig, expected) -> None:
    assert violates_constraint(_integrity_error(orig), NAME) is expected


def test_violates_constraint_accepts_several_names() -> None:
    exc = _integrity_error(SimpleNamespace(constraint_name="b_fkey"))
    assert violates_constraint(exc, "a_fkey", "b_fkey") is True
    assert violates_constraint(exc, "a_fkey") is False


# ---------------------------------------------------------------- flush_activation


@pytest.mark.asyncio
async def test_flush_activation_maps_single_active_race_to_409() -> None:
    db = AsyncMock()
    db.flush = AsyncMock(
        side_effect=_integrity_error(SimpleNamespace(constraint_name=SINGLE_ACTIVE_INDEX))
    )
    with pytest.raises(ConflictError) as exc:
        await flush_activation(db)
    assert exc.value.status_code == 409 and exc.value.code == "CONFLICT"


@pytest.mark.asyncio
async def test_flush_activation_reraises_unrelated_integrity_errors() -> None:
    db = AsyncMock()
    db.flush = AsyncMock(side_effect=_integrity_error(SimpleNamespace(constraint_name="other")))
    with pytest.raises(IntegrityError):
        await flush_activation(db)


# ---------------------------------------------------------------- delete races


def _stale_inactive_template(project_id):
    return SimpleNamespace(id=uuid4(), project_id=project_id, is_active=False)


def _db_for_delete(*, counts=(0, 0), delete_result=None, delete_raises=None) -> AsyncMock:
    """A session whose reads say 'inactive, unreferenced' while the DELETE
    sees a different world — the two races the locked guards still leave."""
    db = AsyncMock()
    counts_result = SimpleNamespace(one=lambda: counts)
    delete_res = SimpleNamespace(scalar_one_or_none=lambda: delete_result)

    async def execute(stmt):
        sql = str(stmt)
        if sql.startswith("DELETE FROM public.project_extraction_templates"):
            if delete_raises is not None:
                raise delete_raises
            return delete_res
        if "count(" in sql.lower():
            return counts_result
        return SimpleNamespace(rowcount=0)

    db.execute = AsyncMock(side_effect=execute)
    return db


@pytest.mark.asyncio
async def test_delete_concurrent_switch_after_the_read_is_template_active(monkeypatch) -> None:
    """RETURNING yields no row: a Switch activated the template between the
    locked read and the conditional DELETE."""
    project_id = uuid4()
    stale = _stale_inactive_template(project_id)
    monkeypatch.setattr(
        "app.services.template_delete_service.owned_template", AsyncMock(return_value=stale)
    )
    monkeypatch.setattr(
        "app.services.template_delete_service.HitlConfigRepository",
        lambda _db: SimpleNamespace(delete_by_scope=AsyncMock(return_value=False)),
    )
    db = _db_for_delete(delete_result=None)
    with pytest.raises(TemplateActiveError):
        await delete_template(db, project_id=project_id, template_id=stale.id)


@pytest.mark.asyncio
async def test_delete_fk_violation_after_the_read_is_template_in_use(monkeypatch) -> None:
    """A run landed between the count and the DELETE: the RESTRICT FK fires
    and maps to the same 409 the pre-check would have raised."""
    project_id = uuid4()
    stale = _stale_inactive_template(project_id)
    monkeypatch.setattr(
        "app.services.template_delete_service.owned_template", AsyncMock(return_value=stale)
    )
    monkeypatch.setattr(
        "app.services.template_delete_service.HitlConfigRepository",
        lambda _db: SimpleNamespace(delete_by_scope=AsyncMock(return_value=False)),
    )
    db = _db_for_delete(
        delete_raises=_integrity_error(
            SimpleNamespace(constraint_name="extraction_runs_template_id_fkey")
        )
    )
    with pytest.raises(TemplateInUseError) as exc:
        await delete_template(db, project_id=project_id, template_id=stale.id)
    assert exc.value.code == "TEMPLATE_IN_USE"


@pytest.mark.asyncio
async def test_delete_unrelated_integrity_error_reraises(monkeypatch) -> None:
    project_id = uuid4()
    stale = _stale_inactive_template(project_id)
    monkeypatch.setattr(
        "app.services.template_delete_service.owned_template", AsyncMock(return_value=stale)
    )
    monkeypatch.setattr(
        "app.services.template_delete_service.HitlConfigRepository",
        lambda _db: SimpleNamespace(delete_by_scope=AsyncMock(return_value=False)),
    )
    db = _db_for_delete(
        delete_raises=_integrity_error(SimpleNamespace(constraint_name="something_else"))
    )
    with pytest.raises(IntegrityError):
        await delete_template(db, project_id=project_id, template_id=stale.id)

"""ON DELETE RESTRICT changes SQLSTATE with the server version.

Measured on the same DDL and the same DELETE, through SQLAlchemy + asyncpg:

    PG 17.6 -> asyncpg.exceptions.ForeignKeyViolationError, 23503
    PG 18.6 -> asyncpg.exceptions.RestrictViolationError,   23001

Two services turn that error into a typed domain error, and both were
gated on the literal ``"23503"`` — so on Postgres 18 the mapping stopped
firing and a raw ``IntegrityError`` escaped to the client (a 500 where a
409 was owed). The integration suites cannot catch this: they run against
whatever server the developer or CI happens to have, and a PG17 run is
green either way. These tests pin BOTH shapes in-process, so the mapping
is proven on the Postgres we run today and the one we will run next.

The fixture mirrors what the two layers actually deliver, verified
against a live 17.6 and a live 18.6: SQLAlchemy's dbapi adapter error
carries the SQLSTATE, and the asyncpg error one level down
(``orig.__cause__``) carries ``constraint_name``.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from asyncpg.exceptions import ForeignKeyViolationError, RestrictViolationError
from sqlalchemy.exc import IntegrityError

from app.repositories.extraction_field_reference_repository import RESTRICT_FKS
from app.services.template_discard_service import DiscardRacedError, _reraise_if_raced
from app.services.template_field_service import FieldInUseError, _pgcode, delete_field

#: The code the two gates used to accept, and only it. Named here so the
#: guard test below can state what it is guarding against.
_LEGACY_FK_VIOLATION = "23503"

#: A real ``field_id`` RESTRICT FK — the one a delete of a field with a
#: recorded proposal actually violates.
_PROPOSAL_FK = "extraction_proposal_records_field_id_fkey"

#: An FK violation that is NOT recorded work. The discard writer hitting
#: this means its own phase order is wrong, and it must keep surfacing as
#: a fault rather than as "someone else was editing".
_PARENT_FK = "extraction_entity_types_parent_entity_type_id_fkey"

#: (id, driver error class) per server generation. ``sqlstate`` is a class
#: attribute on asyncpg's exceptions, so the id and the code cannot drift.
SERVERS = [
    pytest.param(ForeignKeyViolationError, id="pg17-23503"),
    pytest.param(RestrictViolationError, id="pg18-23001"),
]


def _restrict_violation(driver_error: type[Exception], constraint: str) -> IntegrityError:
    """An ``IntegrityError`` shaped exactly like the live servers produce."""
    driver = driver_error(
        f'update or delete on table "extraction_fields" violates foreign key '
        f'constraint "{constraint}" on table "extraction_proposal_records"'
    )
    driver.constraint_name = constraint  # type: ignore[attr-defined]
    adapter = Exception(str(driver))
    adapter.sqlstate = driver_error.sqlstate  # type: ignore[attr-defined]
    adapter.__cause__ = driver
    return IntegrityError("DELETE FROM public.extraction_fields ...", {}, adapter)


# ------------------------------------------------------- the guard on the guard


def test_the_pg18_fixture_is_invisible_to_the_old_23503_gate() -> None:
    """Without this, the parametrization could silently degrade.

    Two fixtures that both carried 23503 would pass every test below
    against the UNFIXED code. This asserts the precondition the whole file
    rests on: the PG18 fixture really does carry a code the old gate
    rejected, and the PG17 one really does carry the code it accepted.
    """
    pg18 = _restrict_violation(RestrictViolationError, _PROPOSAL_FK)
    pg17 = _restrict_violation(ForeignKeyViolationError, _PROPOSAL_FK)

    assert _pgcode(pg18) == "23001"
    assert _pgcode(pg18) != _LEGACY_FK_VIOLATION
    assert _pgcode(pg17) == _LEGACY_FK_VIOLATION
    # And the constraint name — the signal that does NOT move — survives
    # the adapter on both, which is what lets the field service match by name.
    assert pg18.orig.__cause__.constraint_name == _PROPOSAL_FK
    assert pg17.orig.__cause__.constraint_name == _PROPOSAL_FK


# ------------------------------------------------------- template_discard_service


@pytest.mark.parametrize("driver_error", SERVERS)
def test_a_lost_race_on_a_restrict_fk_is_a_race_on_both_servers(driver_error) -> None:
    exc = _restrict_violation(driver_error, _PROPOSAL_FK)
    assert _pgcode(exc) == driver_error.sqlstate  # precondition, not decoration
    assert _PROPOSAL_FK in RESTRICT_FKS

    with pytest.raises(DiscardRacedError):
        _reraise_if_raced(
            exc, project_id=uuid.uuid4(), template_id=uuid.uuid4(), user_id=uuid.uuid4()
        )


@pytest.mark.parametrize("driver_error", SERVERS)
def test_a_parent_fk_violation_is_still_not_a_race(driver_error) -> None:
    """Widening the SQLSTATE set must not widen what counts as a race.

    ``parent_entity_type_id`` carries the same code as recorded work on
    both servers; only its NAME says it is a bug in the writer's phase
    order rather than a lost race. Reporting it as "try again" would hide
    that bug behind a friendly sentence forever.
    """
    exc = _restrict_violation(driver_error, _PARENT_FK)
    assert _pgcode(exc) == driver_error.sqlstate
    assert _PARENT_FK not in RESTRICT_FKS

    # Returns instead of raising: the caller re-raises the original.
    assert (
        _reraise_if_raced(
            exc, project_id=uuid.uuid4(), template_id=uuid.uuid4(), user_id=uuid.uuid4()
        )
        is None
    )


# ------------------------------------------------------- template_field_service


@pytest.mark.parametrize("driver_error", SERVERS)
@pytest.mark.asyncio
async def test_delete_field_maps_a_pinned_field_to_409_on_both_servers(
    driver_error, monkeypatch
) -> None:
    """The B-7 delete: five RESTRICT FKs mean "this field holds recorded
    work", and the client is owed ``FieldInUseError`` (409), never the raw
    ``IntegrityError`` a PG18 server produced before this fix."""
    project_id, template_id, field_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    field = SimpleNamespace(id=field_id, entity_type_id=uuid.uuid4())
    monkeypatch.setattr(
        "app.services.template_field_service._owned_template", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        "app.services.template_field_service._owned_field", AsyncMock(return_value=field)
    )
    exc = _restrict_violation(driver_error, _PROPOSAL_FK)
    assert _pgcode(exc) == driver_error.sqlstate  # precondition, not decoration

    db = AsyncMock()
    db.flush = AsyncMock(side_effect=exc)
    with pytest.raises(FieldInUseError):
        await delete_field(db, project_id=project_id, template_id=template_id, field_id=field_id)


@pytest.mark.asyncio
async def test_delete_field_reraises_an_unrelated_integrity_error(monkeypatch) -> None:
    """Matching by name must not turn every integrity failure into a 409."""
    field = SimpleNamespace(id=uuid.uuid4(), entity_type_id=uuid.uuid4())
    monkeypatch.setattr(
        "app.services.template_field_service._owned_template", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        "app.services.template_field_service._owned_field", AsyncMock(return_value=field)
    )
    db = AsyncMock()
    db.flush = AsyncMock(side_effect=_restrict_violation(RestrictViolationError, "some_other_fkey"))
    with pytest.raises(IntegrityError):
        await delete_field(
            db,
            project_id=uuid.uuid4(),
            template_id=uuid.uuid4(),
            field_id=field.id,
        )

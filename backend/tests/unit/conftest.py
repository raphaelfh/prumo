"""Shared unit-test doubles.

Imported explicitly by the ``test_seed_*`` modules
(``from tests.unit.conftest import CapturingSession``), matching the
``tests.integration.conftest`` import convention used elsewhere.
"""

from __future__ import annotations


class CapturingSession:
    """A fake ``AsyncSession`` that forces the seed build path and records
    every ``add``ed ORM object.

    The seed functions only use ``get`` (returned as ``None`` here so the
    build path runs instead of the "already exists" short-circuit) and
    ``add`` — no execute/flush/commit — so this needs no database. That
    lets the seed's *declared* shape be asserted independently of whatever
    a previous ``make db-seed`` left in the shared local database.
    """

    def __init__(self) -> None:
        self.added: list[object] = []

    async def get(self, *_a: object, **_k: object) -> None:
        return None

    def add(self, obj: object) -> None:
        self.added.append(obj)


class ExistingTemplateSession(CapturingSession):
    """``CapturingSession`` whose ``get`` reports an existing row, exercising
    a seed function's idempotency short-circuit."""

    async def get(self, *_a: object, **_k: object) -> object:
        return object()

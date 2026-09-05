"""Shared unit-test doubles and the seed-recording helper built on them.

Imported explicitly by the ``test_seed_*`` modules
(``from tests.unit.conftest import CapturingSession, seeded``), matching the
``tests.integration.conftest`` import convention used elsewhere.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

T = TypeVar("T")


class CapturingSession:
    """A fake ``AsyncSession`` that forces the seed build path and records
    every ``add``ed ORM object.

    ``get`` returns ``None`` so the build path runs instead of the "already
    exists" short-circuit, and ``execute`` RECORDS rather than ignoring — the
    converging seeder takes an advisory lock through it, and a silently
    swallowed statement here would hide a stray DELETE. That lets the seed's
    *declared* shape be asserted independently of whatever a previous
    ``make db-seed`` left in the shared local database.
    """

    def __init__(self) -> None:
        self.added: list[object] = []
        self.executed: list[object] = []

    async def get(self, *_a: object, **_k: object) -> None:
        return None

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def added_of(self, cls: type[T]) -> list[T]:
        """The ``add``ed objects of one ORM class, in seeded order."""
        return [o for o in self.added if isinstance(o, cls)]

    #: What ``execute``'s result reports from ``scalar_one_or_none`` — the shape
    #: the converging seeder's "is the catalogue referenced?" probe reads.
    scalar_result: Any = None

    async def execute(self, statement: object, *_a: object, **_k: object) -> _Result:
        self.executed.append(statement)
        return _Result(self.scalar_result)

    async def flush(self) -> None:
        return None


async def seeded(seed_fn: Callable[[Any], Awaitable[None]], cls: type[T]) -> list[T]:
    """Run ``seed_fn`` against a fresh recording session; return what it
    ``add``ed of ``cls``.

    A seed that finds its template already in the database skips or
    converges onto it, so a database-backed assertion would describe
    whichever seed last ran against the shared local stack. This reads
    the seed's *declared* shape instead.
    """
    session = CapturingSession()
    await seed_fn(session)
    return session.added_of(cls)


class _Result:
    """The sliver of ``sqlalchemy.Result`` the seeders touch."""

    def __init__(self, scalar: Any) -> None:
        self._scalar = scalar

    def scalar_one_or_none(self) -> Any:
        return self._scalar


class ExistingTemplateSession(CapturingSession):
    """``CapturingSession`` whose ``get`` reports an existing row, exercising
    a seed function's idempotency short-circuit."""

    async def get(self, *_a: object, **_k: object) -> object:
        return object()


class ConvergingSession(CapturingSession):
    """``CapturingSession`` whose ``get`` returns a MUTABLE existing row.

    ``ExistingTemplateSession``'s bare ``object()`` models a seeder that only
    reads the row to bail out. A converging seeder writes to it, so the double
    must hold attributes — and the test then asserts the row was UPDATED in
    place rather than re-``add``ed, which is the invariant that keeps every
    clone's ``global_template_id`` from being SET NULL.
    """

    def __init__(self) -> None:
        super().__init__()
        self.existing: Any = _ExistingRow()

    async def get(self, *_a: object, **_k: object) -> object:
        return self.existing


class _ExistingRow:
    """Attribute bag standing in for a loaded ``ExtractionTemplateGlobal``."""

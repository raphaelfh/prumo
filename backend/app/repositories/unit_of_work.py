"""Unit of Work — a transactional context manager over one AsyncSession.

WHAT THIS IS (and is not)
=========================

`UnitOfWork` owns a transaction boundary and exposes the repositories that
have a caller reaching them *through* it. It is deliberately NOT a facade
over every repository: services construct the repositories they need
directly (`ArticleRepository(db)`), which is the pattern the codebase
actually follows. Registering a repository here "because it exists" grows
members nothing calls.

So the rule for this file is: **add a repository here only when a caller
goes through `uow`.** Everything else constructs its own.

WHO USES IT
===========

The API layer, via the `app.core.transactions` re-export — that indirection
is what lets `check_layered_arch.py` tell "the API touches transaction
infrastructure" (allowed) from "the API reaches past services into
repositories" (a violation). Both current call sites gate project
membership before doing work:

    async with UnitOfWork(db) as uow:
        is_member = await uow.project_members.is_member(project_id, user_sub)

TRANSACTION SEMANTICS
=====================

`__aexit__` rolls back if an exception escaped the block and does nothing
otherwise — it never commits. Repositories `flush()` and never `commit()`
(constitution §I), so a block that writes must call `commit()` itself or
the changes are discarded when the request's session closes.
"""

from types import TracebackType
from typing import Self

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.project_repository import ProjectMemberRepository


class UnitOfWork:
    """Transaction boundary + the repositories reached through it.

    Always use with `async with`: the automatic rollback lives in
    `__aexit__`, so a bare `UnitOfWork(session)` gives up the only
    guarantee the class provides.

    Attributes:
        session: the underlying SQLAlchemy AsyncSession.
        project_members: project-membership repository.
    """

    def __init__(self, session: AsyncSession):
        """Initialize the Unit of Work.

        Args:
            session: SQLAlchemy async session.
        """
        self.session = session
        # Only repositories with a caller live here — see the module docstring.
        self.project_members = ProjectMemberRepository(session)

    async def commit(self) -> None:
        """Commit the current transaction.

        Required after any write: `__aexit__` never commits for you, so
        without this call the changes are discarded when the session closes.
        """
        await self.session.commit()

    async def rollback(self) -> None:
        """Discard every pending change (flushed but not committed).

        Called automatically by `__aexit__` when an exception escapes.
        """
        await self.session.rollback()

    async def __aenter__(self) -> Self:
        """Enter the async context; returns self for `async with ... as uow`."""
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        _exc_val: BaseException | None,
        _exc_tb: TracebackType | None,
    ) -> None:
        """Roll back on exception so a failed block commits nothing.

        On a clean exit this does nothing — in particular it does not
        commit. See the module docstring.
        """
        if exc_type is not None:
            await self.rollback()

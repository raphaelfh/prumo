"""Shared raw-INSERT helper for a ``personal_access_tokens`` row in tests.

The service layer never inserts a token row directly outside
``pat_service`` (issuance goes through a hash + prefix pipeline the
callers here don't need); tests that only need a row to hang an
``agent_actions.token_id`` or FK-delete case off of use this, instead of
each integration module writing its own raw INSERT.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.integration.conftest import SEED


async def insert_pat_row(db: AsyncSession, name: str = "audit-probe") -> UUID:
    """Insert a throwaway, valid ``personal_access_tokens`` row and return its id."""
    token_id = uuid4()
    await db.execute(
        text(
            "INSERT INTO public.personal_access_tokens "
            "(id, user_id, name, token_prefix, token_hash, scope, expires_at) "
            "VALUES (:id, :uid, :name, 'prumo_pat_abcdef', :hash, "
            "'read_write', now() + interval '30 days')"
        ),
        {"id": str(token_id), "uid": str(SEED.primary_profile), "name": name, "hash": uuid4().hex},
    )
    return token_id

"""Display names for a set of profiles — one query, ``None`` for a profile
without ``full_name`` (the popover renders a fallback, never a raw id).
A leaf: it imports only the model, so every service may import it."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Profile

__all__ = ["profile_names"]


async def profile_names(db: AsyncSession, ids: set[UUID]) -> dict[UUID, str | None]:
    rows = await db.execute(select(Profile.id, Profile.full_name).where(Profile.id.in_(ids)))
    return dict(rows.all())

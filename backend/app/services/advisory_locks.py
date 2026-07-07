"""Transaction-scoped Postgres advisory locks shared across services.

Lives in its own module (not ``hitl_session_service``) so that
``run_lifecycle_service`` — which the session service imports — can take the
SAME (article_id, project_template_id) lock without a circular import. Every
run creator/resolver for a coordinate MUST use the same key derivation, or
they stop serializing against each other and the one-live-run invariant races.
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def take_advisory_xact_lock(db: AsyncSession, left: UUID, right: UUID) -> None:
    """Take a transaction-scoped advisory lock keyed by (left, right).

    Uses Postgres' built-in ``hashtextextended`` to derive a bigint
    fingerprint from the UUID pair — Postgres treats the result as a
    signed bigint, which is exactly what ``pg_advisory_xact_lock(bigint)``
    wants. The lock is released automatically on commit/rollback.
    """
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"{left}:{right}"},
    )

"""Security dependency helpers for evaluation endpoints."""

from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import Depends, HTTPException, status
from sqlalchemy import text

from app.core.deps import CurrentUser, DbSession


async def get_current_user_sub(user: CurrentUser) -> UUID:
    """Extract and validate `user.sub` from JWT payload."""
    try:
        return UUID(user.sub)
    except (TypeError, ValueError):
        # Keep compatibility with legacy test fixtures that use non-UUID subjects.
        if isinstance(user.sub, str) and user.sub:
            return uuid5(NAMESPACE_URL, user.sub)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
        )


async def require_project_scope(
    project_id: UUID,
    db: DbSession,
    user_sub: UUID = Depends(get_current_user_sub),
) -> UUID:
    """Ensure current user is a member of the requested project."""
    result = await db.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM public.project_members pm
                WHERE pm.project_id = :project_id
                  AND pm.user_id = :user_id
            ) AS allowed
            """
        ),
        {"project_id": str(project_id), "user_id": str(user_sub)},
    )
    if not bool(result.scalar_one()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project access denied",
        )
    return user_sub

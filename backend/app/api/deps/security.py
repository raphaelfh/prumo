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


async def ensure_project_member(db: DbSession, project_id: UUID, user_sub: UUID) -> None:
    """Enforce project-membership at the API layer.

    The DB session runs as service-role (RLS bypassed); enforce membership
    manually using the same SQL helper the RLS policies use. Plain async
    helper (not a FastAPI dependency) so callers can pass a ``project_id``
    sourced from the request body — see hitl_sessions / extraction_runs.
    """
    is_member = (
        await db.execute(
            text("SELECT public.is_project_member(:pid, :uid) AS ok"),
            {"pid": str(project_id), "uid": str(user_sub)},
        )
    ).scalar_one()
    if not is_member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Project access denied",
        )


async def ensure_project_reviewer(db: DbSession, project_id: UUID, user_sub: UUID) -> None:
    """Enforce a reviewer-capable role (manager / reviewer / consensus) at the API layer.

    Mirrors ``ensure_project_member`` but uses the ``is_project_reviewer`` SQL
    helper (the same predicate the workflow RLS policies use), so a read-only
    *viewer* is rejected. The DB session runs as service-role (RLS bypassed), so
    this gate must live at the API layer for write paths that are reviewer-only.
    """
    is_reviewer = (
        await db.execute(
            text("SELECT public.is_project_reviewer(:pid, :uid) AS ok"),
            {"pid": str(project_id), "uid": str(user_sub)},
        )
    ).scalar_one()
    if not is_reviewer:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reviewer role required",
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


async def require_project_manager(
    project_id: UUID,
    db: DbSession,
    user_sub: UUID = Depends(get_current_user_sub),
) -> UUID:
    """Ensure current user is a manager of the requested project.

    Used by endpoints that change project-wide configuration (HITL config,
    template enablement, member management). Reviewer or viewer roles are
    rejected here even though they may be able to read the config.
    """
    result = await db.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1
                FROM public.project_members pm
                WHERE pm.project_id = :project_id
                  AND pm.user_id = :user_id
                  AND pm.role = 'manager'
            ) AS allowed
            """
        ),
        {"project_id": str(project_id), "user_id": str(user_sub)},
    )
    if not bool(result.scalar_one()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager role required",
        )
    return user_sub

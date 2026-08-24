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


async def _project_role_allows(
    db: DbSession, *, sql: str, project_id: UUID, user_sub: UUID
) -> bool:
    """Evaluate a parameterised ``public.is_project_*`` boolean.

    The DB session runs as service-role (RLS bypassed), so these gates must live
    at the API layer using the same SQL helpers the RLS policies use. ``sql`` is a
    module-internal literal (never request-derived) — no injection surface.
    """
    return bool(
        (
            await db.execute(
                text(sql),
                {"pid": str(project_id), "uid": str(user_sub)},
            )
        ).scalar_one()
    )


async def _ensure_project_role(
    db: DbSession, *, sql: str, project_id: UUID, user_sub: UUID, error: str
) -> None:
    """Run a role boolean and 403 when it is false."""
    if not await _project_role_allows(db, sql=sql, project_id=project_id, user_sub=user_sub):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=error)


async def is_project_member(db: DbSession, project_id: UUID, user_sub: UUID | str) -> bool:
    """Report project-membership without raising.

    The non-raising counterpart to :func:`ensure_project_member`, for endpoints
    that own their refusal shape — ``zotero_import`` raises ``AuthorizationError``
    and ``articles_export`` returns an ``ApiResponse.failure`` envelope, neither
    of which is the 403 ``HTTPException`` the ``ensure_*`` helpers raise. Both
    read membership through the same ``public.is_project_member`` the RLS
    policies use, so the API and the database cannot drift apart.

    Accepts a raw ``user.sub`` and normalises it here, so a malformed subject
    raises from inside the membership check rather than ahead of it — which is
    where ``ProjectMemberRepository.is_member`` used to do the same conversion.
    """
    return await _project_role_allows(
        db,
        sql="SELECT public.is_project_member(:pid, :uid) AS ok",
        project_id=project_id,
        user_sub=UUID(user_sub) if isinstance(user_sub, str) else user_sub,
    )


async def ensure_project_member(db: DbSession, project_id: UUID, user_sub: UUID) -> None:
    """Enforce project-membership. Plain async helper (not a FastAPI dependency)
    so callers can pass a ``project_id`` from the request body — see
    hitl_sessions / extraction_runs."""
    await _ensure_project_role(
        db,
        sql="SELECT public.is_project_member(:pid, :uid) AS ok",
        project_id=project_id,
        user_sub=user_sub,
        error="Project access denied",
    )


async def ensure_project_reviewer(db: DbSession, project_id: UUID, user_sub: UUID) -> None:
    """Enforce a reviewer-capable role (manager / reviewer / consensus) — a
    read-only *viewer* is rejected. For reviewer-only write paths (mark-ready)."""
    await _ensure_project_role(
        db,
        sql="SELECT public.is_project_reviewer(:pid, :uid) AS ok",
        project_id=project_id,
        user_sub=user_sub,
        error="Reviewer role required",
    )


async def ensure_project_arbitrator(db: DbSession, project_id: UUID, user_sub: UUID) -> None:
    """Enforce an adjudicator role (manager / consensus) — the roles allowed to
    resolve consensus and finalize. For privileged write paths (approve-and-finalize),
    matching the frontend's ``canResolveConflicts`` and the spec's finalize rule."""
    await _ensure_project_role(
        db,
        sql="SELECT public.is_project_arbitrator(:pid, :uid) AS ok",
        project_id=project_id,
        user_sub=user_sub,
        error="Manager or consensus role required",
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

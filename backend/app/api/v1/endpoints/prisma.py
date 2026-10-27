"""PRISMA flow counts for a project, computed on read."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request

from app.api.deps.security import require_project_scope
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.prisma import PrismaCountsRead
from app.services.prisma_service import prisma_counts
from app.utils.rate_limiter import limiter

router = APIRouter()


@router.get("/projects/{project_id}/prisma")
@limiter.limit("60/minute")
async def get_prisma_counts(
    request: Request,
    project_id: UUID,
    db: DbSession,
    _user_sub: UUID = Depends(require_project_scope),
) -> ApiResponse[PrismaCountsRead]:
    counts = await prisma_counts(db, project_id)
    return ApiResponse.success(counts, trace_id=getattr(request.state, "trace_id", None))

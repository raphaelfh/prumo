"""Endpoint for the per-project parser-backend setting."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps.security import require_project_manager
from app.core.deps import DbSession
from app.schemas.common import ApiResponse
from app.schemas.parser_settings import ParserSettingsPayload, ParserSettingsRead
from app.services.parser_settings_service import (
    ParserSettingsService,
    ProjectNotFoundError,
)

router = APIRouter()


@router.put("/{project_id}/parser-settings")
async def set_parser_settings(
    project_id: UUID,
    body: ParserSettingsPayload,
    request: Request,
    db: DbSession,
    _manager: UUID = Depends(require_project_manager),
) -> ApiResponse[ParserSettingsRead]:
    trace_id = getattr(request.state, "trace_id", None)
    try:
        merged = await ParserSettingsService(db).set_for_project(
            project_id=project_id,
            parser_type=body.type,
        )
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    await db.commit()
    return ApiResponse.success(ParserSettingsRead(**merged), trace_id=trace_id)

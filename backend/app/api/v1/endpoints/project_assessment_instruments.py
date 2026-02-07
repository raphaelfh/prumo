"""
Project Assessment Instruments Endpoints.

Gerencia instrumentos de avaliação por projeto.
Permite clonar instrumentos globais (PROBAST, ROBIS) ou criar customizados.
"""

import uuid
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from app.core.deps import CurrentUser, DbSession
from app.core.logging import get_logger
from app.schemas.assessment import (
    CloneInstrumentRequest,
    CloneInstrumentResponse,
    ProjectAssessmentInstrumentCreate,
    ProjectAssessmentInstrumentSchema,
    ProjectAssessmentInstrumentUpdate,
    ProjectAssessmentItemCreate,
    ProjectAssessmentItemSchema,
    ProjectAssessmentItemUpdate,
)
from app.schemas.common import ApiResponse
from app.services.project_assessment_instrument_service import (
    ProjectAssessmentInstrumentService,
)
from app.utils.rate_limiter import limiter

router = APIRouter()
logger = get_logger(__name__)


@router.get(
    "/global",
    response_model=ApiResponse,
    summary="Listar instrumentos globais",
    description="Lista todos os instrumentos globais disponíveis para clonagem.",
)
@limiter.limit("30/minute")
async def list_global_instruments(
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse:
    """
    Lista instrumentos globais disponíveis (PROBAST, ROBIS, etc.).

    Retorna informações resumidas de cada instrumento para seleção.
    """
    trace_id = str(uuid.uuid4())

    service = ProjectAssessmentInstrumentService(
        db=db,
        user_id=user.sub,
        trace_id=trace_id,
    )

    instruments = await service.list_global_instruments()

    return ApiResponse(
        ok=True,
        data={"instruments": instruments},
        trace_id=trace_id,
    )


@router.get(
    "/project/{project_id}",
    response_model=ApiResponse,
    summary="Listar instrumentos do projeto",
    description="Lista todos os instrumentos configurados para um projeto.",
)
@limiter.limit("30/minute")
async def list_project_instruments(
    request: Request,
    project_id: UUID,
    db: DbSession,
    user: CurrentUser,
    active_only: bool = True,
) -> ApiResponse:
    """
    Lista instrumentos de um projeto.

    Args:
        project_id: ID do projeto.
        active_only: Se True, retorna apenas instrumentos ativos.
    """
    trace_id = str(uuid.uuid4())

    service = ProjectAssessmentInstrumentService(
        db=db,
        user_id=user.sub,
        trace_id=trace_id,
    )

    instruments = await service.list_project_instruments(
        project_id=project_id,
        active_only=active_only,
    )

    return ApiResponse(
        ok=True,
        data={"instruments": [i.model_dump(by_alias=True) for i in instruments]},
        trace_id=trace_id,
    )


@router.get(
    "/{instrument_id}",
    response_model=ApiResponse,
    summary="Buscar instrumento",
    description="Busca um instrumento por ID com todos os seus items.",
)
@limiter.limit("30/minute")
async def get_instrument(
    request: Request,
    instrument_id: UUID,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse:
    """
    Busca instrumento por ID com items.
    """
    trace_id = str(uuid.uuid4())

    service = ProjectAssessmentInstrumentService(
        db=db,
        user_id=user.sub,
        trace_id=trace_id,
    )

    instrument = await service.get_project_instrument(instrument_id)

    if not instrument:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instrument not found: {instrument_id}",
        )

    return ApiResponse(
        ok=True,
        data=instrument.model_dump(by_alias=True),
        trace_id=trace_id,
    )


@router.post(
    "/clone",
    response_model=ApiResponse,
    summary="Clonar instrumento global",
    description="Clona um instrumento global para um projeto específico.",
)
@limiter.limit("10/minute")
async def clone_global_instrument(
    request: Request,
    payload: CloneInstrumentRequest,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse:
    """
    Clona um instrumento global (PROBAST, ROBIS) para um projeto.

    Cria uma cópia completa com todos os items, permitindo
    customização posterior sem afetar o instrumento original.
    """
    trace_id = str(uuid.uuid4())

    logger.info(
        "clone_instrument_request",
        trace_id=trace_id,
        user_id=user.sub,
        project_id=str(payload.project_id),
        global_instrument_id=str(payload.global_instrument_id),
    )

    service = ProjectAssessmentInstrumentService(
        db=db,
        user_id=user.sub,
        trace_id=trace_id,
    )

    try:
        instrument = await service.clone_global_instrument(
            project_id=payload.project_id,
            global_instrument_id=payload.global_instrument_id,
            custom_name=payload.custom_name,
        )

        return ApiResponse(
            ok=True,
            data=CloneInstrumentResponse(
                project_instrument_id=instrument.id,
                message="Instrument cloned successfully",
            ).model_dump(by_alias=True),
            trace_id=trace_id,
        )

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except Exception as e:
        logger.error(
            "clone_instrument_error",
            trace_id=trace_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to clone instrument: {e}",
        )


@router.post(
    "",
    response_model=ApiResponse,
    summary="Criar instrumento customizado",
    description="Cria um novo instrumento customizado para um projeto.",
)
@limiter.limit("10/minute")
async def create_instrument(
    request: Request,
    payload: ProjectAssessmentInstrumentCreate,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse:
    """
    Cria um instrumento customizado.

    Permite criar instrumentos personalizados com items definidos
    pelo usuário, sem necessidade de clonar um instrumento global.
    """
    trace_id = str(uuid.uuid4())

    logger.info(
        "create_instrument_request",
        trace_id=trace_id,
        user_id=user.sub,
        project_id=str(payload.project_id),
        tool_type=payload.tool_type,
    )

    service = ProjectAssessmentInstrumentService(
        db=db,
        user_id=user.sub,
        trace_id=trace_id,
    )

    instrument = await service.create_custom_instrument(payload)

    return ApiResponse(
        ok=True,
        data=instrument.model_dump(by_alias=True),
        trace_id=trace_id,
    )


@router.patch(
    "/{instrument_id}",
    response_model=ApiResponse,
    summary="Atualizar instrumento",
    description="Atualiza um instrumento de projeto.",
)
@limiter.limit("20/minute")
async def update_instrument(
    request: Request,
    instrument_id: UUID,
    payload: ProjectAssessmentInstrumentUpdate,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse:
    """
    Atualiza um instrumento de projeto.
    """
    trace_id = str(uuid.uuid4())

    service = ProjectAssessmentInstrumentService(
        db=db,
        user_id=user.sub,
        trace_id=trace_id,
    )

    instrument = await service.update_instrument(instrument_id, payload)

    if not instrument:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instrument not found: {instrument_id}",
        )

    return ApiResponse(
        ok=True,
        data=instrument.model_dump(by_alias=True),
        trace_id=trace_id,
    )


@router.delete(
    "/{instrument_id}",
    response_model=ApiResponse,
    summary="Deletar instrumento",
    description="Deleta um instrumento de projeto.",
)
@limiter.limit("10/minute")
async def delete_instrument(
    request: Request,
    instrument_id: UUID,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse:
    """
    Deleta um instrumento de projeto.

    Remove o instrumento e todos os seus items.
    """
    trace_id = str(uuid.uuid4())

    service = ProjectAssessmentInstrumentService(
        db=db,
        user_id=user.sub,
        trace_id=trace_id,
    )

    deleted = await service.delete_instrument(instrument_id)

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instrument not found: {instrument_id}",
        )

    return ApiResponse(
        ok=True,
        data={"message": "Instrument deleted successfully"},
        trace_id=trace_id,
    )


# =================== ITEM ENDPOINTS ===================


@router.post(
    "/{instrument_id}/items",
    response_model=ApiResponse,
    summary="Adicionar item",
    description="Adiciona um item a um instrumento.",
)
@limiter.limit("20/minute")
async def add_item(
    request: Request,
    instrument_id: UUID,
    payload: ProjectAssessmentItemCreate,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse:
    """
    Adiciona um novo item a um instrumento.
    """
    trace_id = str(uuid.uuid4())

    service = ProjectAssessmentInstrumentService(
        db=db,
        user_id=user.sub,
        trace_id=trace_id,
    )

    item = await service.add_item(instrument_id, payload)

    return ApiResponse(
        ok=True,
        data=item.model_dump(by_alias=True),
        trace_id=trace_id,
    )


@router.patch(
    "/items/{item_id}",
    response_model=ApiResponse,
    summary="Atualizar item",
    description="Atualiza um item de instrumento.",
)
@limiter.limit("20/minute")
async def update_item(
    request: Request,
    item_id: UUID,
    payload: ProjectAssessmentItemUpdate,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse:
    """
    Atualiza um item de instrumento.
    """
    trace_id = str(uuid.uuid4())

    service = ProjectAssessmentInstrumentService(
        db=db,
        user_id=user.sub,
        trace_id=trace_id,
    )

    item = await service.update_item(item_id, payload)

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item not found: {item_id}",
        )

    return ApiResponse(
        ok=True,
        data=item.model_dump(by_alias=True),
        trace_id=trace_id,
    )


@router.delete(
    "/items/{item_id}",
    response_model=ApiResponse,
    summary="Deletar item",
    description="Deleta um item de instrumento.",
)
@limiter.limit("20/minute")
async def delete_item(
    request: Request,
    item_id: UUID,
    db: DbSession,
    user: CurrentUser,
) -> ApiResponse:
    """
    Deleta um item de instrumento.
    """
    trace_id = str(uuid.uuid4())

    service = ProjectAssessmentInstrumentService(
        db=db,
        user_id=user.sub,
        trace_id=trace_id,
    )

    deleted = await service.delete_item(item_id)

    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Item not found: {item_id}",
        )

    return ApiResponse(
        ok=True,
        data={"message": "Item deleted successfully"},
        trace_id=trace_id,
    )

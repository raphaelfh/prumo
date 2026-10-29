"""Request-scope resolution and binding, shared across endpoints.

``api.deps.security`` answers "may this caller act in this project". This
module answers the next question: "does the row this request names belong to
that project, and do the ids in the body belong together".

Two compositions live here because more than one endpoint needs each, and a
second copy is how two endpoints come to disagree:

``load_run_for_member`` — resolve a run or refuse (404 missing, 403
non-member). Used by the ten run-scoped endpoints and by the kickoff gate.

``load_assignment_for_member`` — the same shape for a screening assignment:
resolve it (404), then membership on its own project (403).

``assert_kickoff_scope`` — the (project, article, template, run) coordinate
an AI kickoff posts, bound before any work is queued; each branch ends in
``assert_ai_kickoff``.

``assert_ai_kickoff`` — THE per-article AI kickoff gate (role, then
credentials). The batch kickoff checks the role at its endpoint and runs the
same credential precheck inside ``ExtractionBatchService.start``, its one
start path.
"""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.security import ensure_project_member, ensure_project_reviewer
from app.schemas.extraction_run import RunSummaryResponse
from app.schemas.llm_target import LlmTarget
from app.schemas.screening import ScreeningAssignmentRef
from app.services import engine_credentials
from app.services.extraction_run_read_service import RunNotFoundError, get_run_or_raise
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    owned_template,
)
from app.services.screening_review_service import AssignmentNotFoundError, get_assignment_ref


async def load_run_for_member(db: AsyncSession, run_id: UUID, user_sub: UUID) -> RunSummaryResponse:
    """Load a Run by id, 404 when missing, 403 when the caller is not a member.

    THE run-resolution composition: the run-scoped endpoints and the AI
    kickoff gate below both need "resolve, or refuse", and a second copy is
    how the two would answer differently.

    Returns the schema, not the ORM type, so endpoint modules avoid importing
    ``app.models.*`` (see check_layered_arch).
    """
    try:
        run = await get_run_or_raise(db, run_id)
    except RunNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    await ensure_project_member(db, run.project_id, user_sub)
    return run


async def load_assignment_for_member(
    db: AsyncSession, assignment_id: UUID, user_sub: UUID
) -> ScreeningAssignmentRef:
    """Load a screening assignment by id, 404 when missing, 403 when the caller is not a member.

    THE assignment-resolution composition, shaped like ``load_run_for_member``:
    membership is checked on the assignment's own project, so there is no
    second client id to compare. Routes then check the role on ``ref.project_id``.
    """
    try:
        ref = await get_assignment_ref(db, assignment_id)
    except AssignmentNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Screening assignment not found"
        ) from exc
    await ensure_project_member(db, ref.project_id, user_sub)
    return ref


async def assert_ai_kickoff(
    db: AsyncSession, *, project_id: UUID, current_user_sub: UUID
) -> LlmTarget:
    """THE AI kickoff gate: reviewer role first (403), then the credential
    precheck (409), so a viewer or outsider never learns the project's engine
    configuration. Fails fast only: the worker re-resolves the engine at
    execution time."""
    await ensure_project_reviewer(db, project_id, current_user_sub)
    return await engine_credentials.assert_engine_ready(
        db, project_id=project_id, user_id=current_user_sub
    )


async def assert_kickoff_scope(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
    template_id: UUID,
    run_id: UUID | None,
    current_user_sub: UUID,
) -> LlmTarget:
    """Bind the request coordinate to the caller, before any work is queued,
    then run the AI kickoff gate on the bound project and return its engine.

    Membership comes first on the no-run branch. On the run branch the run
    must be resolved before there is a project to check membership against,
    so a caller who names a nonexistent run gets 404 either way — the run's
    id is the one thing that ordering does not hide. (Run ids are random
    uuid4, unlike the deterministic catalogue ids this gate exists for.)

    With a ``run_id`` the run IS the coordinate — it was created through
    ``create_run``, which already bound its article and template to its
    project — so the body must simply match it.

    Without one there is no run to bind to yet, so the template is bound to
    the project here. Skipping that check is not harmless even though the
    worker re-checks it: the worker runs after the 202, so the response code
    would vary with whether the rest of the body happened to be consistent —
    a cross-project oracle. Binding it here makes every foreign template
    answer 400 identically.
    """
    if run_id is None:
        await ensure_project_member(db, project_id, current_user_sub)
        try:
            await owned_template(db, project_id=project_id, template_id=template_id)
        except ProjectTemplateNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="templateId does not belong to projectId",
            ) from exc
        return await assert_ai_kickoff(db, project_id=project_id, current_user_sub=current_user_sub)

    run = await load_run_for_member(db, run_id, current_user_sub)
    if (
        project_id != run.project_id
        or article_id != run.article_id
        or template_id != run.template_id
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="runId does not match projectId, articleId, and templateId",
        )
    return await assert_ai_kickoff(db, project_id=run.project_id, current_user_sub=current_user_sub)

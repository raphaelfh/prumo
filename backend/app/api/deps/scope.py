"""Request-scope resolution and binding, shared across endpoints.

``api.deps.security`` answers "may this caller act in this project". This
module answers the next question: "does the row this request names belong to
that project, and do the ids in the body belong together".

Two compositions live here because more than one endpoint needs each, and a
second copy is how two endpoints come to disagree:

``load_run_for_member`` — resolve a run or refuse (404 missing, 403
non-member). Used by the ten run-scoped endpoints and by the kickoff gate.

``assert_kickoff_scope`` — the (project, article, template, run) coordinate
both AI kickoff endpoints post. It lived inline in ``/extraction/sections``
only, which is exactly how ``/extraction/models`` shipped without it.
"""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps.security import ensure_project_member
from app.schemas.extraction_run import RunSummaryResponse
from app.services.extraction_run_read_service import RunNotFoundError, get_run_or_raise
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    owned_template,
)


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


async def assert_kickoff_scope(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
    template_id: UUID,
    run_id: UUID | None,
    current_user_sub: UUID,
) -> None:
    """Bind the request coordinate to the caller, before any work is queued.

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
        return

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

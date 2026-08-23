"""Service: toggle the `is_active` flag on a project template, with the
single-active-extraction-template invariant baked in — and the shared
``deactivate_sibling_extraction_templates`` helper that clone, portable
import and Switch all use to keep that invariant on ONE write path.

Owns the multi-row read + update that the
`PATCH /projects/{id}/templates/{tid}` endpoint used to do inline, so the
endpoint module stops importing from `app.models.*`. Flushes only — the
endpoint commits, like every sibling handler in that router.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import ConflictError
from app.core.integrity import violates_constraint
from app.models.extraction import ProjectExtractionTemplate, TemplateKind
from app.schemas.hitl_session import UpdateTemplateActiveResponse


class ProjectTemplateNotFoundError(Exception):
    """Raised when the template_id does not resolve to a row in the project."""


SINGLE_ACTIVE_INDEX = "uq_one_active_extraction_template_per_project"
"""The partial unique index behind the single-active-extraction invariant."""


async def owned_template(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    kind: str | None = None,
    for_update: bool = False,
) -> ProjectExtractionTemplate:
    """The project template ``template_id`` of ``project_id`` — or 404.

    The BOLA guard every template-scoped service needs: a foreign or
    nonexistent id raises the same ``ProjectTemplateNotFoundError`` (no
    existence oracle). ``kind`` narrows to one lineage; ``for_update`` locks
    the row for callers whose guards must not race a concurrent writer.

    Ownership and kind are part of the WHERE clause, not a post-read check:
    ``FOR UPDATE`` locks only the rows the query returns, so a foreign
    template's row is never locked — not even for the instant before a 404.
    """
    stmt = select(ProjectExtractionTemplate).where(
        ProjectExtractionTemplate.id == template_id,
        ProjectExtractionTemplate.project_id == project_id,
    )
    if kind is not None:
        stmt = stmt.where(ProjectExtractionTemplate.kind == kind)
    if for_update:
        stmt = stmt.with_for_update()
    tpl = (await db.execute(stmt)).scalar_one_or_none()
    if tpl is None:
        raise ProjectTemplateNotFoundError(f"Project template {template_id} not found")
    return tpl


async def flush_activation(db: AsyncSession) -> None:
    """Flush a write that activates an extraction template.

    Two activations racing (two imports, an import and a Switch, two
    clones) both deactivate the sibling on a snapshot that never saw the
    winner; the loser's own activation then trips ``SINGLE_ACTIVE_INDEX``.
    That is a 409 the caller can retry, not a 500 — and nothing is written
    because the request session never commits.
    """
    try:
        await db.flush()
    except IntegrityError as exc:
        if violates_constraint(exc, SINGLE_ACTIVE_INDEX):
            raise ConflictError("Another template was activated at the same time; retry.") from exc
        raise


class LastActiveExtractionTemplateError(Exception):
    """Raised when disabling an extraction template would leave the project with
    zero active extraction templates. The extraction workflow assumes at least
    one active template at all times; QA has no such constraint."""


async def deactivate_sibling_extraction_templates(
    db: AsyncSession,
    *,
    project_id: UUID,
    keep_active_id: UUID | None,
) -> None:
    """Deactivate the project's active EXTRACTION templates.

    ``keep_active_id`` is excluded from the update (idempotent re-import of
    the same clone; activating a template that is already active). ``None``
    deactivates every active extraction template — used right before
    inserting a brand-new one whose id is not known yet.

    Shared by clone, portable import, and ``set_template_active`` so the
    single-active invariant (`uq_one_active_extraction_template_per_project`)
    has exactly one write path. Kind-scoped: QA templates may coexist.
    """
    stmt = (
        update(ProjectExtractionTemplate)
        .where(
            ProjectExtractionTemplate.project_id == project_id,
            ProjectExtractionTemplate.kind == TemplateKind.EXTRACTION.value,
            ProjectExtractionTemplate.is_active.is_(True),
        )
        .values(is_active=False)
    )
    if keep_active_id is not None:
        stmt = stmt.where(ProjectExtractionTemplate.id != keep_active_id)
    await db.execute(stmt)


async def set_template_active(
    db: AsyncSession,
    *,
    project_id: UUID,
    template_id: UUID,
    is_active: bool,
) -> UpdateTemplateActiveResponse:
    """Flip the `is_active` flag on a project template.

    Enforces: an extraction template cannot be deactivated if it is the
    project's only active extraction template (the extraction workflow
    requires exactly one). QA templates are independent — disabling the
    last QA template just means the project chose not to run any QA tool.
    """
    tpl = await owned_template(db, project_id=project_id, template_id=template_id)

    if tpl.kind == TemplateKind.EXTRACTION.value and is_active is False:
        siblings_stmt = select(ProjectExtractionTemplate).where(
            ProjectExtractionTemplate.project_id == project_id,
            ProjectExtractionTemplate.kind == TemplateKind.EXTRACTION.value,
            ProjectExtractionTemplate.is_active.is_(True),
            ProjectExtractionTemplate.id != template_id,
        )
        other_active = (await db.execute(siblings_stmt)).scalars().first()
        if other_active is None:
            raise LastActiveExtractionTemplateError(
                "Cannot disable the only active extraction template for "
                "this project; import another extraction template first."
            )

    if tpl.kind == TemplateKind.EXTRACTION.value and is_active:
        # Switch: the partial unique index forbids two active extraction
        # templates, so the sibling goes first (spec §5.6). keep_active_id
        # makes this a no-op when the template is already active.
        await deactivate_sibling_extraction_templates(
            db, project_id=project_id, keep_active_id=template_id
        )

    tpl.is_active = is_active
    await flush_activation(db)
    return UpdateTemplateActiveResponse(
        project_template_id=tpl.id,
        is_active=tpl.is_active,
    )

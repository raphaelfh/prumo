"""ACTIVE-version reads for a project template (track B).

* B-3a: the worklist, the dashboard and the exports render template
  structure from the ACTIVE snapshot, not live rows — under B-4 an
  unpublished draft edit must not move progress numbers project-wide.
  The tree comes from B-2's shared provider, so the narrow/heterogeneous
  snapshot -> live fallback chain is inherited, not re-implemented.
* B-4: the Configuration tab's Draft chip reads
  ``get_template_config_status`` (marker + active version number).
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ProjectExtractionTemplate
from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.schemas.hitl_session import TemplateActiveVersionRead, TemplateConfigStatusRead
from app.services.extraction_snapshot import entity_types_for_version
from app.services.project_template_active_service import ProjectTemplateNotFoundError


class NoActiveTemplateVersionError(Exception):
    """The template exists but has no active version to render from."""


async def get_template_config_status(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateConfigStatusRead:
    """Draft chip read model (B-4), BOLA-scoped by (id, project_id).

    ``active_version`` is None only for a template that never published
    (legacy shapes) — unlike the tree read above, that is a renderable
    status here, not an error.
    """
    template = await db.get(ProjectExtractionTemplate, template_id)
    if template is None or template.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")

    active = await ExtractionTemplateVersionRepository(db).get_active(template_id)
    return TemplateConfigStatusRead(
        project_template_id=template.id,
        has_pending_changes=template.config_draft_since is not None,
        active_version=active.version if active is not None else None,
    )


async def get_active_version_tree(
    db: AsyncSession, *, project_id: UUID, template_id: UUID
) -> TemplateActiveVersionRead:
    """Active-version tree, BOLA-scoped by (id, project_id).

    Raises ``ProjectTemplateNotFoundError`` (-> 404) for a foreign or
    missing template and ``NoActiveTemplateVersionError`` (-> 404) when
    no active version exists — NEVER an empty tree, which the worklist
    would compute as 100 % complete.
    """
    template = await db.get(ProjectExtractionTemplate, template_id)
    if template is None or template.project_id != project_id:
        raise ProjectTemplateNotFoundError(f"Template {template_id} not found")

    active = await ExtractionTemplateVersionRepository(db).get_active(template_id)
    if active is None:
        raise NoActiveTemplateVersionError(
            f"Project template {template_id} has no active version. "
            "Publish the template configuration first."
        )

    entity_types = await entity_types_for_version(db, version_id=active.id, template_id=template_id)
    return TemplateActiveVersionRead(
        version_id=active.id,
        version=active.version,
        entity_types=entity_types,
    )

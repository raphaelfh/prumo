# backend/app/services/template_create_service.py
"""Create a project extraction template that starts with no sections.

The manager names it here and builds the tree afterwards in the
configuration editor — the "start from scratch" counterpart to cloning a
catalogue template or importing a ``prumo-template@1`` file.

Why this cannot be a client-side insert: two DB invariants have to hold at
COMMIT, and a single PostgREST insert can satisfy neither. The deferred
constraint trigger ``project_extraction_templates_active_version`` (0004)
requires an active ``extraction_template_versions`` row by COMMIT, and
``uq_one_active_extraction_template_per_project`` (0014) refuses a second
active extraction template for the project. So creation stays here, where
the sibling deactivation and the v1 publish land in the caller's single
transaction.

Only the tail of the portable import (spec §5.2): the shared sibling
deactivation and the one publish path. There is no document to parse and no
tree to build, which is the whole point — the template starts empty.
"""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ProjectExtractionTemplate
from app.models.extraction_versioning import TemplateKind
from app.schemas.extraction import Framework
from app.schemas.hitl_session import CloneTemplateResponse
from app.services.project_template_active_service import (
    deactivate_sibling_extraction_templates,
    flush_activation,
)
from app.services.template_version_service import TemplateVersionService


async def create_blank_template(
    db: AsyncSession,
    *,
    project_id: UUID,
    name: str,
    description: str | None,
    framework: Framework,
    user_id: UUID,
) -> CloneTemplateResponse:
    """Create a NEW active project template with no sections and publish v1.

    Runs inside the caller's transaction; the caller commits. A concurrent
    activation surfaces as the ``ConflictError`` ``flush_activation`` raises.
    """
    await deactivate_sibling_extraction_templates(db, project_id=project_id, keep_active_id=None)

    tpl = ProjectExtractionTemplate(
        id=uuid4(),
        project_id=project_id,
        global_template_id=None,
        name=name,
        description=description,
        framework=framework,
        version="1.0.0",
        kind=TemplateKind.EXTRACTION.value,
        schema_={},
        is_active=True,
        created_by=user_id,
    )
    db.add(tpl)
    await flush_activation(db)

    # Publish v1 through the one publish path, exactly as the import does:
    # the empty tree IS the recorded intent, so the manager opens the editor
    # on a published template rather than a permanent draft.
    republished = await TemplateVersionService(db).republish(
        project_id=project_id, project_template_id=tpl.id, user_id=user_id
    )
    return CloneTemplateResponse(
        project_template_id=tpl.id,
        version_id=republished.version_id,
        entity_type_count=0,
        field_count=0,
        created=True,
    )

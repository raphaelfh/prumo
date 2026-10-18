"""Read-only project data for the researcher MCP tools (task 6a).

A new module, not an addition to an existing service, because the existing
repositories have no article counts and no per-template published/narrow
summary — this module composes them, without writing anything. The caller's
role always comes from `ProjectMemberRepository`: `list_for_user` for the
`list_projects` tool (its own memberships, no second membership check) and
`get_member` for `get_project` (the `is_run_arbitrator` precedent — the MCP
choke point already proved membership before the tool runs, so this is the
role lookup, not a second guard).
"""

from __future__ import annotations

from typing import cast
from uuid import UUID

from sqlalchemy import and_, exists, func, outerjoin, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import NotFoundError
from app.models.article import Article, ArticleFile
from app.models.extraction import ProjectExtractionTemplate
from app.models.extraction_versioning import ExtractionTemplateVersion
from app.models.project import Project
from app.repositories.project_repository import ProjectMemberRepository
from app.schemas.mcp_projects import (
    McpProjectCounts,
    McpProjectListItem,
    McpProjectOverview,
    McpTemplateSummary,
    ProjectRoleValue,
)
from app.schemas.project_details import ProjectDetailsValues
from app.services.extraction_snapshot import snapshot_is_narrow

__all__ = ["get_project_overview", "list_projects_for_user", "project_name", "template_summaries"]


async def list_projects_for_user(
    db: AsyncSession, *, user_id: UUID, project_ids: frozenset[UUID] | None = None
) -> list[McpProjectListItem]:
    members = await ProjectMemberRepository(db).list_for_user(user_id, project_ids=project_ids)
    return [
        McpProjectListItem(
            project_id=m.project_id,
            name=m.project.name,
            role=cast(ProjectRoleValue, m.role),
            is_active=m.project.is_active,
        )
        for m in members
    ]


async def project_name(db: AsyncSession, project_id: UUID) -> str:
    """The project's display name, for MCP results and post-membership refusals.

    Callers MUST have proven membership first (the MCP dispatch choke point
    does); this is not an ownership guard and must never answer an
    unauthenticated or non-member request. A project deleted mid-call raises
    `NotFoundError` (NOT_FOUND at the MCP layer)."""
    name = (
        await db.execute(select(Project.name).where(Project.id == project_id))
    ).scalar_one_or_none()
    if name is None:
        raise NotFoundError("Project", str(project_id))
    return name


async def get_project_overview(
    db: AsyncSession, *, project_id: UUID, user_id: UUID
) -> McpProjectOverview | None:
    project = await db.get(Project, project_id)
    member = await ProjectMemberRepository(db).get_member(project_id, user_id)
    if project is None or member is None:
        return None  # removed after the choke point already proved membership

    details = ProjectDetailsValues.model_validate(
        {field: getattr(project, field) for field in ProjectDetailsValues.model_fields}
    )

    parsed_exists = exists(
        select(1).where(
            ArticleFile.article_id == Article.id, ArticleFile.extraction_status == "parsed"
        )
    )
    counts_row = (
        await db.execute(
            select(func.count(Article.id), func.count(Article.id).filter(parsed_exists)).where(
                Article.project_id == project_id
            )
        )
    ).one()

    return McpProjectOverview(
        project_id=project_id,
        role=cast(ProjectRoleValue, member.role),
        is_active=project.is_active,
        details=details,
        protocol_revision=project.protocol_revision,
        counts=McpProjectCounts(articles=counts_row[0], articles_with_text=counts_row[1]),
        templates=await template_summaries(db, project_id=project_id),
    )


async def template_summaries(db: AsyncSession, *, project_id: UUID) -> list[McpTemplateSummary]:
    join = outerjoin(
        ProjectExtractionTemplate,
        ExtractionTemplateVersion,
        and_(
            ExtractionTemplateVersion.project_template_id == ProjectExtractionTemplate.id,
            ExtractionTemplateVersion.is_active.is_(True),
        ),
    )
    rows = (
        await db.execute(
            select(ProjectExtractionTemplate, ExtractionTemplateVersion)
            .select_from(join)
            .where(ProjectExtractionTemplate.project_id == project_id)
            .order_by(ProjectExtractionTemplate.name, ProjectExtractionTemplate.id)
        )
    ).all()

    summaries: list[McpTemplateSummary] = []
    for template, version in rows:
        narrow = (
            snapshot_is_narrow((version.schema_ or {}).get("entity_types") or [])
            if version is not None
            else None
        )
        summaries.append(
            McpTemplateSummary(
                template_id=template.id,
                name=template.name,
                kind=template.kind,
                instrument=template.instrument,
                is_active=template.is_active,
                published_version=version.version if version is not None else None,
                narrow=narrow,
            )
        )
    return summaries

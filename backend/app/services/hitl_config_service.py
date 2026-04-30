"""HITL configuration management service.

Handles two flows:

* :meth:`HitlConfigService.resolve_snapshot` — read-only lookup used at
  Run creation. Resolution order: template-scoped > project-scoped >
  system default.
* :meth:`HitlConfigService.get_resolved` /
  :meth:`HitlConfigService.upsert` / :meth:`HitlConfigService.clear` —
  CRUD used by the Project Settings UI to manage either scope.
"""

from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction_versioning import (
    ExtractionHitlConfig,
    HitlConfigScopeKind,
)
from app.repositories.hitl_config_repository import HitlConfigRepository

SYSTEM_DEFAULT_HITL_CONFIG: dict[str, Any] = {
    "scope_kind": "system_default",
    "reviewer_count": 1,
    "consensus_rule": "unanimous",
    "arbitrator_id": None,
}


class HitlConfigError(Exception):
    """Base error for HITL config operations."""


class ProjectTemplateNotFoundError(HitlConfigError):
    """Raised when a template scope id does not match any project template."""


class TemplateProjectMismatchError(HitlConfigError):
    """Raised when a template does not belong to the requested project."""


class ArbitratorNotProjectMemberError(HitlConfigError):
    """Raised when an arbitrator candidate is not a member of the project.

    The DB cannot enforce this on its own because ``arbitrator_id`` only
    points at ``profiles.id``; project membership lives in
    ``project_members``.
    """


class HitlConfigService:
    """Resolves and manages HITL config for projects + templates."""

    def __init__(self, db: AsyncSession):
        self._db = db
        self._repo = HitlConfigRepository(db)

    # ------------------------------------------------------------------
    # Run-snapshot resolution (used at Run creation; no provenance flag)
    # ------------------------------------------------------------------
    async def resolve_snapshot(
        self,
        project_id: UUID,
        project_template_id: UUID,
    ) -> dict[str, Any]:
        """Return the resolved HITL config as a JSON-serializable snapshot."""
        template_config = await self._repo.get_by_scope(
            HitlConfigScopeKind.TEMPLATE,
            project_template_id,
        )
        if template_config is not None:
            return self._to_snapshot(template_config)

        project_config = await self._repo.get_by_scope(
            HitlConfigScopeKind.PROJECT,
            project_id,
        )
        if project_config is not None:
            return self._to_snapshot(project_config)

        return SYSTEM_DEFAULT_HITL_CONFIG.copy()

    # ------------------------------------------------------------------
    # CRUD for the Project Settings UI
    # ------------------------------------------------------------------
    async def get_for_project(self, project_id: UUID) -> dict[str, Any]:
        """Return the project-scoped config, falling back to system default."""
        project_config = await self._repo.get_by_scope(HitlConfigScopeKind.PROJECT, project_id)
        if project_config is not None:
            snap = self._to_snapshot(project_config)
            snap["inherited"] = False
            return snap
        snap = SYSTEM_DEFAULT_HITL_CONFIG.copy()
        snap["inherited"] = True
        return snap

    async def get_for_template(
        self,
        project_id: UUID,
        project_template_id: UUID,
    ) -> dict[str, Any]:
        """Return the template-scoped config, falling back to project then default.

        The ``inherited`` flag is true when no template-specific row exists.
        """
        await self._ensure_template_in_project(project_id, project_template_id)

        template_config = await self._repo.get_by_scope(
            HitlConfigScopeKind.TEMPLATE, project_template_id
        )
        if template_config is not None:
            snap = self._to_snapshot(template_config)
            snap["inherited"] = False
            return snap

        # Fall back to the project default (or system default).
        project_config = await self._repo.get_by_scope(HitlConfigScopeKind.PROJECT, project_id)
        if project_config is not None:
            snap = self._to_snapshot(project_config)
            snap["inherited"] = True
            return snap

        snap = SYSTEM_DEFAULT_HITL_CONFIG.copy()
        snap["inherited"] = True
        return snap

    async def upsert_for_project(
        self,
        project_id: UUID,
        reviewer_count: int,
        consensus_rule: str,
        arbitrator_id: UUID | None,
    ) -> dict[str, Any]:
        if arbitrator_id is not None:
            await self._ensure_arbitrator_in_project(project_id, arbitrator_id)
        config = await self._repo.upsert(
            HitlConfigScopeKind.PROJECT,
            project_id,
            reviewer_count,
            consensus_rule,
            arbitrator_id,
        )
        snap = self._to_snapshot(config)
        snap["inherited"] = False
        return snap

    async def upsert_for_template(
        self,
        project_id: UUID,
        project_template_id: UUID,
        reviewer_count: int,
        consensus_rule: str,
        arbitrator_id: UUID | None,
    ) -> dict[str, Any]:
        await self._ensure_template_in_project(project_id, project_template_id)
        if arbitrator_id is not None:
            await self._ensure_arbitrator_in_project(project_id, arbitrator_id)

        config = await self._repo.upsert(
            HitlConfigScopeKind.TEMPLATE,
            project_template_id,
            reviewer_count,
            consensus_rule,
            arbitrator_id,
        )
        snap = self._to_snapshot(config)
        snap["inherited"] = False
        return snap

    async def clear_for_project(self, project_id: UUID) -> dict[str, Any]:
        await self._repo.delete_by_scope(HitlConfigScopeKind.PROJECT, project_id)
        return await self.get_for_project(project_id)

    async def clear_for_template(
        self, project_id: UUID, project_template_id: UUID
    ) -> dict[str, Any]:
        await self._ensure_template_in_project(project_id, project_template_id)
        await self._repo.delete_by_scope(HitlConfigScopeKind.TEMPLATE, project_template_id)
        return await self.get_for_template(project_id, project_template_id)

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    async def _ensure_template_in_project(
        self,
        project_id: UUID,
        project_template_id: UUID,
    ) -> None:
        result = await self._db.execute(
            text(
                """
                SELECT project_id
                FROM public.project_extraction_templates
                WHERE id = :tid
                """
            ),
            {"tid": str(project_template_id)},
        )
        row = result.first()
        if row is None:
            raise ProjectTemplateNotFoundError(f"Project template {project_template_id} not found")
        if row[0] != project_id:
            raise TemplateProjectMismatchError(
                "Project template does not belong to the requested project"
            )

    async def _ensure_arbitrator_in_project(
        self,
        project_id: UUID,
        arbitrator_id: UUID,
    ) -> None:
        result = await self._db.execute(
            text(
                """
                SELECT 1
                FROM public.project_members
                WHERE project_id = :pid AND user_id = :uid
                """
            ),
            {"pid": str(project_id), "uid": str(arbitrator_id)},
        )
        if result.first() is None:
            raise ArbitratorNotProjectMemberError(
                f"Arbitrator {arbitrator_id} is not a member of project {project_id}"
            )

    @staticmethod
    def _to_snapshot(config: ExtractionHitlConfig) -> dict[str, Any]:
        return {
            "scope_kind": config.scope_kind,
            "scope_id": str(config.scope_id),
            "reviewer_count": config.reviewer_count,
            "consensus_rule": config.consensus_rule,
            "arbitrator_id": (str(config.arbitrator_id) if config.arbitrator_id else None),
        }

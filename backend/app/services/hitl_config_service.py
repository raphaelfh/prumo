"""Resolve HITL configuration into a snapshot for a Run.

Resolution order: template-scoped > project-scoped > system default.
"""

from typing import Any
from uuid import UUID

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


class HitlConfigService:
    """Resolves HITL config for a Run + produces snapshot dict."""

    def __init__(self, db: AsyncSession):
        self._repo = HitlConfigRepository(db)

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

    @staticmethod
    def _to_snapshot(config: ExtractionHitlConfig) -> dict[str, Any]:
        return {
            "scope_kind": config.scope_kind,
            "scope_id": str(config.scope_id),
            "reviewer_count": config.reviewer_count,
            "consensus_rule": config.consensus_rule,
            "arbitrator_id": (
                str(config.arbitrator_id) if config.arbitrator_id else None
            ),
        }

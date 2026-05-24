"""Extraction Export Service.

Orchestrator for the extraction `.xlsx` download feature
(009-extraction-excel-export). Resolves the in-memory ``ExportLayout``
(data-model.md §2) and hands bytes-production off to the pure builder
in ``app.services.exports.extraction_xlsx_builder``.

Architectural notes:
* Layered per constitution §I: this service only orchestrates; SQL goes
  through repositories and direct ``select()`` statements that respect
  RLS via the injected ``AsyncSession``. No HTTP types cross the
  boundary.
* Bulk reads only — no per-cell N+1. Every value-map builder issues at
  most a fixed small number of queries regardless of article count.
* The Single-user and All-users branches are not in V1 (US1 = consensus
  only). The resolver dispatches on ``mode`` and raises
  ``NotImplementedError`` for the other branches until US2/US3 ship.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.error_handler import AppError, AuthorizationError, NotFoundError
from app.core.logging import LoggerMixin
from app.infrastructure.storage.base import StorageAdapter
from app.models.article import Article
from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityRole,
    ExtractionEntityType,
    ExtractionField,
    ExtractionFieldType,
    ExtractionInstance,
    ExtractionRun,
    ExtractionRunStage,
    ProjectExtractionTemplate,
)
from app.models.extraction_workflow import ExtractionPublishedState
from app.models.project import ProjectMemberRole
from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.repositories.project_repository import ProjectMemberRepository, ProjectRepository

# ----------------------------------------------------------------------
# Enums
# ----------------------------------------------------------------------


class ExportMode(StrEnum):
    """Value-source mode for the export."""

    CONSENSUS = "consensus"
    SINGLE_USER = "single_user"
    ALL_USERS = "all_users"


# ----------------------------------------------------------------------
# In-memory layout descriptors — see data-model.md §2.
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class FieldDescriptor:
    """One field within an entity_type (= one row on the main sheet)."""

    field_id: UUID
    label: str
    type: ExtractionFieldType
    allowed_values: tuple[str, ...]
    parent_section_id: UUID


@dataclass(frozen=True)
class SectionDescriptor:
    """One section (entity_type) — drives section header + field rows.

    Sections are emitted to the sheet in the order they appear in
    ``layout.sections``; the builder uses ``role`` to decide whether to
    repeat values across model sub-columns (FR-010).
    """

    entity_type_id: UUID
    label: str
    role: ExtractionEntityRole
    parent_entity_type_id: UUID | None
    fields: tuple[FieldDescriptor, ...]


@dataclass(frozen=True)
class ArticleDescriptor:
    """One article column (or N adjacent columns when multi-instance)."""

    article_id: UUID
    header_label: str
    run_id: UUID | None
    run_stage: ExtractionRunStage | None
    # Ordered model_section instance ids; empty when the template has no
    # model_container OR when the article has zero model instances.
    model_instances: tuple[UUID, ...]
    # entity_type_id (study_section) → instance_id; one entry per
    # study_section the run has materialised.
    study_instances: dict[UUID, UUID]


@dataclass(frozen=True)
class ReviewerDescriptor:
    """One reviewer column in All-users mode."""

    reviewer_id: UUID
    display_label: str


@dataclass
class ExportNotes:
    """Per-run audit info written to the ``Notes`` sheet."""

    omitted_articles_by_stage: dict[str, int] = field(default_factory=dict)
    obsolete_fields_per_article: dict[UUID, list[str]] = field(default_factory=dict)
    template_version_label: str = ""
    export_mode_label: str = ""
    anonymize_reviewer_names: bool = False
    include_ai_metadata: bool = False
    generated_at: datetime | None = None


@dataclass(frozen=True)
class AIProposalRow:
    """One row on the optional ``AI metadata`` sheet (FR-037).

    Field order matches the sheet's column order; the builder writes
    ``tuple(row)`` directly via ``dataclasses.astuple`` so the two
    contracts stay in lockstep.
    """

    article_label: str
    section_label: str
    instance_index: int  # 1-based: 1 for cardinality=one; 1..N for model instances
    field_label: str
    ai_proposed_value: Any
    confidence: float | None
    rationale: str | None
    evidence_text: str  # joined with ' | ' when multiple
    evidence_pages: str  # joined with ', ' when multiple
    proposed_at: datetime
    reviewer_outcome: str  # accepted | rejected | edited (best-effort) | pending | superseded
    final_value_used: Any  # None when not published


@dataclass(frozen=True)
class ExportLayout:
    """Fully-resolved input for the XLSX builder."""

    project_name: str
    template_name: str
    template_version: int
    sections: tuple[SectionDescriptor, ...]
    articles: tuple[ArticleDescriptor, ...]
    reviewers: tuple[ReviewerDescriptor, ...]
    mode: ExportMode
    include_ai_metadata: bool
    anonymize_reviewer_names: bool
    notes: ExportNotes
    # Value resolution: Consensus / Single-user key is
    # ``(run_id, instance_id, field_id) -> Any``; All-users key adds
    # ``reviewer_id`` (None for the consensus sub-column).
    value_map: dict[tuple[Any, ...], Any]
    # Populated only when ``include_ai_metadata`` is True (FR-036+).
    ai_proposal_rows: tuple[AIProposalRow, ...] = ()


# ----------------------------------------------------------------------
# Service
# ----------------------------------------------------------------------


_FILENAME_SANITISE_RE = re.compile(r"[^A-Za-z0-9._-]+")


class ExtractionExportService(LoggerMixin):
    """Orchestrates an extraction `.xlsx` export request."""

    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        storage: StorageAdapter,
        trace_id: str | None = None,
    ) -> None:
        self.db = db
        self.user_id = user_id
        self.storage = storage
        self.trace_id = trace_id or ""

    # ------------------------------------------------------------------
    # Repositories
    # ------------------------------------------------------------------

    def _project_members_repo(self) -> ProjectMemberRepository:
        return ProjectMemberRepository(self.db)

    def _projects_repo(self) -> ProjectRepository:
        return ProjectRepository(self.db)

    def _template_versions_repo(self) -> ExtractionTemplateVersionRepository:
        return ExtractionTemplateVersionRepository(self.db)

    # ------------------------------------------------------------------
    # Public API — auth
    # ------------------------------------------------------------------

    async def assert_can_export(
        self,
        project_id: UUID,
        mode: ExportMode,
        target_reviewer_id: UUID | None,
    ) -> None:
        """Membership + manager gate for the requested export (FR-003 / FR-004)."""
        repo = self._project_members_repo()
        try:
            caller_id = UUID(self.user_id)
        except (TypeError, ValueError) as exc:
            raise AuthorizationError("Invalid user id on token.") from exc

        is_member = await repo.is_member(project_id, caller_id)
        if not is_member:
            raise AuthorizationError("User is not a member of this project.")

        requires_manager = mode is ExportMode.ALL_USERS or (
            mode is ExportMode.SINGLE_USER
            and target_reviewer_id is not None
            and target_reviewer_id != caller_id
        )
        if requires_manager:
            is_manager = await repo.has_role(project_id, caller_id, ProjectMemberRole.MANAGER)
            if not is_manager:
                raise AuthorizationError(
                    "Only project managers can export other reviewers' "
                    "decisions or use 'All users' mode."
                )

    # ------------------------------------------------------------------
    # Public API — resolve_layout
    # ------------------------------------------------------------------

    async def resolve_layout(
        self,
        *,
        project_id: UUID,
        template_id: UUID,
        mode: ExportMode,
        article_ids: list[UUID],
        include_ai_metadata: bool,
        anonymize_reviewer_names: bool,
        reviewer_id: UUID | None = None,  # noqa: ARG002 — used in US2
    ) -> ExportLayout:
        """Build the in-memory layout for an export request.

        US1 covers the Consensus branch. The Single-user and All-users
        branches raise NotImplementedError until US2/US3 implement them.
        """
        template, version = await self._load_active_template_version(template_id)
        project_name = await self._resolve_project_name(project_id)
        sections = await self._load_sections(template_id)

        reviewers: tuple[ReviewerDescriptor, ...] = ()

        if mode is ExportMode.CONSENSUS:
            articles, omitted = await self._resolve_articles_for_consensus(
                template_id=template_id,
                project_id=project_id,
                candidate_ids=article_ids,
            )
            value_map = await self._build_consensus_value_map(
                run_ids=[a.run_id for a in articles if a.run_id is not None]
            )
        elif mode is ExportMode.SINGLE_USER:
            if reviewer_id is None:
                raise NotFoundError("reviewer_id is required when mode=single_user.")
            articles, omitted = await self._resolve_articles_for_single_user(
                template_id=template_id,
                project_id=project_id,
                candidate_ids=article_ids,
                reviewer_id=reviewer_id,
            )
            value_map = await self._build_single_user_value_map(
                run_ids=[a.run_id for a in articles if a.run_id is not None],
                reviewer_id=reviewer_id,
            )
        elif mode is ExportMode.ALL_USERS:
            articles, omitted = await self._resolve_articles_for_all_users(
                template_id=template_id,
                project_id=project_id,
                candidate_ids=article_ids,
            )
            reviewers = await self._list_reviewers_for_runs(
                run_ids=[a.run_id for a in articles if a.run_id is not None],
                anonymize=anonymize_reviewer_names,
            )
            value_map = await self._build_all_users_value_map(
                run_ids=[a.run_id for a in articles if a.run_id is not None],
                reviewer_ids=[r.reviewer_id for r in reviewers],
            )
        else:
            raise NotImplementedError(f"resolve_layout: unknown mode={mode.value}.")

        notes = ExportNotes(
            omitted_articles_by_stage=omitted,
            template_version_label=f"{template.name} v{version.version}",
            export_mode_label=mode.value,
            anonymize_reviewer_names=anonymize_reviewer_names,
            include_ai_metadata=include_ai_metadata,
            generated_at=datetime.now(UTC),
        )

        ai_rows: tuple[AIProposalRow, ...] = ()
        if include_ai_metadata:
            ai_rows = await self._load_ai_proposal_rows(
                articles=tuple(articles),
                sections=sections,
                value_map=value_map,
                mode=mode,
            )

        return ExportLayout(
            project_name=project_name,
            template_name=template.name,
            template_version=version.version,
            sections=sections,
            articles=tuple(articles),
            reviewers=reviewers,
            mode=mode,
            include_ai_metadata=include_ai_metadata,
            anonymize_reviewer_names=anonymize_reviewer_names,
            notes=notes,
            value_map=value_map,
            ai_proposal_rows=ai_rows,
        )

    # ------------------------------------------------------------------
    # Filename helper (FR-024)
    # ------------------------------------------------------------------

    @staticmethod
    def format_filename(
        project_name: str,
        template_name: str,
        mode: ExportMode,
        *,
        generated_at: datetime | None = None,
    ) -> str:
        """Return ``{project}_{template}_{mode}_{YYYYMMDD-HHMMSS}.xlsx``.

        All non-filename-safe characters are collapsed to ``_``. The
        timestamp is in UTC — predictable for logs/audit; the dialog's
        live-preview line displays the local-timezone equivalent.
        """
        ts = (generated_at or datetime.now(UTC)).strftime("%Y%m%d-%H%M%S")
        parts = [
            _FILENAME_SANITISE_RE.sub("_", project_name).strip("_") or "project",
            _FILENAME_SANITISE_RE.sub("_", template_name).strip("_") or "template",
            mode.value,
            ts,
        ]
        return f"{'_'.join(parts)}.xlsx"

    # ==================================================================
    # Internal helpers — layout assembly
    # ==================================================================

    async def _resolve_project_name(self, project_id: UUID) -> str:
        """Best-effort project name for the export filename.

        Falls back to the project id's first segment when the project
        row has no name set — never raises, because filename formatting
        runs after authorization has already confirmed the project
        exists and the caller can access it.
        """
        project = await self._projects_repo().get_by_id(project_id)
        if project is not None and project.name:
            return str(project.name)
        return str(project_id).split("-", 1)[0]

    async def _load_active_template_version(
        self,
        template_id: UUID,
    ) -> tuple[ProjectExtractionTemplate, Any]:
        """Load the project template + its currently-active version row."""
        template = (
            await self.db.execute(
                select(ProjectExtractionTemplate).where(ProjectExtractionTemplate.id == template_id)
            )
        ).scalar_one_or_none()
        if template is None:
            raise NotFoundError(f"Project template {template_id} not found.")

        version = await self._template_versions_repo().get_active(template_id)
        if version is None:
            raise NotFoundError(
                f"Project template {template_id} has no active version. "
                "Configure the template before exporting."
            )
        return template, version

    async def _load_sections(
        self,
        template_id: UUID,
    ) -> tuple[SectionDescriptor, ...]:
        """Load entity types + fields for the active template, in display order.

        Strategy:
          1. One query for entity types — eager-loaded in a single round-trip.
          2. One query for fields belonging to those entity types.
          3. Stitch them into ``SectionDescriptor`` tuples in stable sort
             order (entity_type.sort_order, then field.sort_order).
        """
        entity_rows = (
            (
                await self.db.execute(
                    select(ExtractionEntityType)
                    .where(ExtractionEntityType.project_template_id == template_id)
                    .order_by(ExtractionEntityType.sort_order, ExtractionEntityType.id)
                )
            )
            .scalars()
            .all()
        )

        if not entity_rows:
            return ()

        entity_ids = [e.id for e in entity_rows]
        field_rows = (
            (
                await self.db.execute(
                    select(ExtractionField)
                    .where(ExtractionField.entity_type_id.in_(entity_ids))
                    .order_by(ExtractionField.sort_order, ExtractionField.id)
                )
            )
            .scalars()
            .all()
        )

        fields_by_section: dict[UUID, list[FieldDescriptor]] = {}
        for f in field_rows:
            fields_by_section.setdefault(f.entity_type_id, []).append(
                FieldDescriptor(
                    field_id=f.id,
                    label=f.label,
                    type=ExtractionFieldType(f.field_type),
                    allowed_values=_normalize_allowed_values(f.allowed_values),
                    parent_section_id=f.entity_type_id,
                )
            )

        return tuple(
            SectionDescriptor(
                entity_type_id=e.id,
                label=e.label,
                role=ExtractionEntityRole(e.role),
                parent_entity_type_id=e.parent_entity_type_id,
                fields=tuple(fields_by_section.get(e.id, ())),
            )
            for e in entity_rows
        )

    async def _resolve_articles_for_consensus(
        self,
        *,
        template_id: UUID,
        project_id: UUID,
        candidate_ids: list[UUID],
    ) -> tuple[list[ArticleDescriptor], dict[str, int]]:
        """Pick finalized articles + collect omitted-stage counts (FR-013)."""
        if not candidate_ids:
            return [], {}

        # Bulk-fetch runs for the candidate articles on this template.
        run_rows = (
            (
                await self.db.execute(
                    select(ExtractionRun).where(
                        ExtractionRun.template_id == template_id,
                        ExtractionRun.project_id == project_id,
                        ExtractionRun.article_id.in_(candidate_ids),
                        ExtractionRun.kind == "extraction",
                    )
                )
            )
            .scalars()
            .all()
        )

        runs_by_article = _select_current_runs_by_article(run_rows)
        omitted: dict[str, int] = {}
        kept_run_ids: list[UUID] = []
        kept_articles: list[UUID] = []
        for aid in candidate_ids:
            run = runs_by_article.get(aid)
            if run is None:
                omitted["no_run"] = omitted.get("no_run", 0) + 1
                continue
            if run.stage != ExtractionRunStage.FINALIZED.value:
                omitted[run.stage] = omitted.get(run.stage, 0) + 1
                continue
            kept_articles.append(aid)
            kept_run_ids.append(run.id)

        if not kept_articles:
            return [], omitted

        # Bulk-fetch instances for the kept runs to compute model fan-out
        # and study-section instance ids in one round-trip.
        instances_by_run = await self._load_instances_for_runs(kept_run_ids)
        entity_by_id = await self._load_entity_type_role_map(template_id)
        headers = await self._load_article_headers(kept_articles)

        descriptors: list[ArticleDescriptor] = []
        for aid in kept_articles:
            run = runs_by_article[aid]
            insts = instances_by_run.get(run.id, [])
            model_instances: list[UUID] = []
            study_instances: dict[UUID, UUID] = {}
            for inst in insts:
                role = entity_by_id.get(inst.entity_type_id)
                if role is ExtractionEntityRole.MODEL_SECTION:
                    model_instances.append(inst.id)
                elif role is ExtractionEntityRole.STUDY_SECTION:
                    # When the template has multiple study_sections, we
                    # keep one instance per entity_type (the earliest by
                    # sort_order, which is the iteration order).
                    study_instances.setdefault(inst.entity_type_id, inst.id)
                # model_container instances themselves carry no values —
                # only their model_section children do.

            descriptors.append(
                ArticleDescriptor(
                    article_id=aid,
                    header_label=headers.get(aid) or _short_id(aid),
                    run_id=run.id,
                    run_stage=ExtractionRunStage(run.stage),
                    model_instances=tuple(model_instances),
                    study_instances=study_instances,
                )
            )

        return descriptors, omitted

    async def _load_instances_for_runs(
        self,
        run_ids: list[UUID],
    ) -> dict[UUID, list[ExtractionInstance]]:
        """Load all instances for a set of runs, grouped by run_id."""
        if not run_ids:
            return {}
        # ExtractionInstance has no run_id column; instances are scoped
        # by (article_id, template_id). We resolve via the Run set:
        # load the runs once to know (article_id, template_id) pairs,
        # then bulk-fetch matching instances.
        runs = (
            (await self.db.execute(select(ExtractionRun).where(ExtractionRun.id.in_(run_ids))))
            .scalars()
            .all()
        )
        if not runs:
            return {}
        article_ids = {r.article_id for r in runs}
        template_ids = {r.template_id for r in runs}

        inst_rows = (
            (
                await self.db.execute(
                    select(ExtractionInstance)
                    .where(
                        ExtractionInstance.article_id.in_(article_ids),
                        ExtractionInstance.template_id.in_(template_ids),
                    )
                    .order_by(
                        ExtractionInstance.entity_type_id,
                        ExtractionInstance.sort_order,
                    )
                )
            )
            .scalars()
            .all()
        )

        by_article: dict[UUID, list[ExtractionInstance]] = {}
        for inst in inst_rows:
            if inst.article_id is None:
                continue
            by_article.setdefault(inst.article_id, []).append(inst)

        return {r.id: by_article.get(r.article_id, []) for r in runs}

    async def _load_entity_type_role_map(
        self,
        template_id: UUID,
    ) -> dict[UUID, ExtractionEntityRole]:
        """Return ``entity_type_id -> role`` for the template."""
        rows = (
            await self.db.execute(
                select(ExtractionEntityType.id, ExtractionEntityType.role).where(
                    ExtractionEntityType.project_template_id == template_id
                )
            )
        ).all()
        return {row[0]: ExtractionEntityRole(row[1]) for row in rows}

    async def _load_article_headers(
        self,
        article_ids: list[UUID],
    ) -> dict[UUID, str]:
        """Build the FR-012 header label: ``First-author, year`` → title → id."""
        if not article_ids:
            return {}
        rows = (
            await self.db.execute(
                select(
                    Article.id,
                    Article.title,
                    Article.authors,
                    Article.publication_year,
                ).where(Article.id.in_(article_ids))
            )
        ).all()
        headers: dict[UUID, str] = {}
        for aid, title, authors, year in rows:
            headers[aid] = _build_header_label(title, authors, year, aid)
        return headers

    async def _build_consensus_value_map(
        self,
        *,
        run_ids: list[UUID],
    ) -> dict[tuple[Any, ...], Any]:
        """Bulk-fetch all published values for the given runs (FR-013).

        Single query: ``SELECT … FROM extraction_published_states WHERE
        run_id IN :run_ids``. Result keyed by
        ``(run_id, instance_id, field_id) -> Python value``.
        """
        if not run_ids:
            return {}
        rows = (
            await self.db.execute(
                select(
                    ExtractionPublishedState.run_id,
                    ExtractionPublishedState.instance_id,
                    ExtractionPublishedState.field_id,
                    ExtractionPublishedState.value,
                ).where(ExtractionPublishedState.run_id.in_(run_ids))
            )
        ).all()
        return {
            (run_id, instance_id, field_id): _unwrap_value(value)
            for run_id, instance_id, field_id, value in rows
        }

    # ==================================================================
    # US2 — Single user mode
    # ==================================================================

    async def _resolve_articles_for_single_user(
        self,
        *,
        template_id: UUID,
        project_id: UUID,
        candidate_ids: list[UUID],
        reviewer_id: UUID,
    ) -> tuple[list[ArticleDescriptor], dict[str, int]]:
        """Pick articles where the target reviewer has ≥ 1 non-reject decision (FR-014).

        Single-user mode tolerates any non-terminal Run stage (the reviewer
        may have started before consensus). ``cancelled`` runs and runs
        with no decisions from this reviewer are omitted.
        """
        from app.models.extraction_workflow import (
            ExtractionReviewerDecision,
            ExtractionReviewerState,
        )

        if not candidate_ids:
            return [], {}

        run_rows = (
            (
                await self.db.execute(
                    select(ExtractionRun).where(
                        ExtractionRun.template_id == template_id,
                        ExtractionRun.project_id == project_id,
                        ExtractionRun.article_id.in_(candidate_ids),
                        ExtractionRun.kind == "extraction",
                    )
                )
            )
            .scalars()
            .all()
        )
        runs_by_article = _select_current_runs_by_article(run_rows)

        if not runs_by_article:
            return [], {"no_run": len(candidate_ids)}

        # Eligibility: at least one non-reject reviewer decision for this
        # reviewer on this run.
        eligible_run_rows = (
            await self.db.execute(
                select(ExtractionReviewerState.run_id)
                .join(
                    ExtractionReviewerDecision,
                    ExtractionReviewerState.current_decision_id == ExtractionReviewerDecision.id,
                )
                .where(
                    ExtractionReviewerState.reviewer_id == reviewer_id,
                    ExtractionReviewerState.run_id.in_([r.id for r in run_rows]),
                    ExtractionReviewerDecision.decision != "reject",
                )
                .distinct()
            )
        ).all()
        eligible_run_ids: set[UUID] = {row[0] for row in eligible_run_rows}

        omitted: dict[str, int] = {}
        kept_article_ids: list[UUID] = []
        for aid in candidate_ids:
            run = runs_by_article.get(aid)
            if run is None:
                omitted["no_run"] = omitted.get("no_run", 0) + 1
                continue
            if run.stage == ExtractionRunStage.CANCELLED.value:
                omitted["cancelled"] = omitted.get("cancelled", 0) + 1
                continue
            if run.id not in eligible_run_ids:
                omitted["no_decisions_from_reviewer"] = (
                    omitted.get("no_decisions_from_reviewer", 0) + 1
                )
                continue
            kept_article_ids.append(aid)

        if not kept_article_ids:
            return [], omitted

        kept_run_ids = [runs_by_article[aid].id for aid in kept_article_ids]
        instances_by_run = await self._load_instances_for_runs(kept_run_ids)
        entity_by_id = await self._load_entity_type_role_map(template_id)
        headers = await self._load_article_headers(kept_article_ids)

        descriptors: list[ArticleDescriptor] = []
        for aid in kept_article_ids:
            run = runs_by_article[aid]
            insts = instances_by_run.get(run.id, [])
            model_instances: list[UUID] = []
            study_instances: dict[UUID, UUID] = {}
            for inst in insts:
                role = entity_by_id.get(inst.entity_type_id)
                if role is ExtractionEntityRole.MODEL_SECTION:
                    model_instances.append(inst.id)
                elif role is ExtractionEntityRole.STUDY_SECTION:
                    study_instances.setdefault(inst.entity_type_id, inst.id)
            descriptors.append(
                ArticleDescriptor(
                    article_id=aid,
                    header_label=headers.get(aid) or _short_id(aid),
                    run_id=run.id,
                    run_stage=ExtractionRunStage(run.stage),
                    model_instances=tuple(model_instances),
                    study_instances=study_instances,
                )
            )
        return descriptors, omitted

    async def _build_single_user_value_map(
        self,
        *,
        run_ids: list[UUID],
        reviewer_id: UUID,
    ) -> dict[tuple[Any, ...], Any]:
        """Bulk-fetch one reviewer's latest decisions per (run, instance, field).

        Decision resolution (FR-014):
          * accept_proposal → underlying proposal.proposed_value
          * edit            → decision.value
          * reject          → None (cell blank)
        """
        from app.models.extraction_workflow import (
            ExtractionProposalRecord,
            ExtractionReviewerDecision,
            ExtractionReviewerState,
        )

        if not run_ids:
            return {}

        rows = (
            await self.db.execute(
                select(
                    ExtractionReviewerState.run_id,
                    ExtractionReviewerState.instance_id,
                    ExtractionReviewerState.field_id,
                    ExtractionReviewerDecision.decision,
                    ExtractionReviewerDecision.value,
                    ExtractionProposalRecord.proposed_value,
                )
                .join(
                    ExtractionReviewerDecision,
                    ExtractionReviewerState.current_decision_id == ExtractionReviewerDecision.id,
                )
                .outerjoin(
                    ExtractionProposalRecord,
                    ExtractionReviewerDecision.proposal_record_id == ExtractionProposalRecord.id,
                )
                .where(
                    ExtractionReviewerState.run_id.in_(run_ids),
                    ExtractionReviewerState.reviewer_id == reviewer_id,
                )
            )
        ).all()

        out: dict[tuple[Any, ...], Any] = {}
        for rid, iid, fid, decision, value, proposed_value in rows:
            if decision == "accept_proposal":
                out[(rid, iid, fid)] = _unwrap_value(proposed_value)
            elif decision == "edit":
                out[(rid, iid, fid)] = _unwrap_value(value)
            # reject → key absent (renders blank)
        return out

    async def list_eligible_reviewers_for_picker(
        self,
        *,
        project_id: UUID,
        template_id: UUID,
    ) -> list[dict[str, str]]:
        """Reviewers the caller is allowed to pick in the export dialog.

        Managers see every reviewer who has at least one non-reject
        decision on this template. Non-managers see only themselves —
        enforced here so the endpoint stays free of role-resolution
        plumbing (constitution §I: API layer is thin).
        """
        all_reviewers = await self.list_reviewers_with_decisions(
            project_id=project_id, template_id=template_id
        )
        try:
            caller_id = UUID(self.user_id)
        except (TypeError, ValueError):
            return []
        is_manager = await self._project_members_repo().has_role(
            project_id, caller_id, ProjectMemberRole.MANAGER
        )
        if is_manager:
            return all_reviewers
        return [r for r in all_reviewers if r["id"] == self.user_id]

    async def list_reviewers_with_decisions(
        self,
        *,
        project_id: UUID,
        template_id: UUID,
    ) -> list[dict[str, str]]:
        """Reviewers with ≥ 1 non-reject decision on this project template.

        Returns a list of ``{"id": "...", "name": "..."}`` dicts ordered
        alphabetically by display name. Primitive used by
        ``list_eligible_reviewers_for_picker``; not called directly from
        the API layer.
        """
        from app.models.extraction_workflow import (
            ExtractionReviewerDecision,
            ExtractionReviewerState,
        )
        from app.models.user import Profile

        rows = (
            await self.db.execute(
                select(
                    ExtractionReviewerState.reviewer_id,
                    Profile.full_name,
                    Profile.email,
                )
                .join(
                    ExtractionReviewerDecision,
                    ExtractionReviewerState.current_decision_id == ExtractionReviewerDecision.id,
                )
                .join(
                    ExtractionRun,
                    ExtractionReviewerState.run_id == ExtractionRun.id,
                )
                .join(Profile, Profile.id == ExtractionReviewerState.reviewer_id)
                .where(
                    ExtractionRun.project_id == project_id,
                    ExtractionRun.template_id == template_id,
                    ExtractionRun.kind == "extraction",
                    ExtractionReviewerDecision.decision != "reject",
                )
                .distinct()
            )
        ).all()

        seen: dict[UUID, str] = {}
        for rid, name, email in rows:
            seen.setdefault(rid, name or email or _short_id(rid))
        ordered = sorted(seen.items(), key=lambda kv: kv[1].lower())
        return [{"id": str(rid), "name": label} for rid, label in ordered]

    # ==================================================================
    # US3 — All users mode
    # ==================================================================

    async def _resolve_articles_for_all_users(
        self,
        *,
        template_id: UUID,
        project_id: UUID,
        candidate_ids: list[UUID],
    ) -> tuple[list[ArticleDescriptor], dict[str, int]]:
        """Pick finalized + in-review articles for All-users mode.

        Both `consensus` and `finalized` runs contribute reviewer columns;
        plus consensus and earlier-stage runs may contribute reviewer
        sub-columns (the reviewer-axis column is empty for pre-review runs).
        """
        if not candidate_ids:
            return [], {}

        run_rows = (
            (
                await self.db.execute(
                    select(ExtractionRun).where(
                        ExtractionRun.template_id == template_id,
                        ExtractionRun.project_id == project_id,
                        ExtractionRun.article_id.in_(candidate_ids),
                        ExtractionRun.kind == "extraction",
                    )
                )
            )
            .scalars()
            .all()
        )
        runs_by_article = _select_current_runs_by_article(run_rows)

        omitted: dict[str, int] = {}
        kept_article_ids: list[UUID] = []
        for aid in candidate_ids:
            run = runs_by_article.get(aid)
            if run is None:
                omitted["no_run"] = omitted.get("no_run", 0) + 1
                continue
            if run.stage in (
                ExtractionRunStage.CANCELLED.value,
                ExtractionRunStage.PENDING.value,
                ExtractionRunStage.PROPOSAL.value,
            ):
                # All-users wants reviewer activity; pre-review runs have none.
                omitted[run.stage] = omitted.get(run.stage, 0) + 1
                continue
            kept_article_ids.append(aid)

        if not kept_article_ids:
            return [], omitted

        kept_run_ids = [runs_by_article[aid].id for aid in kept_article_ids]
        instances_by_run = await self._load_instances_for_runs(kept_run_ids)
        entity_by_id = await self._load_entity_type_role_map(template_id)
        headers = await self._load_article_headers(kept_article_ids)

        descriptors: list[ArticleDescriptor] = []
        for aid in kept_article_ids:
            run = runs_by_article[aid]
            insts = instances_by_run.get(run.id, [])
            model_instances: list[UUID] = []
            study_instances: dict[UUID, UUID] = {}
            for inst in insts:
                role = entity_by_id.get(inst.entity_type_id)
                if role is ExtractionEntityRole.MODEL_SECTION:
                    model_instances.append(inst.id)
                elif role is ExtractionEntityRole.STUDY_SECTION:
                    study_instances.setdefault(inst.entity_type_id, inst.id)
            descriptors.append(
                ArticleDescriptor(
                    article_id=aid,
                    header_label=headers.get(aid) or _short_id(aid),
                    run_id=run.id,
                    run_stage=ExtractionRunStage(run.stage),
                    model_instances=tuple(model_instances),
                    study_instances=study_instances,
                )
            )
        return descriptors, omitted

    async def _list_reviewers_for_runs(
        self,
        *,
        run_ids: list[UUID],
        anonymize: bool,
    ) -> tuple[ReviewerDescriptor, ...]:
        """Distinct reviewers with ≥ 1 non-reject decision on the run set.

        Stable ordering (FR-011):
          * anonymize=False → alphabetical by display name
          * anonymize=True  → stable by reviewer id (so re-runs of the
            same export produce the same Reviewer A/B mapping)
        """
        from app.models.extraction_workflow import (
            ExtractionReviewerDecision,
            ExtractionReviewerState,
        )
        from app.models.user import Profile

        if not run_ids:
            return ()

        rows = (
            await self.db.execute(
                select(
                    ExtractionReviewerState.reviewer_id,
                    Profile.full_name,
                    Profile.email,
                )
                .join(
                    ExtractionReviewerDecision,
                    ExtractionReviewerState.current_decision_id == ExtractionReviewerDecision.id,
                )
                .outerjoin(Profile, Profile.id == ExtractionReviewerState.reviewer_id)
                .where(
                    ExtractionReviewerState.run_id.in_(run_ids),
                    ExtractionReviewerDecision.decision != "reject",
                )
                .distinct()
            )
        ).all()

        by_id: dict[UUID, str] = {}
        for rid, name, email in rows:
            by_id.setdefault(rid, name or email or _short_id(rid))

        if anonymize:
            ordered_ids = sorted(by_id.keys(), key=lambda u: str(u))
            return tuple(
                ReviewerDescriptor(
                    reviewer_id=rid,
                    display_label=f"Reviewer {_letter_for(idx)}",
                )
                for idx, rid in enumerate(ordered_ids)
            )
        ordered = sorted(by_id.items(), key=lambda kv: kv[1].lower())
        return tuple(
            ReviewerDescriptor(reviewer_id=rid, display_label=label) for rid, label in ordered
        )

    async def _build_all_users_value_map(
        self,
        *,
        run_ids: list[UUID],
        reviewer_ids: list[UUID],
    ) -> dict[tuple[Any, ...], Any]:
        """Build the 4-tuple value map for All-users mode (FR-015).

        Key shape: ``(run_id, instance_id, field_id, reviewer_id | None)``.
        ``None`` is the consensus sub-column (mirrors the consensus
        value_map). Reviewer keys carry per-user latest decision values
        (accept_proposal → proposed_value; edit → decision.value;
        reject omitted).
        """
        from app.models.extraction_workflow import (
            ExtractionProposalRecord,
            ExtractionReviewerDecision,
            ExtractionReviewerState,
        )

        out: dict[tuple[Any, ...], Any] = {}
        if not run_ids:
            return out

        # Consensus sub-column (reviewer_id=None) — published states.
        consensus_rows = (
            await self.db.execute(
                select(
                    ExtractionPublishedState.run_id,
                    ExtractionPublishedState.instance_id,
                    ExtractionPublishedState.field_id,
                    ExtractionPublishedState.value,
                ).where(ExtractionPublishedState.run_id.in_(run_ids))
            )
        ).all()
        for rid, iid, fid, value in consensus_rows:
            out[(rid, iid, fid, None)] = _unwrap_value(value)

        if not reviewer_ids:
            return out

        # Per-reviewer values.
        rev_rows = (
            await self.db.execute(
                select(
                    ExtractionReviewerState.run_id,
                    ExtractionReviewerState.instance_id,
                    ExtractionReviewerState.field_id,
                    ExtractionReviewerState.reviewer_id,
                    ExtractionReviewerDecision.decision,
                    ExtractionReviewerDecision.value,
                    ExtractionProposalRecord.proposed_value,
                )
                .join(
                    ExtractionReviewerDecision,
                    ExtractionReviewerState.current_decision_id == ExtractionReviewerDecision.id,
                )
                .outerjoin(
                    ExtractionProposalRecord,
                    ExtractionReviewerDecision.proposal_record_id == ExtractionProposalRecord.id,
                )
                .where(
                    ExtractionReviewerState.run_id.in_(run_ids),
                    ExtractionReviewerState.reviewer_id.in_(reviewer_ids),
                )
            )
        ).all()
        for rid, iid, fid, reviewer_id, decision, value, proposed in rev_rows:
            if decision == "accept_proposal":
                out[(rid, iid, fid, reviewer_id)] = _unwrap_value(proposed)
            elif decision == "edit":
                out[(rid, iid, fid, reviewer_id)] = _unwrap_value(value)
        return out

    # ------------------------------------------------------------------
    # AI metadata sheet loader (FR-036 – FR-040)
    # ------------------------------------------------------------------

    async def _load_ai_proposal_rows(
        self,
        *,
        articles: tuple[ArticleDescriptor, ...],
        sections: tuple[SectionDescriptor, ...],
        value_map: dict[tuple[Any, ...], Any],
        mode: ExportMode,  # noqa: ARG002 — used in US3 to choose value_map shape
    ) -> tuple[AIProposalRow, ...]:
        """Load every AI proposal for the in-scope runs into flat rows.

        Three bulk queries, regardless of article count:
          1. proposal_records (source='ai')
          2. evidence linked by proposal_record_id
          3. reviewer_states + decisions for the same (run, instance, field)
             coordinates (to compute the ``Reviewer outcome`` column).
        """
        from app.models.extraction import ExtractionEntityType, ExtractionField
        from app.models.extraction_workflow import (
            ExtractionProposalRecord,
            ExtractionReviewerDecision,
            ExtractionReviewerState,
        )

        run_ids = [a.run_id for a in articles if a.run_id is not None]
        if not run_ids:
            return ()

        # Article + section/field lookup maps for label substitution.
        articles_by_run: dict[UUID, ArticleDescriptor] = {
            a.run_id: a for a in articles if a.run_id is not None
        }
        section_by_entity: dict[UUID, SectionDescriptor] = {s.entity_type_id: s for s in sections}
        field_label_by_id: dict[UUID, str] = {
            f.field_id: f.label for s in sections for f in s.fields
        }
        # entity_type for each instance is needed to compute the section
        # label and the cardinality-driven instance index. One bulk
        # query over instances:
        inst_rows = (
            await self.db.execute(
                select(
                    ExtractionInstance.id,
                    ExtractionInstance.entity_type_id,
                    ExtractionInstance.article_id,
                ).where(ExtractionInstance.article_id.in_([a.article_id for a in articles]))
            )
        ).all()
        instance_meta: dict[UUID, tuple[UUID, UUID]] = {
            iid: (etid, aid) for iid, etid, aid in inst_rows
        }

        # 1. AI proposals, newest first so the latest is encountered before
        # any superseded ones for the same (run, instance, field).
        proposal_rows = (
            await self.db.execute(
                select(
                    ExtractionProposalRecord.id,
                    ExtractionProposalRecord.run_id,
                    ExtractionProposalRecord.instance_id,
                    ExtractionProposalRecord.field_id,
                    ExtractionProposalRecord.proposed_value,
                    ExtractionProposalRecord.confidence_score,
                    ExtractionProposalRecord.rationale,
                    ExtractionProposalRecord.created_at,
                )
                .where(
                    ExtractionProposalRecord.run_id.in_(run_ids),
                    ExtractionProposalRecord.source == "ai",
                )
                .order_by(ExtractionProposalRecord.created_at.desc())
            )
        ).all()
        if not proposal_rows:
            return ()

        # Compute "latest per key" to flag superseded rows.
        latest_id_per_key: dict[tuple[UUID, UUID, UUID], UUID] = {}
        for pid, rid, iid, fid, _v, _c, _r, _ts in proposal_rows:
            latest_id_per_key.setdefault((rid, iid, fid), pid)

        proposal_ids = [row[0] for row in proposal_rows]

        # 2. Evidence — load once, group by proposal_record_id.
        from app.models.extraction import ExtractionEvidence  # local — avoid cycles

        evidence_rows = (
            await self.db.execute(
                select(
                    ExtractionEvidence.proposal_record_id,
                    ExtractionEvidence.text_content,
                    ExtractionEvidence.page_number,
                ).where(ExtractionEvidence.proposal_record_id.in_(proposal_ids))
            )
        ).all()
        ev_text_by_pid: dict[UUID, list[str]] = {}
        ev_pages_by_pid: dict[UUID, list[str]] = {}
        for pid, text, page in evidence_rows:
            if text:
                ev_text_by_pid.setdefault(pid, []).append(text)
            if page is not None:
                ev_pages_by_pid.setdefault(pid, []).append(str(page))

        # 3. Reviewer decisions for the same (run, instance, field) — the
        # outcome inference is best-effort because the `edit` decision
        # carries no FK back to the AI proposal (FR-040 caveat).
        decision_rows = (
            await self.db.execute(
                select(
                    ExtractionReviewerState.run_id,
                    ExtractionReviewerState.instance_id,
                    ExtractionReviewerState.field_id,
                    ExtractionReviewerDecision.decision,
                    ExtractionReviewerDecision.proposal_record_id,
                )
                .join(
                    ExtractionReviewerDecision,
                    ExtractionReviewerState.current_decision_id == ExtractionReviewerDecision.id,
                )
                .where(ExtractionReviewerState.run_id.in_(run_ids))
            )
        ).all()
        # Index decisions by (run, instance, field) → list of (decision, prop_id).
        decisions_by_key: dict[tuple[UUID, UUID, UUID], list[tuple[str, UUID | None]]] = {}
        for rid, iid, fid, decision, prop_id in decision_rows:
            decisions_by_key.setdefault((rid, iid, fid), []).append((decision, prop_id))

        # Pre-compute the instance index map per article so we can label
        # "Instance #" 1..N for model_section instances.
        instance_index_by_id: dict[UUID, int] = {}
        for article in articles:
            for idx, iid in enumerate(article.model_instances, start=1):
                instance_index_by_id[iid] = idx
            for iid in article.study_instances.values():
                instance_index_by_id[iid] = 1

        # Section labels — lookup needs entity_type_id for an instance.
        # If an entity_type doesn't appear in our snapshot sections, we
        # fall back to a "(unknown section)" label rather than erroring.
        ent_label_rows = (
            await self.db.execute(
                select(ExtractionEntityType.id, ExtractionEntityType.label).where(
                    ExtractionEntityType.id.in_({etid for etid, _aid in instance_meta.values()})
                    if instance_meta
                    else (False,)  # type: ignore[arg-type]  # SA short-circuits on no-op
                )
            )
        ).all()
        section_label_by_entity: dict[UUID, str] = dict(ent_label_rows)

        # Field-label fallback when a field is not in the template snapshot
        # (rare; happens when the run was finalized on an older version).
        missing_field_ids = {
            fid for _pid, _rid, _iid, fid, *_ in proposal_rows if fid not in field_label_by_id
        }
        if missing_field_ids:
            fb_rows = (
                await self.db.execute(
                    select(ExtractionField.id, ExtractionField.label).where(
                        ExtractionField.id.in_(missing_field_ids)
                    )
                )
            ).all()
            for fid, label in fb_rows:
                field_label_by_id.setdefault(fid, label)

        # Build the output rows.
        out: list[AIProposalRow] = []
        for pid, rid, iid, fid, proposed_value, confidence, rationale, ts in proposal_rows:
            article = articles_by_run.get(rid)
            if article is None:
                continue  # defensive; the run is in scope by construction
            instance_etid = instance_meta.get(iid, (None, None))[0]
            section_label = (
                section_by_entity[instance_etid].label
                if instance_etid in section_by_entity
                else section_label_by_entity.get(instance_etid, "(unknown section)")
            )
            outcome = _infer_reviewer_outcome(
                proposal_id=pid,
                key=(rid, iid, fid),
                latest_id=latest_id_per_key[(rid, iid, fid)],
                decisions=decisions_by_key.get((rid, iid, fid), []),
            )
            final_value = value_map.get((rid, iid, fid))
            row = AIProposalRow(
                article_label=article.header_label,
                section_label=section_label,
                instance_index=instance_index_by_id.get(iid, 1),
                field_label=field_label_by_id.get(fid, "(unknown field)"),
                ai_proposed_value=_unwrap_value(proposed_value),
                confidence=float(confidence) if confidence is not None else None,
                rationale=rationale,
                evidence_text=" | ".join(ev_text_by_pid.get(pid, [])),
                evidence_pages=", ".join(ev_pages_by_pid.get(pid, [])),
                proposed_at=ts,
                reviewer_outcome=outcome,
                final_value_used=final_value,
            )
            out.append(row)

        return tuple(out)


# ----------------------------------------------------------------------
# Module-level pure helpers
# ----------------------------------------------------------------------


def _infer_reviewer_outcome(
    *,
    proposal_id: UUID,
    key: tuple[UUID, UUID, UUID],  # noqa: ARG001 — kept for symmetry/debugging
    latest_id: UUID,
    decisions: list[tuple[str, UUID | None]],
) -> str:
    """Compute the FR-037 ``Reviewer outcome`` value for a proposal.

    Precedence (highest → lowest):
        accepted (exact, proposal_record_id matches)
          → rejected (any reject decision present on this key)
            → edited (best-effort) (any edit decision present)
              → superseded (a newer AI proposal exists for this key)
                → pending (no reviewer_state yet)
    """
    for decision, prop_id in decisions:
        if decision == "accept_proposal" and prop_id == proposal_id:
            return "accepted"
    for decision, _ in decisions:
        if decision == "reject":
            return "rejected"
    for decision, _ in decisions:
        if decision == "edit":
            return "edited (best-effort)"
    if proposal_id != latest_id:
        return "superseded"
    return "pending"


_ACTIVE_EXPORT_RUN_STAGES = {
    ExtractionRunStage.PENDING.value,
    ExtractionRunStage.PROPOSAL.value,
    ExtractionRunStage.REVIEW.value,
    ExtractionRunStage.CONSENSUS.value,
}


def _select_current_runs_by_article(
    run_rows: list[ExtractionRun],
) -> dict[UUID, ExtractionRun]:
    """Choose the same current run the HITL session path exposes.

    Reopen creates multiple runs for the same article/template. Export must
    never let PostgreSQL row order decide whether it sees the old finalized
    run or the active revision. Prefer the latest non-terminal run, otherwise
    the latest finalized run, otherwise the latest cancelled run for omission
    accounting.
    """

    active_by_article: dict[UUID, ExtractionRun] = {}
    finalized_by_article: dict[UUID, ExtractionRun] = {}
    cancelled_by_article: dict[UUID, ExtractionRun] = {}

    for run in sorted(run_rows, key=_run_recency_key, reverse=True):
        if run.stage in _ACTIVE_EXPORT_RUN_STAGES:
            active_by_article.setdefault(run.article_id, run)
        elif run.stage == ExtractionRunStage.FINALIZED.value:
            finalized_by_article.setdefault(run.article_id, run)
        elif run.stage == ExtractionRunStage.CANCELLED.value:
            cancelled_by_article.setdefault(run.article_id, run)

    selected: dict[UUID, ExtractionRun] = {}
    for article_id in {
        *active_by_article.keys(),
        *finalized_by_article.keys(),
        *cancelled_by_article.keys(),
    }:
        selected[article_id] = (
            active_by_article.get(article_id)
            or finalized_by_article.get(article_id)
            or cancelled_by_article[article_id]
        )
    return selected


def _run_recency_key(run: ExtractionRun) -> tuple[datetime, str]:
    created_at = run.created_at or datetime.min.replace(tzinfo=UTC)
    return created_at, str(run.id)


def _normalize_allowed_values(raw: Any) -> tuple[str, ...]:
    """Normalise the ``allowed_values`` JSONB column to a tuple of strings.

    The column stores either ``[{"value": "...", "label": "..."}, …]``,
    ``["x", "y", "z"]``, or ``None``. We surface a flat tuple of display
    strings; the builder reads the same tuple to render select/multiselect
    values.
    """
    if raw is None:
        return ()
    if isinstance(raw, list):
        out: list[str] = []
        for item in raw:
            if isinstance(item, dict):
                label = item.get("label") or item.get("value")
                if isinstance(label, str):
                    out.append(label)
            elif isinstance(item, str):
                out.append(item)
        return tuple(out)
    if isinstance(raw, dict) and "options" in raw and isinstance(raw["options"], list):
        return _normalize_allowed_values(raw["options"])
    return ()


def _unwrap_value(raw: Any) -> Any:
    """Unwrap the JSONB shape used by extraction_published_states.value.

    Published values are stored as ``{"value": <scalar>}`` (per the
    extraction value service convention). Falls back to the raw shape
    when the wrapper is absent.
    """
    if isinstance(raw, dict) and set(raw.keys()) == {"value"}:
        return raw["value"]
    return raw


def _build_header_label(
    title: str | None,
    authors: list[str] | None,
    year: int | None,
    article_id: UUID,
) -> str:
    """Compute the article column header per FR-012 fallback chain."""
    if authors:
        first = (authors[0] or "").strip()
        # Take the surname only — naive but matches the reference workbook's
        # `Gaca, 2011` / `De Feo, 2012` style.
        surname = first.split(",")[0].strip() if "," in first else first.split(" ")[-1]
        if surname and year is not None:
            return f"{surname}, {year}"
        if surname:
            return surname
    if title:
        return title[:60]
    return _short_id(article_id)


def _short_id(value: UUID) -> str:
    return str(value).split("-")[0]


def _letter_for(idx: int) -> str:
    """Convert ``0 → A``, ``1 → B``, … ``25 → Z``, ``26 → AA`` (anonymize)."""
    if idx < 0:
        return "?"
    out = ""
    n = idx
    while True:
        out = chr(ord("A") + (n % 26)) + out
        n = n // 26 - 1
        if n < 0:
            break
    return out


__all__ = [
    "ArticleDescriptor",
    "ExportLayout",
    "ExportMode",
    "ExportNotes",
    "ExtractionExportService",
    "FieldDescriptor",
    "ReviewerDescriptor",
    "SectionDescriptor",
    "AppError",
    "ExtractionCardinality",
]

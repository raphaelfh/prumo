"""Extraction Export Service.

Orchestrator for the publication-ready extraction `.xlsx` download.
Resolves the in-memory ``ExportLayout`` and hands bytes-production off
to the pure sub-builders in ``app.services.exports.extraction``.

Architectural notes:
* Layered per constitution §I: this service only orchestrates; SQL goes
  through repositories and direct ``select()`` statements that respect
  RLS via the injected ``AsyncSession``. No HTTP types cross the
  boundary.
* Bulk reads only — no per-cell N+1. Every value-map builder issues at
  most a fixed small number of queries regardless of article count.
* All three value-source modes (Consensus, Single-user, All-users) are
  fully implemented; ``resolve_layout`` dispatches on ``mode``.
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
from app.models.extraction_versioning import TemplateKind
from app.models.extraction_workflow import ExtractionPublishedState
from app.models.project import ProjectMemberRole
from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.repositories.project_repository import ProjectMemberRepository, ProjectRepository
from app.services.exports.extraction_snapshot_reader import (
    AllowedValue,
    load_export_sections,
)
from app.services.exports.value_envelope import resolve_value

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
    """One field within an entity_type (= one row on the matrix sheet).

    Metadata fields (``description``/``unit``/``is_required``/``allow_other``)
    are carried from the per-Run version snapshot (spec §5.1) and consumed by
    the data-dictionary + value resolver. Defaulted for back-compat with
    existing ``()``-arg call sites.
    """

    field_id: UUID
    label: str
    type: ExtractionFieldType
    allowed_values: tuple[str, ...]
    parent_section_id: UUID
    description: str | None = None
    unit: str | None = None
    is_required: bool = False
    allow_other: bool = False


@dataclass(frozen=True)
class SectionDescriptor:
    """One section (entity_type) — drives section header + field rows.

    ``cardinality`` is the fan-out key (spec §5.2): ``MANY`` fans out one
    record per instance for ANY role; ``ONE`` is one record per article.
    Sections are emitted in ``sort_order``.
    """

    entity_type_id: UUID
    label: str
    role: ExtractionEntityRole
    parent_entity_type_id: UUID | None
    fields: tuple[FieldDescriptor, ...]
    cardinality: ExtractionCardinality = ExtractionCardinality.ONE
    sort_order: int = 0
    description: str | None = None


@dataclass(frozen=True)
class ArticleDescriptor:
    """One article column (or N adjacent columns when multi-instance).

    ``section_instances`` carries an ORDERED instance-id tuple per
    study/section entity_type — fixing the §6 medium bug where
    ``setdefault`` kept only the first instance and silently lost the rest.
    Single-cardinality sections carry a 1-tuple. ``version_id`` is the Run's
    own snapshot version, used for the per-Run obsolete-field diff (§5.1).
    """

    article_id: UUID
    header_label: str
    run_id: UUID | None
    run_stage: ExtractionRunStage | None
    version_id: UUID | None
    # Ordered model_section instance ids; empty when the template has no
    # model_container OR when the article has zero model instances.
    model_instances: tuple[UUID, ...]
    # entity_type_id (study/section) → ORDERED instance ids for the run.
    section_instances: dict[UUID, tuple[UUID, ...]]

    @property
    def study_instances(self) -> dict[UUID, UUID]:
        """Read-compat alias: first instance per section (legacy dict shape).

        Consumed by the not-yet-migrated matrix builder + AI loader until the
        builder slice fans out over ``section_instances``. Sections with no
        instance are dropped (nothing to render).
        """
        return {sid: ids[0] for sid, ids in self.section_instances.items() if ids}


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
class FrontMatter:
    """README/Methods content (§4 #1) — absorbs the old ``Notes`` sheet.

    Built service-side in ``resolve_layout`` (slice task T53) and rendered by
    the pure ``build_front_matter`` sub-builder: template identity, export
    provenance, a generated ``contents`` list, the glyph/sentinel ``legend``,
    provenance ``caveats``, and the per-Run ``obsolete_fields_per_article``
    block lifted from ``ExportNotes`` (§5.1).
    """

    project_name: str
    template_name: str
    template_version: int
    export_mode_label: str
    generated_at: datetime
    article_count: int
    record_count: int
    contents: tuple[str, ...]  # generated sheet-name list
    legend: tuple[tuple[str, str], ...]  # (glyph/sentinel, meaning)
    caveats: tuple[str, ...]  # provenance + best-effort-outcome caveats
    obsolete_fields_per_article: dict[UUID, tuple[str, ...]]  # activated §5.1


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
class FieldDictEntry:
    """One row of the Data dictionary / dropdown catalogue (§4 #k+2).

    Flattened from the per-Run version snapshot field metadata: label, type,
    unit, ``description`` (falling back to ``llm_description``), the ordered
    ``allowed_values`` value+label pairs, and the ``is_required`` /
    ``allow_other`` flags. Built service-side in ``resolve_layout`` (T51) and
    consumed by the pure ``build_data_dictionary`` + ``build_dropdown_lists``
    sub-builders.
    """

    field_id: UUID
    section_label: str
    label: str
    type: ExtractionFieldType
    unit: str | None
    description: str | None  # field.description, else field.llm_description
    allowed_values: tuple[AllowedValue, ...]  # value+label, ordered
    is_required: bool
    allow_other: bool


@dataclass(frozen=True)
class TidyRow:
    """One record on a tidy table — one article, or one article × instance.

    ``values`` are pre-resolved scalars aligned to the owning
    ``TidyTable.column_field_ids``; ``instance_id`` is the fanned-out instance
    for a ``MANY``-cardinality section, ``None`` for ``ONE``.
    """

    article_id: UUID
    instance_id: UUID | None
    record_label: str  # e.g. "Gaca, 2011" or "Gaca, 2011 — Model 2"
    values: tuple[Any, ...]  # aligned to TidyTable.column_field_ids, resolved


@dataclass(frozen=True)
class TidyTable:
    """One publication "Table 1" sheet at a section's cardinality grain (§5.3).

    Built service-side in ``resolve_layout`` (slice task T52) and rendered by
    the pure ``build_tidy_tables`` sub-builder: one records-as-rows sheet per
    non-container section. ``cardinality`` sets the grain — ``ONE`` is one row
    per article, ``MANY`` one row per (article × instance).
    """

    section_id: UUID
    title: str  # sheet-name-safe section label
    cardinality: ExtractionCardinality
    column_field_ids: tuple[UUID, ...]  # ordered by sort_order
    column_labels: tuple[str, ...]
    rows: tuple[TidyRow, ...]


@dataclass(frozen=True)
class AppraisalRow:
    """One record's appraisal roll-up (§7). Values are already-resolved scalars.

    ``domain_verdicts`` is aligned to ``AppraisalModel.domain_labels``;
    ``overall`` is the worst-case rollup over those verdicts (consensus /
    single-user). ``per_reviewer_overall`` is populated only in All-users mode
    (``reviewer_id -> Overall``), mirroring the matrix reviewer-axis fan-out.
    """

    article_id: UUID
    record_label: str
    domain_verdicts: tuple[Any, ...]  # aligned to AppraisalModel.domain_labels
    overall: Any  # worst-case rollup (consensus / single-user)
    per_reviewer_overall: dict[UUID, Any]  # all-users only: reviewer_id -> Overall


@dataclass(frozen=True)
class AppraisalModel:
    """Computed appraisal roll-up (§7); None on ExportLayout when no appraisal layer.

    Present only when the exported template carries an appraisal layer
    (``kind == TemplateKind.QUALITY_ASSESSMENT`` with ≥1 resolvable domain
    verdict). ``domain_section_ids`` are the per-domain appraisal sections, and
    ``domain_labels`` the column headers the verdicts align to.
    """

    domain_section_ids: tuple[UUID, ...]
    domain_labels: tuple[str, ...]
    rows: tuple[AppraisalRow, ...]


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
    # README/Methods projection (§4 #1); built in ``resolve_layout`` (T53).
    # None => the sub-builder falls back to the bare layout identity fields.
    front_matter: FrontMatter | None = None
    # Data-dictionary / dropdown catalogue (§4 #k+2); built in
    # ``resolve_layout`` (T51). One ``FieldDictEntry`` per snapshot field.
    data_dictionary: tuple[FieldDictEntry, ...] = ()
    # Per-section publication "Table 1" sheets (§5.3); built in
    # ``resolve_layout`` (T52). One ``TidyTable`` per non-container section.
    tidy_tables: tuple[TidyTable, ...] = ()
    # Per-domain risk-of-bias / appraisal roll-up with mode-aware ``Overall``
    # (§7). None unless the exported template carries an appraisal layer
    # (``kind == TemplateKind.QUALITY_ASSESSMENT``); ``build_appraisal_summary``
    # returns None and the sheet is omitted when this is None.
    appraisal: AppraisalModel | None = None


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
        reviewer_id: UUID | None = None,
    ) -> ExportLayout:
        """Build the in-memory layout for an export request.

        Dispatches on ``mode`` across the Consensus, Single-user, and
        All-users branches; each resolves its eligible articles and value
        map and returns a fully-populated ``ExportLayout``. Columns are
        anchored on the active-version snapshot (spec §5.1).
        """
        template, version = await self._load_active_template_version(template_id, project_id)
        project_name = await self._resolve_project_name(project_id)
        sections = await self._load_sections(version.id)
        data_dictionary = _build_data_dictionary(sections)
        fields_by_id: dict[UUID, FieldDescriptor] = {
            f.field_id: f for s in sections for f in s.fields
        }

        reviewers: tuple[ReviewerDescriptor, ...] = ()

        if mode is ExportMode.CONSENSUS:
            articles, omitted = await self._resolve_articles_for_consensus(
                template_id=template_id,
                project_id=project_id,
                candidate_ids=article_ids,
                run_kind=template.kind,
            )
            value_map = await self._build_consensus_value_map(
                run_ids=[a.run_id for a in articles if a.run_id is not None],
                fields_by_id=fields_by_id,
            )
        elif mode is ExportMode.SINGLE_USER:
            if reviewer_id is None:
                raise NotFoundError("reviewer_id is required when mode=single_user.")
            articles, omitted = await self._resolve_articles_for_single_user(
                template_id=template_id,
                project_id=project_id,
                candidate_ids=article_ids,
                reviewer_id=reviewer_id,
                run_kind=template.kind,
            )
            value_map = await self._build_single_user_value_map(
                run_ids=[a.run_id for a in articles if a.run_id is not None],
                reviewer_id=reviewer_id,
                fields_by_id=fields_by_id,
            )
        elif mode is ExportMode.ALL_USERS:
            articles, omitted = await self._resolve_articles_for_all_users(
                template_id=template_id,
                project_id=project_id,
                candidate_ids=article_ids,
                run_kind=template.kind,
            )
            reviewers = await self._list_reviewers_for_runs(
                run_ids=[a.run_id for a in articles if a.run_id is not None],
                anonymize=anonymize_reviewer_names,
            )
            value_map = await self._build_all_users_value_map(
                run_ids=[a.run_id for a in articles if a.run_id is not None],
                reviewer_ids=[r.reviewer_id for r in reviewers],
                fields_by_id=fields_by_id,
            )
        else:  # pragma: no cover — exhaustive over ExportMode
            raise AssertionError(f"unhandled export mode: {mode!r}")

        anchor_field_ids = {f.field_id for s in sections for f in s.fields}
        obsolete_fields = await self._compute_obsolete_fields_per_article(
            articles=tuple(articles),
            anchor_field_ids=anchor_field_ids,
        )

        # Per-section publication "Table 1" sheets (§5.3): values are baked
        # from the already-resolved ``value_map`` — no envelope re-handling.
        tidy_tables = _build_tidy_tables(sections, tuple(articles), value_map, mode)

        notes = ExportNotes(
            omitted_articles_by_stage=omitted,
            obsolete_fields_per_article=obsolete_fields,
            template_version_label=f"{template.name} v{version.version}",
            export_mode_label=mode.value,
            anonymize_reviewer_names=anonymize_reviewer_names,
            include_ai_metadata=include_ai_metadata,
            generated_at=datetime.now(UTC),
        )

        # README/Methods projection (§4 #1): assembled from the already-computed
        # counts, the generated contents list, and the obsolete-field block
        # lifted from ``notes`` — no further IO.
        front_matter = _build_front_matter(
            project_name=project_name,
            template_name=template.name,
            template_version=version.version,
            mode=mode,
            generated_at=notes.generated_at or datetime.now(UTC),
            articles=tuple(articles),
            tidy_tables=tidy_tables,
            obsolete_fields_per_article=notes.obsolete_fields_per_article,
        )

        ai_rows: tuple[AIProposalRow, ...] = ()
        if include_ai_metadata:
            ai_rows = await self._load_ai_proposal_rows(
                articles=tuple(articles),
                sections=sections,
                value_map=value_map,
                mode=mode,
                # A3: only single-user mode has one target reviewer; consensus and
                # all-users keep every reviewer's decisions in scope.
                target_reviewer_id=reviewer_id if mode is ExportMode.SINGLE_USER else None,
            )

        # Per-domain risk-of-bias / appraisal roll-up (§7): only for
        # quality-assessment templates. Pure rollup over the already-resolved
        # ``value_map`` — returns None when no domain carries a risk-label
        # SELECT verdict field (the sections then ship as ordinary tidy tables).
        appraisal: AppraisalModel | None = None
        if template.kind == TemplateKind.QUALITY_ASSESSMENT.value:
            appraisal = self._build_appraisal_model(
                sections=sections,
                articles=tuple(articles),
                reviewers=reviewers,
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
            data_dictionary=data_dictionary,
            tidy_tables=tidy_tables,
            front_matter=front_matter,
            appraisal=appraisal,
        )

    # ------------------------------------------------------------------
    # Appraisal roll-up (§7) — pure, DB-free
    # ------------------------------------------------------------------

    @staticmethod
    def _build_appraisal_model(
        *,
        sections: tuple[SectionDescriptor, ...],
        articles: tuple[ArticleDescriptor, ...],
        reviewers: tuple[ReviewerDescriptor, ...],
        value_map: dict[tuple[Any, ...], Any],
        mode: ExportMode,
    ) -> AppraisalModel | None:
        """Compute the appraisal roll-up for a quality-assessment template (§7).

        Each domain = one section; its verdict field = the first SELECT-typed
        field in sort_order whose ``allowed_values`` are the risk-label set
        (``{Low, High, Unclear, ...}`` — the recognised severity vocabulary).
        This is NOT "the first SELECT field": signalling questions are also
        SELECT-typed and precede the judgment in sort_order (seed.py), so a
        positional rule would wrongly pick a signalling answer. Keying on the
        risk-label set selects ``risk_of_bias`` (and excludes signalling fields
        whose answer sets are Y/PY/PN/N/... ); among the two judgment fields
        (risk_of_bias, applicability_concerns) the first-in-sort_order tiebreak
        deterministically picks risk_of_bias. The descriptor carries no machine
        ``name``, so selection keys on ``allowed_values``, not the field name.

        Overall = worst-case rollup over the record's domain verdicts.
        Mode-aware:

          * consensus / single_user -> AppraisalRow.overall only (3-tuple keys).
          * all_users -> consensus overall (reviewer_id=None) + one rollup per
            reviewer (4-tuple keys), in ``reviewers`` order.

        Returns None when no domain has a risk-label-set SELECT verdict field
        (no roll-up sheet; the sections still ship as ordinary tidy tables).
        """
        # Function-local import breaks the module cycle: appraisal_summary
        # imports ExportLayout/ExportMode from this module at load time, so a
        # top-level import here would deadlock. The rollup vocabulary +
        # worst-case helper live in the pure sub-builder (single source).
        from app.services.exports.extraction.appraisal_summary import (
            _RISK_LABELS,
            _appraisal_overall,
        )

        # Verdict field per domain: first SELECT field in sort_order whose
        # allowed_values are the recognised risk-label set (excludes signalling
        # SELECT fields, whose answer sets differ — see _appraisal_overall's
        # severity table for the recognised labels).
        def _is_verdict(field: FieldDescriptor) -> bool:
            if field.type is not ExtractionFieldType.SELECT:
                return False
            labels = [v.strip().lower() for v in field.allowed_values if v.strip()]
            return bool(labels) and all(label in _RISK_LABELS for label in labels)

        domains: list[tuple[SectionDescriptor, FieldDescriptor]] = []
        for section in sorted(sections, key=lambda s: s.sort_order):
            verdict_field = next(
                (f for f in section.fields if _is_verdict(f)),
                None,
            )
            if verdict_field is not None:
                domains.append((section, verdict_field))
        if not domains:
            return None

        domain_section_ids = tuple(s.entity_type_id for s, _ in domains)
        domain_labels = tuple(s.label for s, _ in domains)
        is_all_users = mode is ExportMode.ALL_USERS

        rows: list[AppraisalRow] = []
        for article in articles:
            run_id = article.run_id
            if run_id is None:
                continue
            consensus_verdicts: list[Any] = []
            per_reviewer_verdicts: dict[UUID, list[Any]] = {r.reviewer_id: [] for r in reviewers}
            for section, vfield in domains:
                instance_ids = article.section_instances.get(section.entity_type_id, ())
                instance_id = instance_ids[0] if instance_ids else None
                if is_all_users:
                    consensus_verdicts.append(
                        value_map.get((run_id, instance_id, vfield.field_id, None))
                    )
                    for reviewer in reviewers:
                        per_reviewer_verdicts[reviewer.reviewer_id].append(
                            value_map.get(
                                (
                                    run_id,
                                    instance_id,
                                    vfield.field_id,
                                    reviewer.reviewer_id,
                                )
                            )
                        )
                else:
                    consensus_verdicts.append(value_map.get((run_id, instance_id, vfield.field_id)))

            per_reviewer_overall = (
                {
                    rid: _appraisal_overall(tuple(verdicts))
                    for rid, verdicts in per_reviewer_verdicts.items()
                }
                if is_all_users
                else {}
            )
            rows.append(
                AppraisalRow(
                    article_id=article.article_id,
                    record_label=article.header_label,
                    domain_verdicts=tuple(consensus_verdicts),
                    overall=_appraisal_overall(tuple(consensus_verdicts)),
                    per_reviewer_overall=per_reviewer_overall,
                )
            )

        return AppraisalModel(
            domain_section_ids=domain_section_ids,
            domain_labels=domain_labels,
            rows=tuple(rows),
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
        project_id: UUID,
    ) -> tuple[ProjectExtractionTemplate, Any]:
        """Load the project template + its currently-active version row.

        Scoped by ``project_id`` (defense-in-depth, mirroring the reviewer
        picker query): a template id belonging to another project must not
        resolve here even though the caller passed our own project's
        membership gate — otherwise the async export path would build and
        upload a workbook carrying a foreign project's template metadata.
        """
        template = (
            await self.db.execute(
                select(ProjectExtractionTemplate).where(
                    ProjectExtractionTemplate.id == template_id,
                    ProjectExtractionTemplate.project_id == project_id,
                )
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
        version_id: UUID,
    ) -> tuple[SectionDescriptor, ...]:
        """Load the column-layout sections from the ACTIVE version snapshot.

        Snapshot-driven (spec §5.1): reads the frozen entity_types tree via
        ``load_export_sections`` (mirrors the run-read path), not the live
        ``extraction_entity_types`` / ``extraction_fields`` tables. Carries
        role + cardinality + full field metadata onto the descriptors.
        """
        snapshot_sections = await load_export_sections(self.db, version_id=version_id)
        return tuple(
            SectionDescriptor(
                entity_type_id=s.entity_type_id,
                label=s.label,
                role=s.role,
                parent_entity_type_id=s.parent_entity_type_id,
                fields=tuple(
                    FieldDescriptor(
                        field_id=f.field_id,
                        label=f.label,
                        type=f.type,
                        allowed_values=tuple(av.label for av in f.allowed_values),
                        parent_section_id=s.entity_type_id,
                        description=f.description or f.llm_description,
                        unit=f.unit,
                        is_required=f.is_required,
                        allow_other=f.allow_other,
                    )
                    for f in s.fields
                ),
                cardinality=s.cardinality,
                sort_order=s.sort_order,
                description=s.description,
            )
            for s in snapshot_sections
        )

    async def _compute_obsolete_fields_per_article(
        self,
        *,
        articles: tuple[ArticleDescriptor, ...],
        anchor_field_ids: set[UUID],
    ) -> dict[UUID, list[str]]:
        """Fields present on a Run's frozen snapshot but removed from the anchor.

        Spec §5.1: each Run's own version snapshot is diffed by ``field_id``
        against the active-version anchor. Surviving fields are filled
        elsewhere; Run-only fields (removed from the anchor after the Run
        finalized) are recorded here, labelled from the Run snapshot (the
        anchor no longer carries the label). Empty when nothing was removed.
        """
        snapshot_fields_cache: dict[UUID, tuple[tuple[UUID, str], ...]] = {}
        out: dict[UUID, list[str]] = {}
        for article in articles:
            version_id = article.version_id
            if version_id is None:
                continue
            if version_id not in snapshot_fields_cache:
                run_sections = await load_export_sections(self.db, version_id=version_id)
                snapshot_fields_cache[version_id] = tuple(
                    (f.field_id, f.label) for s in run_sections for f in s.fields
                )
            obsolete = [
                label
                for fid, label in snapshot_fields_cache[version_id]
                if fid not in anchor_field_ids
            ]
            if obsolete:
                out[article.article_id] = obsolete
        return out

    async def _resolve_articles_for_consensus(
        self,
        *,
        template_id: UUID,
        project_id: UUID,
        candidate_ids: list[UUID],
        run_kind: str = "extraction",
    ) -> tuple[list[ArticleDescriptor], dict[str, int]]:
        """Pick finalized articles + collect omitted-stage counts (FR-013).

        ``run_kind`` is the exported template's kind (``extraction`` or
        ``quality_assessment``): a run's kind is copied from its template
        at creation, so filtering on the template's own kind keeps the QA
        appraisal export (§7) on the same finalized-run path while still
        rejecting a foreign-kind run that happens to share the article.
        """
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
                        ExtractionRun.kind == run_kind,
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
            section_instances: dict[UUID, list[UUID]] = {}
            for inst in insts:
                role = entity_by_id.get(inst.entity_type_id)
                if role is ExtractionEntityRole.MODEL_SECTION:
                    model_instances.append(inst.id)
                elif role is ExtractionEntityRole.STUDY_SECTION:
                    # Ordered list per entity_type — many-cardinality study
                    # sections keep ALL instances (spec §5.2 fan-out source).
                    section_instances.setdefault(inst.entity_type_id, []).append(inst.id)
                # model_container instances carry no values themselves.

            descriptors.append(
                ArticleDescriptor(
                    article_id=aid,
                    header_label=headers.get(aid) or _short_id(aid),
                    run_id=run.id,
                    run_stage=ExtractionRunStage(run.stage),
                    version_id=run.version_id,
                    model_instances=tuple(model_instances),
                    section_instances={k: tuple(v) for k, v in section_instances.items()},
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
        fields_by_id: dict[UUID, FieldDescriptor],
    ) -> dict[tuple[Any, ...], Any]:
        """Bulk-fetch all published values for the given runs (FR-013).

        Single query: ``SELECT … FROM extraction_published_states WHERE
        run_id IN :run_ids``. Result keyed by
        ``(run_id, instance_id, field_id) -> resolved scalar``. The field
        descriptor is threaded so ``resolve_value`` can surface units and
        boolean labels.
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
            (run_id, instance_id, field_id): resolve_value(value, field=fields_by_id.get(field_id))
            for run_id, instance_id, field_id, value in rows
        }

    # ==================================================================
    # Single-user mode
    # ==================================================================

    async def _resolve_articles_for_single_user(
        self,
        *,
        template_id: UUID,
        project_id: UUID,
        candidate_ids: list[UUID],
        reviewer_id: UUID,
        run_kind: str = "extraction",
    ) -> tuple[list[ArticleDescriptor], dict[str, int]]:
        """Pick articles where the target reviewer has ≥ 1 non-reject decision (FR-014).

        Single-user mode tolerates any non-terminal Run stage (the reviewer
        may have started before consensus). ``cancelled`` runs and runs
        with no decisions from this reviewer are omitted. ``run_kind`` is
        the exported template's kind (see ``_resolve_articles_for_consensus``).
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
                        ExtractionRun.kind == run_kind,
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
            section_instances: dict[UUID, list[UUID]] = {}
            for inst in insts:
                role = entity_by_id.get(inst.entity_type_id)
                if role is ExtractionEntityRole.MODEL_SECTION:
                    model_instances.append(inst.id)
                elif role is ExtractionEntityRole.STUDY_SECTION:
                    # Ordered list per entity_type — many-cardinality study
                    # sections keep ALL instances (spec §5.2 fan-out source).
                    section_instances.setdefault(inst.entity_type_id, []).append(inst.id)
                # model_container instances carry no values themselves.

            descriptors.append(
                ArticleDescriptor(
                    article_id=aid,
                    header_label=headers.get(aid) or _short_id(aid),
                    run_id=run.id,
                    run_stage=ExtractionRunStage(run.stage),
                    version_id=run.version_id,
                    model_instances=tuple(model_instances),
                    section_instances={k: tuple(v) for k, v in section_instances.items()},
                )
            )
        return descriptors, omitted

    async def _build_single_user_value_map(
        self,
        *,
        run_ids: list[UUID],
        reviewer_id: UUID,
        fields_by_id: dict[UUID, FieldDescriptor],
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
            field = fields_by_id.get(fid)
            if decision == "accept_proposal":
                out[(rid, iid, fid)] = resolve_value(proposed_value, field=field)
            elif decision == "edit":
                out[(rid, iid, fid)] = resolve_value(value, field=field)
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
        # Resolve the caller first so a malformed subject short-circuits
        # before any DB IO.
        try:
            caller_id = UUID(self.user_id)
        except (TypeError, ValueError):
            return []
        # Key the run filter on the exported template's own kind so a
        # quality_assessment template surfaces its reviewers; scoped by
        # project_id (defense-in-depth, like the reviewer query) and
        # falling back to ``extraction`` when absent (mirrors the
        # ``run_kind`` default on ``_resolve_articles_for_consensus``).
        run_kind = (
            await self.db.execute(
                select(ProjectExtractionTemplate.kind).where(
                    ProjectExtractionTemplate.id == template_id,
                    ProjectExtractionTemplate.project_id == project_id,
                )
            )
        ).scalar_one_or_none() or "extraction"
        all_reviewers = await self.list_reviewers_with_decisions(
            project_id=project_id, template_id=template_id, run_kind=run_kind
        )
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
        run_kind: str = "extraction",
    ) -> list[dict[str, str]]:
        """Reviewers with ≥ 1 non-reject decision on this project template.

        Returns a list of ``{"id": "...", "name": "..."}`` dicts ordered
        alphabetically by display name. Primitive used by
        ``list_eligible_reviewers_for_picker``; not called directly from
        the API layer.

        ``run_kind`` is the exported template's kind (``extraction`` or
        ``quality_assessment``): a run's kind is copied from its template
        at creation, so filtering on the template's own kind surfaces the
        QA picker's reviewers (see ``_resolve_articles_for_consensus``)
        instead of a hard-coded ``extraction`` that hides them.
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
                    ExtractionRun.kind == run_kind,
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
    # All-users mode
    # ==================================================================

    async def _resolve_articles_for_all_users(
        self,
        *,
        template_id: UUID,
        project_id: UUID,
        candidate_ids: list[UUID],
        run_kind: str = "extraction",
    ) -> tuple[list[ArticleDescriptor], dict[str, int]]:
        """Pick finalized + in-review articles for All-users mode.

        Both `consensus` and `finalized` runs contribute reviewer columns;
        plus consensus and earlier-stage runs may contribute reviewer
        sub-columns (the reviewer-axis column is empty for pre-review runs).
        ``run_kind`` is the exported template's kind (see
        ``_resolve_articles_for_consensus``).
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
                        ExtractionRun.kind == run_kind,
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
                ExtractionRunStage.EXTRACT.value,
            ):
                # All-users wants cross-reviewer activity; pre-consensus extract
                # runs have none worth exporting.
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
            section_instances: dict[UUID, list[UUID]] = {}
            for inst in insts:
                role = entity_by_id.get(inst.entity_type_id)
                if role is ExtractionEntityRole.MODEL_SECTION:
                    model_instances.append(inst.id)
                elif role is ExtractionEntityRole.STUDY_SECTION:
                    # Ordered list per entity_type — many-cardinality study
                    # sections keep ALL instances (spec §5.2 fan-out source).
                    section_instances.setdefault(inst.entity_type_id, []).append(inst.id)
                # model_container instances carry no values themselves.

            descriptors.append(
                ArticleDescriptor(
                    article_id=aid,
                    header_label=headers.get(aid) or _short_id(aid),
                    run_id=run.id,
                    run_stage=ExtractionRunStage(run.stage),
                    version_id=run.version_id,
                    model_instances=tuple(model_instances),
                    section_instances={k: tuple(v) for k, v in section_instances.items()},
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
        fields_by_id: dict[UUID, FieldDescriptor],
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
            out[(rid, iid, fid, None)] = resolve_value(value, field=fields_by_id.get(fid))

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
            field = fields_by_id.get(fid)
            if decision == "accept_proposal":
                out[(rid, iid, fid, reviewer_id)] = resolve_value(proposed, field=field)
            elif decision == "edit":
                out[(rid, iid, fid, reviewer_id)] = resolve_value(value, field=field)
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
        mode: ExportMode,
        target_reviewer_id: UUID | None,
    ) -> tuple[AIProposalRow, ...]:
        """Load every AI proposal for the in-scope runs into flat rows.

        Three bulk queries, regardless of article count:
          1. proposal_records (source='ai')
          2. evidence linked by proposal_record_id
          3. reviewer_states + decisions for the same (run, instance, field)
             coordinates (to compute the ``Reviewer outcome`` column).
        """
        from app.models.extraction import ExtractionEntityType
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
        # Descriptor lookup so the AI 'proposed value' column resolves the
        # same envelope shapes the value maps do (number+unit fallback,
        # boolean rendering) via ``resolve_value``.
        field_desc_by_id: dict[UUID, FieldDescriptor] = {
            f.field_id: f for s in sections for f in s.fields
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
        # any superseded ones for the same (run, instance, field). ``id`` is
        # the deterministic tiebreaker on equal ``created_at`` (same-transaction
        # inserts share the timestamp), matching the canonical
        # ExtractionProposalRepository.get_latest_for_coord ordering so the
        # FR-037 "superseded" outcome is stable across export builds.
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
                .order_by(
                    ExtractionProposalRecord.created_at.desc(),
                    ExtractionProposalRecord.id.desc(),
                )
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
                )
                .where(ExtractionEvidence.proposal_record_id.in_(proposal_ids))
                .order_by(
                    ExtractionEvidence.proposal_record_id,
                    ExtractionEvidence.page_number.asc().nulls_last(),
                    ExtractionEvidence.id.asc(),
                )
            )
        ).all()
        # One ordered, deduped (text, page) list per proposal. Dedupe on the
        # (text, page) pair; numeric page sort (the DB ORDER BY emits rows in
        # page order, and we additionally numeric-sort in Python — None pages
        # last — so ordering is deterministic regardless of driver). Pages are
        # rendered numerically sorted and deduped independently so "2" < "10".
        ev_pairs_by_pid: dict[UUID, list[tuple[str | None, int | None]]] = {}
        seen_pairs: dict[UUID, set[tuple[str | None, int | None]]] = {}
        for pid, text, page in evidence_rows:
            pair = (text, page)
            seen = seen_pairs.setdefault(pid, set())
            if pair in seen:
                continue
            seen.add(pair)
            ev_pairs_by_pid.setdefault(pid, []).append(pair)
        for pairs in ev_pairs_by_pid.values():
            # Stable numeric page sort with None pages last; preserves the
            # ORDER BY id tiebreak for pairs that share a page.
            pairs.sort(key=lambda tp: (tp[1] is None, tp[1] if tp[1] is not None else 0))

        # 3. Reviewer decisions for the same (run, instance, field) — the
        # outcome inference is best-effort because the `edit` decision
        # carries no FK back to the AI proposal (FR-040 caveat). In
        # SINGLE_USER mode the query is scoped to the target reviewer so the
        # "Reviewer outcome" column reflects the same reviewer whose values
        # populate "Final value used" (A3); consensus/all-users keep all
        # reviewers' decisions in scope.
        decision_stmt = (
            select(
                ExtractionReviewerState.run_id,
                ExtractionReviewerState.instance_id,
                ExtractionReviewerState.field_id,
                ExtractionReviewerState.reviewer_id,
                ExtractionReviewerDecision.decision,
                ExtractionReviewerDecision.proposal_record_id,
            )
            .join(
                ExtractionReviewerDecision,
                ExtractionReviewerState.current_decision_id == ExtractionReviewerDecision.id,
            )
            .where(ExtractionReviewerState.run_id.in_(run_ids))
        )
        if mode is ExportMode.SINGLE_USER and target_reviewer_id is not None:
            decision_stmt = decision_stmt.where(
                ExtractionReviewerState.reviewer_id == target_reviewer_id
            )
        decision_rows = (await self.db.execute(decision_stmt)).all()
        # Index decisions by (run, instance, field) → list of (decision, prop_id).
        # reviewer_id is selected for scoping/diagnostics but the per-key
        # precedence in _infer_reviewer_outcome consumes the decision+prop_id pair.
        decisions_by_key: dict[tuple[UUID, UUID, UUID], list[tuple[str, UUID | None]]] = {}
        for rid, iid, fid, _reviewer_id, decision, prop_id in decision_rows:
            decisions_by_key.setdefault((rid, iid, fid), []).append((decision, prop_id))

        # Pre-compute the instance index map per article so we can label
        # "Instance #" 1..N for model_section instances.
        instance_index_by_id: dict[UUID, int] = {}
        for article in articles:
            for idx, iid in enumerate(article.model_instances, start=1):
                instance_index_by_id[iid] = idx
            for ids in article.section_instances.values():
                for idx, iid in enumerate(ids, start=1):
                    instance_index_by_id[iid] = idx

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
            # ALL_USERS value_map uses 4-tuple keys (run, instance, field, reviewer_id|None);
            # None is the consensus sub-column. Other modes use 3-tuple keys.
            if mode is ExportMode.ALL_USERS:
                final_value = value_map.get((rid, iid, fid, None))
            else:
                final_value = value_map.get((rid, iid, fid))
            row = AIProposalRow(
                article_label=article.header_label,
                section_label=section_label,
                instance_index=instance_index_by_id.get(iid, 1),
                field_label=field_label_by_id.get(fid, "(unknown field)"),
                ai_proposed_value=resolve_value(proposed_value, field=field_desc_by_id.get(fid)),
                confidence=float(confidence) if confidence is not None else None,
                rationale=rationale,
                evidence_text=" | ".join(t for t, _p in ev_pairs_by_pid.get(pid, []) if t),
                evidence_pages=", ".join(
                    str(p)
                    for p in sorted(
                        {pg for _t, pg in ev_pairs_by_pid.get(pid, []) if pg is not None}
                    )
                ),
                proposed_at=ts,
                reviewer_outcome=outcome,
                final_value_used=final_value,
            )
            out.append(row)

        return tuple(out)


# ----------------------------------------------------------------------
# Module-level pure helpers
# ----------------------------------------------------------------------


_FRONT_MATTER_LEGEND: tuple[tuple[str, str], ...] = (
    ("(blank)", "No value recorded, or the reviewer rejected the AI proposal."),
    ("No information", "The source reported that the item was not stated."),
    ("Yes / No", "Boolean field rendered from its true/false value."),
    ("; ", "Separator between multiple selected options."),
)

_FRONT_MATTER_CAVEATS: tuple[str, ...] = (
    "Every value is a static literal baked from the resolved extraction; "
    "this workbook contains no live formulas.",
    "Reviewer outcomes labelled 'best-effort' rely on heuristics; the data "
    "model does not preserve the exact AI-proposal to edited-value lineage.",
    "Columns reflect the active template version. Fields a Run was finalized "
    "on but later removed are listed under 'Fields removed from active template'.",
)

_MODE_LABELS: dict[ExportMode, str] = {
    ExportMode.CONSENSUS: "Consensus",
    ExportMode.SINGLE_USER: "Single user",
    ExportMode.ALL_USERS: "All users",
}


def _build_front_matter(
    *,
    project_name: str,
    template_name: str,
    template_version: int,
    mode: ExportMode,
    generated_at: datetime,
    articles: tuple[ArticleDescriptor, ...],
    tidy_tables: tuple[TidyTable, ...],
    obsolete_fields_per_article: dict[UUID, list[str]],
) -> FrontMatter:
    """Assemble the README/Methods front matter (§4 #1).

    Counts, the generated ``contents`` list, the static ``legend``/``caveats``,
    and the per-Run ``obsolete_fields_per_article`` block (lifted from
    ``ExportNotes``) come from already-computed inputs. ``record_count`` is the
    total number of tidy-table rows across every section.
    """
    contents: list[str] = ["README / Methods", "Summary", template_name]
    contents.extend(t.title for t in tidy_tables)
    contents.append("Data dictionary")
    record_count = sum(len(t.rows) for t in tidy_tables)
    return FrontMatter(
        project_name=project_name,
        template_name=template_name,
        template_version=template_version,
        export_mode_label=_MODE_LABELS.get(mode, mode.value),
        generated_at=generated_at,
        article_count=len(articles),
        record_count=record_count,
        contents=tuple(contents),
        legend=_FRONT_MATTER_LEGEND,
        caveats=_FRONT_MATTER_CAVEATS,
        obsolete_fields_per_article={
            aid: tuple(labels) for aid, labels in obsolete_fields_per_article.items()
        },
    )


def _build_data_dictionary(
    sections: tuple[SectionDescriptor, ...],
) -> tuple[FieldDictEntry, ...]:
    """Flatten the snapshot sections into one ``FieldDictEntry`` per field (§4 #k+2).

    Order follows section then field order as already resolved on the
    descriptors (snapshot ``sort_order``). ``allowed_values`` are surfaced as
    value+label pairs (value == label in prumo; both preserved — §11). The
    ``description`` is already the ``field.description`` (falling back to
    ``field.llm_description``) collapsed on the descriptor at load time.
    """
    entries: list[FieldDictEntry] = []
    for section in sections:
        for field_ in section.fields:
            entries.append(
                FieldDictEntry(
                    field_id=field_.field_id,
                    section_label=section.label,
                    label=field_.label,
                    type=field_.type,
                    unit=field_.unit,
                    description=field_.description,
                    allowed_values=tuple(
                        AllowedValue(value=v, label=v) for v in field_.allowed_values
                    ),
                    is_required=field_.is_required,
                    allow_other=field_.allow_other,
                )
            )
    return tuple(entries)


def _tidy_value(
    value_map: dict[tuple[Any, ...], Any],
    *,
    run_id: UUID,
    instance_id: UUID,
    field_id: UUID,
    mode: ExportMode,
) -> Any:
    """Baked consensus value for one tidy-cell coordinate.

    All-users keys are 4-tuples ``(run, instance, field, reviewer|None)``; the
    tidy table shows the consensus sub-column (``reviewer_id=None``). Other
    modes use 3-tuple keys. Values are already resolved scalars (resolver
    slice) — never re-handled here.
    """
    if mode is ExportMode.ALL_USERS:
        return value_map.get((run_id, instance_id, field_id, None))
    return value_map.get((run_id, instance_id, field_id))


def _tidy_row(
    *,
    section: SectionDescriptor,
    article: ArticleDescriptor,
    instance_id: UUID,
    record_label: str,
    value_map: dict[tuple[Any, ...], Any],
    mode: ExportMode,
) -> TidyRow:
    """One tidy-table record: pre-resolved values aligned to the section fields."""
    values = tuple(
        _tidy_value(
            value_map,
            run_id=article.run_id,  # type: ignore[arg-type]  # run_id checked non-None by caller
            instance_id=instance_id,
            field_id=f.field_id,
            mode=mode,
        )
        for f in section.fields
    )
    return TidyRow(
        article_id=article.article_id,
        instance_id=instance_id,
        record_label=record_label,
        values=values,
    )


def _build_tidy_tables(
    sections: tuple[SectionDescriptor, ...],
    articles: tuple[ArticleDescriptor, ...],
    value_map: dict[tuple[Any, ...], Any],
    mode: ExportMode,
) -> tuple[TidyTable, ...]:
    """One publication table per non-container section at its record grain.

    The record axis is selected by ROLE first, then cardinality — mirroring
    ``matrix._resolve_instance_id``:

      * ``MODEL_SECTION`` fans out one row per model instance
        (``article.model_instances``) regardless of its own cardinality.
        Production model sections are ``cardinality='one'``; the N-model
        fan-out is always sourced from ``model_instances``, never from
        ``section_instances`` (spec §5.2).
      * non-model ``cardinality==MANY`` fans out one row per instance
        (``section_instances``).
      * non-model ``cardinality==ONE`` yields one row per article.

    Columns are the section fields in their resolved order; values are baked
    from ``value_map`` (already-resolved scalars — §5.3). The
    ``MODEL_CONTAINER`` and field-less sections are skipped (nothing to
    project).
    """
    tables: list[TidyTable] = []
    for section in sections:
        if section.role is ExtractionEntityRole.MODEL_CONTAINER:
            continue
        if not section.fields:
            continue
        column_field_ids = tuple(f.field_id for f in section.fields)
        column_labels = tuple(f.label for f in section.fields)
        rows: list[TidyRow] = []
        for article in articles:
            if article.run_id is None:
                continue
            if section.role is ExtractionEntityRole.MODEL_SECTION:
                # Role-first: model sections always fan out over model_instances
                # regardless of their own cardinality (production model sections
                # are cardinality ONE, yet carry one record per model).
                for idx, instance_id in enumerate(article.model_instances, start=1):
                    rows.append(
                        _tidy_row(
                            section=section,
                            article=article,
                            instance_id=instance_id,
                            record_label=f"{article.header_label} — Model {idx}",
                            value_map=value_map,
                            mode=mode,
                        )
                    )
            elif section.cardinality is ExtractionCardinality.MANY:
                instances = article.section_instances.get(section.entity_type_id, ())
                for idx, instance_id in enumerate(instances, start=1):
                    rows.append(
                        _tidy_row(
                            section=section,
                            article=article,
                            instance_id=instance_id,
                            record_label=f"{article.header_label} — {section.label} {idx}",
                            value_map=value_map,
                            mode=mode,
                        )
                    )
            else:
                instances = article.section_instances.get(section.entity_type_id, ())
                instance_id = instances[0] if instances else None
                if instance_id is None:
                    continue
                rows.append(
                    _tidy_row(
                        section=section,
                        article=article,
                        instance_id=instance_id,
                        record_label=article.header_label,
                        value_map=value_map,
                        mode=mode,
                    )
                )
        tables.append(
            TidyTable(
                section_id=section.entity_type_id,
                title=section.label,
                cardinality=section.cardinality,
                column_field_ids=column_field_ids,
                column_labels=column_labels,
                rows=tuple(rows),
            )
        )
    return tuple(tables)


def _infer_reviewer_outcome(
    *,
    proposal_id: UUID,
    key: tuple[UUID, UUID, UUID],  # noqa: ARG001 — kept for symmetry/debugging
    latest_id: UUID,
    decisions: list[tuple[str, UUID | None]],
) -> str:
    """Compute the FR-037 ``Reviewer outcome`` value for a proposal.

    Precedence (highest → lowest, A2/A4 corrected):
        1. accepted     — an accept_proposal decision targets THIS proposal_id.
        2. superseded   — a newer AI proposal exists for this key
                          (proposal_id != latest_id), checked BEFORE any blanket
                          reject so a superseded proposal is not mislabelled
                          'rejected'.
        3. not selected — this is the latest proposal but an accept_proposal on the
                          key targets a DIFFERENT proposal (reviewed, not chosen).
        4. rejected     — a reject decision exists AND no accept of a different
                          proposal masks it.
        5. edited       — an edit decision exists (best-effort; edit carries no FK
                          back to the AI proposal).
        6. not selected — a terminal decision exists on the key but none of the
                          above applied (A4: never 'pending' once the key is
                          touched).
        7. pending      — no reviewer decision on this key at all.
    """
    accepts_other = any(
        d == "accept_proposal" and pid is not None and pid != proposal_id for d, pid in decisions
    )

    # 1. accepted — exact match on this proposal.
    for decision, pid in decisions:
        if decision == "accept_proposal" and pid == proposal_id:
            return "accepted"

    # 2. superseded — a newer AI proposal exists for this key (before any reject).
    if proposal_id != latest_id:
        return "superseded"

    # 3. not selected — latest, but a different proposal was accepted on the key.
    if accepts_other:
        return "not selected"

    # 4. rejected — a reject exists and no accept-of-other masks it.
    for decision, _ in decisions:
        if decision == "reject":
            return "rejected"

    # 5. edited — best-effort.
    for decision, _ in decisions:
        if decision == "edit":
            return "edited (best-effort)"

    # 6/7. a terminal decision touched the key → 'not selected'; else 'pending'.
    return "not selected" if decisions else "pending"


_ACTIVE_EXPORT_RUN_STAGES = {
    ExtractionRunStage.PENDING.value,
    ExtractionRunStage.EXTRACT.value,
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


#: Lowercase surname particles (nobiliary / patronymic prefixes). When a
#: surname token sequence ends in "<particle...> <Capitalized>", the
#: particle(s) are part of the surname (e.g. "De Feo", "van der Berg").
_SURNAME_PARTICLES = frozenset(
    {
        "de",
        "del",
        "della",
        "der",
        "den",
        "da",
        "das",
        "dos",
        "di",
        "du",
        "van",
        "von",
        "la",
        "le",
        "lo",
        "ter",
        "ten",
        "af",
        "av",
        "bin",
        "ibn",
        "al",
    }
)


def _extract_surname(first_author: str) -> str:
    """Extract a publication-style surname, preserving compound particles.

    * ``"Smith, John"``      → ``"Smith"`` (text before the comma is the
      surname already).
    * ``"Carlo De Feo"``     → ``"De Feo"`` (trailing particle+name run).
    * ``"van der Berg"``     → ``"van der Berg"``.
    * ``"Gaca"`` / ``"Andrew Gaca"`` → ``"Gaca"``.
    """
    cleaned = first_author.strip()
    if not cleaned:
        return ""
    if "," in cleaned:
        # "Surname[, given]" — the surname is everything before the comma,
        # which already includes any particle (e.g. "van der Berg, Anna").
        return cleaned.split(",", 1)[0].strip()

    tokens = cleaned.split()
    if len(tokens) == 1:
        return tokens[0]

    # Walk back from the last token; absorb leading particle tokens.
    surname_tokens = [tokens[-1]]
    idx = len(tokens) - 2
    while idx >= 0 and tokens[idx].lower() in _SURNAME_PARTICLES:
        surname_tokens.insert(0, tokens[idx])
        idx -= 1
    return " ".join(surname_tokens)


def _build_header_label(
    title: str | None,
    authors: list[str] | None,
    year: int | None,
    article_id: UUID,
) -> str:
    """Compute the article column header per FR-012 fallback chain.

    Surname extraction is particle-aware so compound surnames survive
    (e.g. "Carlo De Feo" → "De Feo, 2012", not "Feo, 2012").
    """
    if authors:
        surname = _extract_surname(authors[0] or "")
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

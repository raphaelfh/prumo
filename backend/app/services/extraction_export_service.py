"""Extraction Export Service.

Orchestrator for the publication-ready extraction `.xlsx` download.
Resolves the in-memory ``ExportLayout`` and hands bytes-production off
to the pure sub-builders in ``app.services.exports.extraction``.

Architectural notes:
* Layered per constitution §I: this service only orchestrates; SQL goes
  through repositories and direct ``select()`` statements that respect
  RLS via the injected ``AsyncSession``. No HTTP types cross the
  boundary.
* Bulk reads only — no per-cell N+1. Each cell loader issues one
  statement regardless of article count.
* All three value-source modes (Consensus, Single-user, All-users) are
  fully implemented; ``resolve_layout`` dispatches on ``mode``.
"""

from __future__ import annotations

import re
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.error_handler import AppError, AuthorizationError, NotFoundError
from app.core.logging import LoggerMixin
from app.models.article import Article
from app.models.extraction import (
    ExtractionCardinality,
    ExtractionEntityType,
    ExtractionField,
    ExtractionFieldType,
    ExtractionRun,
    ExtractionRunStage,
    ProjectExtractionTemplate,
)
from app.models.extraction_instance import ExtractionInstance
from app.models.extraction_versioning import ExtractionTemplateVersion, TemplateKind
from app.models.extraction_workflow import (
    ExtractionConsensusDecision,
    ExtractionProposalRecord,
    ExtractionPublishedState,
    ExtractionReviewerDecision,
    ExtractionReviewerState,
)
from app.models.project import ProjectMemberRole
from app.repositories.extraction_template_version_repository import (
    ExtractionTemplateVersionRepository,
)
from app.repositories.project_repository import ProjectMemberRepository, ProjectRepository
from app.schemas.extraction_run import RunViewEntityType, RunViewField
from app.services.current_run import CurrentRunResolver
from app.services.derived_judgment_service import (
    compute_derived_judgments,
    derived_spec,
    is_out_of_scope,
    is_recommendation,
    out_of_scope_sections,
    scope_filtered_values,
    warn_dangling_spec_refs,
)
from app.services.entity_key import key_of
from app.services.exports.ai_proposal_projection import (
    load_evidence_summaries,
    proposal_model_used,
)
from app.services.exports.cell_record import (
    CellRecord,
    DecisionFact,
    LinkedProposal,
    value_map_from_cells,
)
from app.services.exports.codebook_model import (
    CodebookEntry,
    VersionSections,
    apply_field_codes,
    build_codebook_entries,
)
from app.services.exports.descriptors import (
    ValueKey,
    build_entries,
    primary_rater,
    root_instance,
    value_key,
)
from app.services.exports.extraction_scope_marking import (
    NOT_APPLICABLE,
    article_values_by_coord,
    mark_out_of_scope_values,
)
from app.services.exports.extraction_snapshot_reader import (
    AllowedValue,
    load_export_sections,
    section_from_view,
)
from app.services.exports.rater_labels import label_raters, letter_for, short_id
from app.services.exports.values import (
    ExportValue,
    OptionLabels,
    build_option_labels,
    display_value,
    to_export_value,
)
from app.services.extraction_snapshot import (
    entity_types_for_version,
    pinned_template_rules,
    snapshot_is_narrow,
)
from app.services.project_template_active_service import (
    ProjectTemplateNotFoundError,
    owned_template,
)
from app.services.value_semantics import resolve_reviewer_value

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

    Metadata is carried from the version snapshot (spec §5.1) and defaulted
    for the existing short-form call sites. ``code`` is the rule-3 field code
    (blank until assigned); the units, key and absent codes feed the Codebook.
    """

    field_id: UUID
    label: str
    type: ExtractionFieldType
    allowed_values: tuple[AllowedValue, ...]  # (value, label) pairs, ordered
    description: str | None = None
    unit: str | None = None
    is_required: bool = False
    allow_other: bool = False
    # Machine name from the snapshot. Last, and defaulted, so the existing
    # positional/short-form call sites keep working. Used to resolve a
    # template's `derived_judgments` coordinates (§7 computed overalls).
    name: str = ""
    code: str = ""
    allowed_units: tuple[str, ...] = ()
    is_entity_key: bool = False
    allowed_absent_codes: tuple[str, ...] = ()


@dataclass(frozen=True)
class SectionDescriptor:
    """One section (entity_type) — drives section header + field rows.

    Structure is ``parent_entity_type_id`` + ``cardinality`` (trees B4):
    ``MANY`` repeats — it is an entry group — and ``ONE`` is a singleton
    under its parent, or under the article when it has none. Sections are
    emitted in ``sort_order``.
    """

    entity_type_id: UUID
    label: str
    parent_entity_type_id: UUID | None
    fields: tuple[FieldDescriptor, ...]
    cardinality: ExtractionCardinality = ExtractionCardinality.ONE
    sort_order: int = 0
    description: str | None = None
    # Machine name from the snapshot; see FieldDescriptor.name.
    name: str = ""
    # Entry noun of a repeating section from the pinned snapshot (B-8,
    # entry-group train); None on legacy rows and pre-0051 snapshots.
    entry_label: str | None = None


@dataclass(frozen=True, slots=True)
class ArticleRef:
    """An article's project-scoped "Surname Year" label (D2 suffixed) and ids."""

    label: str
    doi: str | None
    pmid: str | None


@dataclass(frozen=True)
class ArticleDescriptor:
    """One article column (or N adjacent columns when multi-instance).

    ``entries`` carries an ORDERED instance-id tuple per
    ``(entity_type, parent_instance)`` pair, so a section's instances are
    grouped under the entry that owns them rather than pooled by entity type.
    ``version_id`` is the Run's own snapshot version (QA rules, ``template_version``).
    """

    article_id: UUID
    article_label: str
    run_id: UUID | None
    version_id: UUID | None
    doi: str | None = None
    pmid: str | None = None
    template_version: int | None = None
    # (entity_type_id, parent_instance_id) → ORDERED instance ids; read in exports/descriptors.py.
    entries: dict[tuple[UUID, UUID | None], tuple[UUID, ...]] = field(default_factory=dict)
    # Keyed instance id -> trimmed label (rule 6).
    keyed_labels: Mapping[UUID, str] = field(default_factory=dict)


@dataclass(frozen=True)
class ReviewerDescriptor:
    """One reviewer column in All-users mode."""

    reviewer_id: UUID
    display_label: str


@dataclass(frozen=True, slots=True)
class OmittedArticle:
    """An article left out of the export, with the Summary's reason (§4.5)."""

    article_id: UUID
    article_label: str
    reason: str


@dataclass(frozen=True)
class AIProposalRow:
    """One row on the optional ``AI metadata`` sheet (FR-037).

    Field order matches the sheet's column order; the builder writes
    ``tuple(row)`` directly via ``dataclasses.astuple`` so the two
    contracts stay in lockstep. That is also why no field here is ever
    read by name — reordering or dropping one silently shifts a column.
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
    model_used: str  # Immutable proposal engine, empty when unavailable
    reviewer_outcome: str  # accepted | rejected | edited (best-effort) | pending | superseded
    final_value_used: Any  # None when not published


@dataclass(frozen=True)
class AppraisalRow:
    """One record's appraisal roll-up (§7). ``domain_verdicts`` aligns to
    ``AppraisalModel.domain_fields``; ``overall`` is the worst-case rollup of
    their rendered labels (consensus / single-user). ``per_reviewer_overall``
    (``reviewer_id -> Overall``) is populated only in All-users mode.
    """

    article_id: UUID
    record_label: str
    domain_verdicts: tuple[ExportValue | None, ...]
    overall: Any  # worst-case rollup (consensus / single-user)
    per_reviewer_overall: dict[UUID, Any]  # all-users only: reviewer_id -> Overall
    # Computed overalls, aligned to ``AppraisalModel.derived_labels``; empty for
    # templates that declare no derivation spec.
    derived_values: tuple[str | None, ...] = ()


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
    domain_fields: tuple[FieldDescriptor, ...]  # the verdict field, aligned to domain_labels
    rows: tuple[AppraisalRow, ...]
    # Labels of the template's computed overalls (``derived_judgments`` on its
    # ``schema`` JSONB). When non-empty they REPLACE the legacy single
    # worst-case ``Overall`` column; empty keeps the legacy behaviour.
    derived_labels: tuple[str, ...] = ()


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
    generated_at: datetime
    # ``value_key`` slots: rater None is consensus; reviewers by reviewer_id (R1).
    value_map: dict[ValueKey, ExportValue]
    # Populated only when ``include_ai_metadata`` is True (FR-036+).
    ai_proposal_rows: tuple[AIProposalRow, ...] = ()
    omitted: tuple[OmittedArticle, ...] = ()
    codebook: tuple[CodebookEntry, ...] = ()  # version-spanning, rule-3 coded
    versions: tuple[VersionSections, ...] = ()  # active first, then pinned latest-first (R14)
    narrow_pinned_versions: tuple[int, ...] = ()  # pinned snapshots skipped as narrow (D5)
    # Per-domain appraisal roll-up (§7). None unless a root section carries a
    # risk-vocabulary verdict (rule 8); the sheet is then omitted.
    appraisal: AppraisalModel | None = None
    appraisal_notes: tuple[str, ...] = ()  # rule-8 README notes
    reviewer_id: UUID | None = None  # single_user target; None in the other modes
    # all_users: run -> reviewers with >=1 non-reject current decision (R16).
    raters_by_run: Mapping[UUID, tuple[UUID, ...]] = field(default_factory=dict)
    # Every loaded cell under its ``value_map`` key; ``value_map`` projects it (D10).
    cells: Mapping[ValueKey, CellRecord] = field(default_factory=dict)
    # One project map, in Member-letter order: rater id -> label (§6, D4).
    rater_labels: Mapping[UUID, str] = field(default_factory=dict)
    # version_id -> field_id -> the run's pinned field; canonical equality reads it.
    pinned_fields: Mapping[UUID, Mapping[UUID, RunViewField]] = field(default_factory=dict)
    # (article_id, instance_id, field_id) with a source=ai proposal in ANY run (§7).
    ai_proposed: frozenset[tuple[UUID, UUID, UUID]] = frozenset()


# ----------------------------------------------------------------------
# Service
# ----------------------------------------------------------------------


_FILENAME_SANITISE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _is_risk_verdict(field: FieldDescriptor) -> bool:
    """A SELECT field whose option labels all belong to the risk-of-bias
    vocabulary (rule 8); signalling questions (Y/PY/PN/N/...) do not."""
    # Function-local import breaks the module cycle: appraisal_summary imports
    # ExportLayout from this module at load time. The vocabulary lives there.
    from app.services.exports.extraction.appraisal_summary import _RISK_LABELS

    if field.type is not ExtractionFieldType.SELECT:
        return False
    labels = [av.label.strip().lower() for av in field.allowed_values if av.label.strip()]
    return bool(labels) and all(label in _RISK_LABELS for label in labels)


class ExtractionExportService(LoggerMixin):
    """Orchestrates an extraction `.xlsx` export request."""

    def __init__(
        self,
        db: AsyncSession,
        user_id: str,
        trace_id: str | None = None,
    ) -> None:
        self.db = db
        self.user_id = user_id
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
        rows = await self._pinned_version_rows(
            project_id=project_id, template_id=template_id, active_version_id=version.id
        )
        wide = [
            r for r in rows if not snapshot_is_narrow((r.schema_ or {}).get("entity_types", []))
        ]
        narrow_pinned_versions = tuple(r.version for r in rows if r not in wide)  # D5
        # ``rows`` is highest-first; the label chain and the codebook read that one order.
        active, *pinned = await self._load_pinned_versions(
            template_id=template_id, versions=(version, *wide)
        )
        labels = build_option_labels(active.sections, [v.sections for v in pinned])
        codebook = build_codebook_entries(active, pinned, labels)
        sections = apply_field_codes(active.sections, {e.field_id: e.field_code for e in codebook})
        primary = primary_rater(mode, reviewer_id)
        refs = await self._load_article_refs(project_id=project_id)
        version_numbers = {version.id: version.version, **{r.id: r.version for r in rows}}
        # D4: a non-manager exporter is the only person named in the export.
        caller_id = UUID(self.user_id)
        is_manager = await self._project_members_repo().has_role(
            project_id, caller_id, ProjectMemberRole.MANAGER
        )
        rater_labels = await self._load_rater_labels(
            project_id=project_id,
            anonymize=anonymize_reviewer_names,
            named_only=None if is_manager else caller_id,
        )
        reviewers: tuple[ReviewerDescriptor, ...] = ()
        raters_by_run: dict[UUID, tuple[UUID, ...]] = {}

        if mode is ExportMode.CONSENSUS:
            articles, omitted = await self._resolve_articles_for_consensus(
                template_id=template_id,
                project_id=project_id,
                candidate_ids=article_ids,
                refs=refs,
                version_numbers=version_numbers,
            )
            run_ids = [a.run_id for a in articles if a.run_id is not None]
            cells = {
                **await self._load_reviewer_cells(run_ids=run_ids, reviewer_ids=None),
                **await self._load_consensus_cells(run_ids=run_ids),
            }
            slots: Literal["consensus", "reviewer", "both"] = "consensus"
        elif mode is ExportMode.SINGLE_USER:
            if reviewer_id is None:
                raise NotFoundError("reviewer_id is required when mode=single_user.")
            articles, omitted = await self._resolve_articles_for_single_user(
                template_id=template_id,
                project_id=project_id,
                candidate_ids=article_ids,
                reviewer_id=reviewer_id,
                refs=refs,
                version_numbers=version_numbers,
            )
            cells = await self._load_reviewer_cells(
                run_ids=[a.run_id for a in articles if a.run_id is not None],
                reviewer_ids=[reviewer_id],
            )
            slots = "reviewer"
        elif mode is ExportMode.ALL_USERS:
            articles, omitted = await self._resolve_articles_for_all_users(
                template_id=template_id,
                project_id=project_id,
                candidate_ids=article_ids,
                refs=refs,
                version_numbers=version_numbers,
            )
            reviewers, raters_by_run = await self._list_reviewers_for_runs(
                run_ids=[a.run_id for a in articles if a.run_id is not None],
                labels=rater_labels,
            )
            run_ids = [a.run_id for a in articles if a.run_id is not None]
            cells = {
                **await self._load_reviewer_cells(
                    run_ids=run_ids, reviewer_ids=[r.reviewer_id for r in reviewers]
                ),
                **await self._load_consensus_cells(run_ids=run_ids),
            }
            slots = "both"
        else:  # pragma: no cover — exhaustive over ExportMode
            raise AssertionError(f"unhandled export mode: {mode!r}")

        # Active descriptors win, then the latest pinned version holding the
        # field, then a minimal live descriptor for an orphan (D10, R14).
        fields: dict[UUID, FieldDescriptor] = {
            f.field_id: f for v in reversed(pinned) for s in v.sections for f in s.fields
        }
        fields.update({f.field_id: f for s in sections for f in s.fields})
        fields.update(
            await self._load_orphan_fields(
                template_id=template_id, field_ids={k[2] for k in cells} - fields.keys()
            )
        )
        value_map = value_map_from_cells(cells, slots=slots, fields=fields, labels=labels)

        # QA rules are each article's own: those frozen in its run's pinned
        # version, so articles reviewed under different versions export apart.
        version_ids = {a.version_id for a in articles if a.version_id is not None}
        rules_by_version = await pinned_template_rules(self.db, version_ids) if version_ids else {}
        rules_by_article = {a.article_id: rules_by_version.get(a.version_id, {}) for a in articles}
        pinned_fields = {v.version_id: v.run_view_fields for v in (active, *pinned)}

        # §5 scope fidelity, applied BEFORE the level sheets, the AI rows and
        # the appraisal read the map, so all three inherit it for free.
        mark_out_of_scope_values(
            rules_by_article=rules_by_article,
            sections=sections,
            articles=tuple(articles),
            raters=(primary, *(r.reviewer_id for r in reviewers)),
            value_map=value_map,
            # A narrow version (D5) is not loaded, so its articles stay unfiltered.
            pinned_field_ids={
                a.article_id: frozenset(pinned_fields[a.version_id])
                for a in articles
                if a.version_id in pinned_fields
            },
        )
        ai_proposed = await self._load_ai_proposed(
            project_id=project_id,
            template_id=template_id,
            article_ids=[a.article_id for a in articles],
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
                labels=labels,
            )

        # Appraisal roll-up (§7, rule 8): detected by vocabulary at the root,
        # whatever the template kind.
        appraisal = self._build_appraisal_model(
            rules_by_article=rules_by_article,
            sections=sections,
            articles=tuple(articles),
            reviewers=reviewers,
            value_map=value_map,
            mode=mode,
            reviewer_id=reviewer_id,
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
            generated_at=datetime.now(UTC),
            value_map=value_map,
            ai_proposal_rows=ai_rows,
            codebook=codebook,
            versions=(active, *pinned),
            narrow_pinned_versions=narrow_pinned_versions,
            omitted=tuple(
                OmittedArticle(aid, refs[aid].label if aid in refs else short_id(aid), reason)
                for aid, reason in omitted
            ),
            appraisal=appraisal,
            appraisal_notes=self._appraisal_notes(
                sections, template_kind=template.kind, appraisal=appraisal
            ),
            reviewer_id=reviewer_id if mode is ExportMode.SINGLE_USER else None,
            raters_by_run=raters_by_run,
            cells=cells,
            rater_labels=rater_labels,
            pinned_fields=pinned_fields,
            ai_proposed=ai_proposed,
        )

    # ------------------------------------------------------------------
    # Appraisal roll-up (§7) — pure, DB-free
    # ------------------------------------------------------------------

    @staticmethod
    def _appraisal_notes(
        sections: Sequence[SectionDescriptor],
        *,
        template_kind: str,
        appraisal: AppraisalModel | None,
    ) -> tuple[str, ...]:
        """Rule-8 README notes: skipped nested domains, and a QA template
        whose verdict labels are outside the risk-of-bias vocabulary."""
        notes = [
            f"Appraisal: '{s.label}' is not at the root, so it is not an Appraisal domain."
            for s in sections
            if s.parent_entity_type_id is not None and any(map(_is_risk_verdict, s.fields))
        ]
        if template_kind == TemplateKind.QUALITY_ASSESSMENT.value and appraisal is None:
            notes.append(
                "Appraisal: no root section has a SELECT field whose labels all belong to the "
                "risk-of-bias vocabulary (PROBAST, QUADAS, RoB), so there is no Appraisal sheet."
            )
        return tuple(notes)

    @staticmethod
    def _build_appraisal_model(
        *,
        sections: tuple[SectionDescriptor, ...],
        articles: tuple[ArticleDescriptor, ...],
        reviewers: tuple[ReviewerDescriptor, ...],
        value_map: dict[ValueKey, ExportValue],
        mode: ExportMode,
        reviewer_id: UUID | None,
        rules_by_article: Mapping[UUID, Mapping[str, Any]] | None = None,
    ) -> AppraisalModel | None:
        """Compute the appraisal roll-up (§7) over the root sections (rule 8).

        Each domain = one root section; its verdict field = the first SELECT-typed
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

        Overall = worst-case rollup over the record's rendered domain verdicts.
        Mode-aware: consensus / single_user -> AppraisalRow.overall from the
        primary slot; all_users -> that plus one rollup per reviewer, in order.

        Returns None when no domain has a risk-label-set SELECT verdict field
        (no roll-up sheet; the sections still ship on their level sheets).
        """
        # Function-local import breaks the module cycle (see _is_risk_verdict).
        from app.services.exports.extraction.appraisal_summary import _appraisal_overall

        # Domains are root sections only (rule 8); nested ones get a README note.
        domains: list[tuple[SectionDescriptor, FieldDescriptor]] = []
        roots = (s for s in sections if s.parent_entity_type_id is None)
        for section in sorted(roots, key=lambda s: s.sort_order):
            verdict_field = next(
                (f for f in section.fields if _is_risk_verdict(f)),
                None,
            )
            if verdict_field is not None:
                domains.append((section, verdict_field))
        if not domains:
            return None

        # Computed overalls (§7): a template whose `schema` JSONB declares a
        # `derived_judgments` spec replaces the legacy single worst-case
        # `Overall` with its own named overalls, computed by the SAME module the
        # run view uses so screen and workbook cannot drift. RECOMMENDATION
        # entries (a derived default for a stored judgment, discriminated by
        # the rule module) are advice, not record — the stored judgments they
        # target already print as domain columns, so only the overalls become
        # derived columns. Each article's spec is its pinned version's; the
        # columns are every version's overalls, first seen first.
        rules_of = rules_by_article or {}
        spec_by_article: dict[UUID, list[dict[str, Any]]] = {}
        label_by_id: dict[str, str] = {}
        known = {(s.name, f.name) for s in sections for f in s.fields}
        warned: set[int] = set()
        for article in articles:
            rules = rules_of.get(article.article_id, {})
            spec_entries = derived_spec(rules)
            spec_by_article[article.article_id] = [
                d for d in spec_entries if not is_recommendation(d)
            ]
            for d in spec_by_article[article.article_id]:
                label_by_id.setdefault(str(d.get("id", "")), str(d.get("label", "")))
            # §9: the run view already warns on spec coordinates the frozen
            # tree no longer carries; the export used to blank the column in
            # silence. Same event, same emitter, once per rule set.
            if spec_entries and id(rules) not in warned:
                warned.add(id(rules))
                warn_dangling_spec_refs(spec_entries, known)
        derived_labels = tuple(label_by_id.values())

        domain_section_ids = tuple(s.entity_type_id for s, _ in domains)
        domain_labels = tuple(s.label for s, _ in domains)
        domain_fields = tuple(vfield for _, vfield in domains)
        primary = primary_rater(mode, reviewer_id)
        raters = (primary, *(r.reviewer_id for r in reviewers))  # reviewers: all_users only

        def _overall(verdicts: Sequence[ExportValue | None]) -> Any:
            shown = (
                None if v is None else display_value(v, f)
                for v, f in zip(verdicts, domain_fields, strict=True)
            )
            return _appraisal_overall(tuple(shown))

        rows: list[AppraisalRow] = []
        for article in articles:
            run_id = article.run_id
            if run_id is None:
                continue
            verdicts: dict[UUID | None, list[ExportValue | None]] = {r: [] for r in raters}
            for section, vfield in domains:
                iid = root_instance(article, section.entity_type_id)
                for rater, column in verdicts.items():
                    key = None if iid is None else value_key(run_id, iid, vfield.field_id, rater)
                    column.append(None if key is None else value_map.get(key))
            per_reviewer_overall = {
                r.reviewer_id: _overall(verdicts[r.reviewer_id]) for r in reviewers
            }
            # Blank under an overall this article's own version does not define.
            derived_values: tuple[str | None, ...] = tuple(None for _ in label_by_id)
            spec = spec_by_article[article.article_id]
            if spec:
                # Resolve the spec's (section, field) coordinates against the
                # SAME value_map the domain verdicts came from, so a derived
                # overall can never disagree with the columns beside it.
                values_by_coord = article_values_by_coord(
                    article=article,
                    sections=sections,
                    value_map=value_map,
                    rater=primary,
                )
                # §2a parity: the same filter the run view applies, from the
                # same helper, so the workbook cannot show a verdict the
                # banner calls "Not applicable" (or vice versa).
                out_of_scope = out_of_scope_sections(
                    rules_of.get(article.article_id, {}), values_by_coord
                )
                by_id = {
                    d.id: NOT_APPLICABLE
                    if d.inputs and all(is_out_of_scope(i, out_of_scope) for i in d.inputs)
                    else d.value
                    for d in compute_derived_judgments(
                        spec, scope_filtered_values(values_by_coord, out_of_scope)
                    )
                }
                derived_values = tuple(by_id.get(entry_id) for entry_id in label_by_id)

            rows.append(
                AppraisalRow(
                    article_id=article.article_id,
                    record_label=article.article_label,
                    domain_verdicts=tuple(verdicts[primary]),
                    overall=_overall(verdicts[primary]),
                    per_reviewer_overall=per_reviewer_overall,
                    derived_values=derived_values,
                )
            )

        return AppraisalModel(
            domain_section_ids=domain_section_ids,
            domain_labels=domain_labels,
            domain_fields=domain_fields,
            rows=tuple(rows),
            derived_labels=derived_labels,
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

        Scoped by ``project_id`` (BOLA): a template id from another project must
        not resolve even though the caller passed our own project's gate, else
        the async export path would leak a foreign project's template metadata.
        """
        try:
            template = await owned_template(self.db, project_id=project_id, template_id=template_id)
        except ProjectTemplateNotFoundError as exc:
            raise NotFoundError("Project template") from exc

        version = await self._template_versions_repo().get_active(template_id)
        if version is None:
            raise NotFoundError(
                f"Project template {template_id} has no active version. "
                "Configure the template before exporting."
            )
        return template, version

    async def _pinned_version_rows(
        self, *, project_id: UUID, template_id: UUID, active_version_id: UUID
    ) -> tuple[ExtractionTemplateVersion, ...]:
        """Every non-active version a run of this template pins, highest first."""
        stmt = (
            select(ExtractionTemplateVersion)
            .join(ExtractionRun, ExtractionRun.version_id == ExtractionTemplateVersion.id)
            .where(
                ExtractionRun.project_id == project_id,
                ExtractionRun.template_id == template_id,
                ExtractionTemplateVersion.id != active_version_id,
            )
            .distinct()
            .order_by(ExtractionTemplateVersion.version.desc())
        )
        return tuple((await self.db.execute(stmt)).scalars().all())

    async def _load_ai_proposed(
        self, *, project_id: UUID, template_id: UUID, article_ids: list[UUID]
    ) -> frozenset[tuple[UUID, UUID, UUID]]:
        """Coordinates with a source=ai proposal in any run of the article (§7)."""
        if not article_ids:
            return frozenset()
        stmt = (
            select(
                ExtractionRun.article_id,
                ExtractionProposalRecord.instance_id,
                ExtractionProposalRecord.field_id,
            )
            .join(ExtractionRun, ExtractionRun.id == ExtractionProposalRecord.run_id)
            .where(
                ExtractionRun.project_id == project_id,
                ExtractionRun.template_id == template_id,
                ExtractionRun.article_id.in_(article_ids),
                ExtractionProposalRecord.source == "ai",
            )
            .distinct()
        )
        return frozenset((await self.db.execute(stmt)).tuples().all())

    async def _load_pinned_versions(
        self, *, template_id: UUID, versions: Sequence[ExtractionTemplateVersion]
    ) -> tuple[VersionSections, ...]:
        """One snapshot read per version, in input order (R14)."""
        loaded: list[VersionSections] = []
        for v in versions:
            views = await entity_types_for_version(
                self.db, version_id=v.id, template_id=template_id
            )
            loaded.append(
                VersionSections(
                    version_id=v.id,
                    version_label=v.version,
                    sections=self._sections_from_views(views),
                    run_view_fields={f.id: f for et in views for f in et.fields},
                )
            )
        return tuple(loaded)

    @staticmethod
    def _sections_from_views(
        views: Sequence[RunViewEntityType],
    ) -> tuple[SectionDescriptor, ...]:
        """Project a snapshot tree onto the export descriptors (spec §5.1)."""
        return tuple(
            SectionDescriptor(
                entity_type_id=s.entity_type_id,
                label=s.label,
                parent_entity_type_id=s.parent_entity_type_id,
                fields=tuple(
                    FieldDescriptor(
                        field_id=f.field_id,
                        label=f.label,
                        type=f.type,
                        allowed_values=tuple(f.allowed_values),
                        description=f.description or f.llm_description,
                        unit=f.unit,
                        is_required=f.is_required,
                        allow_other=f.allow_other,
                        name=f.name,
                        allowed_units=f.allowed_units,
                        is_entity_key=f.is_entity_key,
                        allowed_absent_codes=f.allowed_absent_codes,
                    )
                    for f in s.fields
                ),
                cardinality=s.cardinality,
                sort_order=s.sort_order,
                description=s.description,
                name=s.name,
                entry_label=s.entry_label,
            )
            for s in map(section_from_view, views)
        )

    async def _resolve_articles_for_consensus(
        self,
        *,
        template_id: UUID,
        project_id: UUID,
        candidate_ids: list[UUID],
        refs: Mapping[UUID, ArticleRef],
        version_numbers: Mapping[UUID, int],
    ) -> tuple[list[ArticleDescriptor], list[tuple[UUID, str]]]:
        """Pick finalized articles; the rest are omitted with their stage (FR-013).

        Each article's current run (``CurrentRunResolver``) on the exported
        template; a run's kind is its template's (composite FK), so the QA
        appraisal export (§7) takes the same finalized-run path.
        """
        if not candidate_ids:
            return [], []

        runs_by_article = await CurrentRunResolver(self.db).current_by_article(
            project_id=project_id, template_id=template_id, article_ids=candidate_ids
        )
        omitted: list[tuple[UUID, str]] = []
        kept_run_ids: list[UUID] = []
        kept_articles: list[UUID] = []
        for aid in candidate_ids:
            run = runs_by_article.get(aid)
            if run is None:
                omitted.append((aid, "no_run"))
                continue
            if run.stage != ExtractionRunStage.FINALIZED.value:
                omitted.append((aid, run.stage))
                continue
            kept_articles.append(aid)
            kept_run_ids.append(run.id)

        if not kept_articles:
            return [], omitted

        descriptors = await self._build_article_descriptors(
            article_ids=kept_articles,
            runs_by_article=runs_by_article,
            kept_run_ids=kept_run_ids,
            refs=refs,
            version_numbers=version_numbers,
        )

        return descriptors, omitted

    async def _build_article_descriptors(
        self,
        *,
        article_ids: list[UUID],
        runs_by_article: dict[UUID, ExtractionRun],
        kept_run_ids: list[UUID],
        refs: Mapping[UUID, ArticleRef],
        version_numbers: Mapping[UUID, int],
    ) -> list[ArticleDescriptor]:
        """One descriptor per article. ``entries`` takes EVERY instance,
        containers included: a container is the parent key its children are
        grouped under. A keyed instance carries its trimmed label (rule 6)."""
        instances_by_run = await self._load_instances_for_runs(kept_run_ids)
        out: list[ArticleDescriptor] = []
        for aid in article_ids:
            run = runs_by_article[aid]
            insts = instances_by_run.get(run.id, [])
            ref = refs.get(aid)
            out.append(
                ArticleDescriptor(
                    article_id=aid,
                    article_label=ref.label if ref else short_id(aid),
                    run_id=run.id,
                    version_id=run.version_id,
                    doi=ref.doi if ref else None,
                    pmid=ref.pmid if ref else None,
                    template_version=version_numbers.get(run.version_id),
                    entries=build_entries(insts),
                    keyed_labels={
                        i.id: (i.label or "").strip() for i in insts if key_of(i) is not None
                    },
                )
            )
        return out

    async def _load_instances_for_runs(
        self,
        run_ids: list[UUID],
    ) -> dict[UUID, list[ExtractionInstance]]:
        """Load all instances for a set of runs, grouped by run_id."""
        if not run_ids:
            return {}
        # Instances have no run_id: resolve each run's (article, template) pair first.
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

    async def _load_article_refs(self, *, project_id: UUID) -> dict[UUID, ArticleRef]:
        """Every project article's "Surname Year" label (D2) and ids, in one
        project-scoped query: suffixes depend on the whole project, not the export."""
        rows = (
            await self.db.execute(
                select(
                    Article.id,
                    Article.title,
                    Article.authors,
                    Article.publication_year,
                    Article.created_at,
                    Article.doi,
                    Article.pmid,
                ).where(Article.project_id == project_id)
            )
        ).all()
        labels = _suffix_labels(
            [(aid, _base_label(t, au, y, aid), created) for aid, t, au, y, created, _, _ in rows]
        )
        return {row[0]: ArticleRef(labels[row[0]], row[5], row[6]) for row in rows}

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
        refs: Mapping[UUID, ArticleRef],
        version_numbers: Mapping[UUID, int],
    ) -> tuple[list[ArticleDescriptor], list[tuple[UUID, str]]]:
        """Pick articles where the target reviewer has ≥ 1 non-reject decision (FR-014).

        Single-user mode tolerates any non-terminal Run stage (the reviewer
        may have started before consensus). ``cancelled`` runs and runs
        with no decisions from this reviewer are omitted.
        """
        if not candidate_ids:
            return [], []

        runs_by_article = await CurrentRunResolver(self.db).current_by_article(
            project_id=project_id, template_id=template_id, article_ids=candidate_ids
        )

        if not runs_by_article:
            return [], [(aid, "no_run") for aid in candidate_ids]

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
                    ExtractionReviewerState.run_id.in_([r.id for r in runs_by_article.values()]),
                    ExtractionReviewerDecision.decision != "reject",
                )
                .distinct()
            )
        ).all()
        eligible_run_ids: set[UUID] = {row[0] for row in eligible_run_rows}

        omitted: list[tuple[UUID, str]] = []
        kept_article_ids: list[UUID] = []
        for aid in candidate_ids:
            run = runs_by_article.get(aid)
            if run is None:
                omitted.append((aid, "no_run"))
                continue
            if run.stage == ExtractionRunStage.CANCELLED.value:
                omitted.append((aid, "cancelled"))
                continue
            if run.id not in eligible_run_ids:
                omitted.append((aid, "no_decisions_from_reviewer"))
                continue
            kept_article_ids.append(aid)

        if not kept_article_ids:
            return [], omitted

        kept_run_ids = [runs_by_article[aid].id for aid in kept_article_ids]
        descriptors = await self._build_article_descriptors(
            article_ids=kept_article_ids,
            runs_by_article=runs_by_article,
            kept_run_ids=kept_run_ids,
            refs=refs,
            version_numbers=version_numbers,
        )
        return descriptors, omitted

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
        # falling back to ``extraction`` when absent (the
        # ``list_reviewers_with_decisions`` default).
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
        QA picker's reviewers instead of a hard-coded ``extraction`` that hides them.
        """
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
            seen.setdefault(rid, name or email or short_id(rid))
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
        refs: Mapping[UUID, ArticleRef],
        version_numbers: Mapping[UUID, int],
    ) -> tuple[list[ArticleDescriptor], list[tuple[UUID, str]]]:
        """Pick consensus + finalized articles for All-users mode; earlier
        and cancelled runs are omitted with their stage."""
        if not candidate_ids:
            return [], []

        runs_by_article = await CurrentRunResolver(self.db).current_by_article(
            project_id=project_id, template_id=template_id, article_ids=candidate_ids
        )

        omitted: list[tuple[UUID, str]] = []
        kept_article_ids: list[UUID] = []
        for aid in candidate_ids:
            run = runs_by_article.get(aid)
            if run is None:
                omitted.append((aid, "no_run"))
                continue
            if run.stage in (
                ExtractionRunStage.CANCELLED.value,
                ExtractionRunStage.PENDING.value,
                ExtractionRunStage.EXTRACT.value,
            ):
                # All-users wants cross-reviewer activity; pre-consensus extract
                # runs have none worth exporting.
                omitted.append((aid, run.stage))
                continue
            kept_article_ids.append(aid)

        if not kept_article_ids:
            return [], omitted

        kept_run_ids = [runs_by_article[aid].id for aid in kept_article_ids]
        descriptors = await self._build_article_descriptors(
            article_ids=kept_article_ids,
            runs_by_article=runs_by_article,
            kept_run_ids=kept_run_ids,
            refs=refs,
            version_numbers=version_numbers,
        )
        return descriptors, omitted

    async def _load_rater_labels(
        self, *, project_id: UUID, anonymize: bool, named_only: UUID | None = None
    ) -> dict[UUID, str]:
        """The project's one rater label map (§6, D4): every reviewer or
        consensus actor, by earliest decision; see ``label_raters``."""
        from app.models.user import Profile

        actions = union_all(
            select(
                ExtractionReviewerDecision.reviewer_id.label("actor_id"),
                ExtractionReviewerDecision.created_at.label("at"),
            )
            .join(ExtractionRun, ExtractionRun.id == ExtractionReviewerDecision.run_id)
            .where(ExtractionRun.project_id == project_id),
            select(
                ExtractionConsensusDecision.consensus_user_id,
                ExtractionConsensusDecision.created_at,
            )
            .join(ExtractionRun, ExtractionRun.id == ExtractionConsensusDecision.run_id)
            .where(ExtractionRun.project_id == project_id),
        ).subquery()
        rows = (
            await self.db.execute(
                select(actions.c.actor_id, func.min(actions.c.at), Profile.full_name, Profile.email)
                .outerjoin(Profile, Profile.id == actions.c.actor_id)
                .group_by(actions.c.actor_id, Profile.full_name, Profile.email)
            )
        ).tuples()
        return label_raters(rows, anonymize=anonymize, named_only=named_only)

    async def _list_reviewers_for_runs(
        self, *, run_ids: list[UUID], labels: Mapping[UUID, str]
    ) -> tuple[tuple[ReviewerDescriptor, ...], dict[UUID, tuple[UUID, ...]]]:
        """Distinct reviewers with >= 1 non-reject current decision on the run
        set, and per run the reviewers that qualify there (R16). Both follow
        the order of ``labels`` (Member-letter order), which names them."""
        if not run_ids:
            return (), {}

        rows = (
            await self.db.execute(
                select(ExtractionReviewerState.reviewer_id, ExtractionReviewerState.run_id)
                .join(
                    ExtractionReviewerDecision,
                    ExtractionReviewerState.current_decision_id == ExtractionReviewerDecision.id,
                )
                .where(
                    ExtractionReviewerState.run_id.in_(run_ids),
                    ExtractionReviewerDecision.decision != "reject",
                )
                .distinct()
            )
        ).all()

        runs_of: dict[UUID, set[UUID]] = {}
        for rid, run_id in rows:
            runs_of.setdefault(run_id, set()).add(rid)
        rater_ids = set().union(*runs_of.values())
        reviewers = tuple(
            ReviewerDescriptor(reviewer_id=rid, display_label=label)
            for rid, label in labels.items()
            if rid in rater_ids
        )
        by_run = {
            run_id: tuple(r.reviewer_id for r in reviewers if r.reviewer_id in rids)
            for run_id, rids in runs_of.items()
        }
        return reviewers, by_run

    # ==================================================================
    # Cell loaders (D10): every export value is read from one of these two
    # ==================================================================

    async def _load_reviewer_cells(
        self, *, run_ids: list[UUID], reviewer_ids: Sequence[UUID] | None
    ) -> dict[ValueKey, CellRecord]:
        """Each reviewer's CURRENT decision with its linked proposal, keyed by
        ``reviewer_id`` (R1). Rejects stay in; ``None`` means every reviewer."""
        if not run_ids:
            return {}
        st, d, p = ExtractionReviewerState, ExtractionReviewerDecision, ExtractionProposalRecord
        stmt = (
            select(st.run_id, st.instance_id, st.field_id, st.reviewer_id)
            .add_columns(d.id, d.decision, d.created_at, d.rationale, d.value)
            .add_columns(p.id, p.run_id, p.source, p.proposed_value)
            .join(d, st.current_decision_id == d.id)
            .outerjoin(p, d.proposal_record_id == p.id)
            .where(st.run_id.in_(run_ids))
        )
        if reviewer_ids is not None:
            stmt = stmt.where(st.reviewer_id.in_(reviewer_ids))
        out: dict[ValueKey, CellRecord] = {}
        for row in (await self.db.execute(stmt)).all():
            rid, iid, fid, reviewer, did, kind, at, rationale, value, pid, prun, src, pval = row
            out[value_key(rid, iid, fid, reviewer)] = CellRecord(
                envelope=resolve_reviewer_value(kind, value, pval),
                decision=DecisionFact(did, kind, reviewer, at, rationale, None),
                linked_proposal=_linked(pid, prun, src, pval),
            )
        return out

    async def _load_consensus_cells(self, *, run_ids: list[UUID]) -> dict[ValueKey, CellRecord]:
        """Every published state, with the coordinate's latest consensus decision
        and the SELECTED decision's own proposal link (D10). A state with no
        decision (legacy synthetic runs) reads as a ``manual_override`` by its
        publisher, so no published value is dropped."""
        if not run_ids:
            return {}
        c, d, p = ExtractionConsensusDecision, ExtractionReviewerDecision, ExtractionProposalRecord
        latest = aliased(
            c,
            select(c)
            .where(c.run_id.in_(run_ids))
            .distinct(c.run_id, c.instance_id, c.field_id)
            .order_by(c.run_id, c.instance_id, c.field_id, c.created_at.desc(), c.id.desc())
            .subquery(),
        )
        ps = ExtractionPublishedState
        stmt = (
            select(ps.id, ps.run_id, ps.instance_id, ps.field_id, ps.value)
            .add_columns(ps.published_by, ps.published_at, latest.id, latest.mode)
            .add_columns(latest.consensus_user_id, latest.created_at, latest.rationale)
            .add_columns(latest.selected_decision_id, p.id, p.run_id, p.source, p.proposed_value)
            .outerjoin(
                latest,
                (latest.run_id == ps.run_id)
                & (latest.instance_id == ps.instance_id)
                & (latest.field_id == ps.field_id),
            )
            .outerjoin(d, latest.selected_decision_id == d.id)
            .outerjoin(p, d.proposal_record_id == p.id)
            .where(ps.run_id.in_(run_ids))
        )
        out: dict[ValueKey, CellRecord] = {}
        for row in (await self.db.execute(stmt)).all():
            sid, rid, iid, fid, value, by, at, did, mode, actor, created, why, sel = row[:13]
            decision = (
                DecisionFact(sid, "manual_override", by, at, None, None)
                if did is None
                else DecisionFact(did, mode, actor, created, why, sel)
            )
            out[value_key(rid, iid, fid)] = CellRecord(
                envelope=value, decision=decision, linked_proposal=_linked(*row[13:])
            )
        return out

    async def _load_orphan_fields(
        self, *, template_id: UUID, field_ids: Collection[UUID]
    ) -> dict[UUID, FieldDescriptor]:
        """Minimal descriptors for fields no loaded version holds (D10). The
        field FK is RESTRICT, so a live row exists for every stored value."""
        if not field_ids:
            return {}
        f, et = ExtractionField, ExtractionEntityType
        rows = await self.db.execute(
            select(f.id, f.label, f.field_type, f.unit)
            .join(et, et.id == f.entity_type_id)
            .where(f.id.in_(field_ids), et.project_template_id == template_id)
        )
        return {
            fid: FieldDescriptor(fid, label, ExtractionFieldType(ftype), (), unit=unit)
            for fid, label, ftype, unit in rows.all()
        }

    # ------------------------------------------------------------------
    # AI metadata sheet loader (FR-036 – FR-040)
    # ------------------------------------------------------------------

    async def _load_ai_proposal_rows(
        self,
        *,
        articles: tuple[ArticleDescriptor, ...],
        sections: tuple[SectionDescriptor, ...],
        value_map: dict[ValueKey, ExportValue],
        mode: ExportMode,
        target_reviewer_id: UUID | None,
        labels: OptionLabels,
    ) -> tuple[AIProposalRow, ...]:
        """Load every AI proposal for the in-scope runs into flat rows.

        Three bulk queries, regardless of article count:
          1. proposal_records (source='ai')
          2. evidence linked by proposal_record_id
          3. reviewer_states + decisions for the same (run, instance, field)
             coordinates (to compute the ``Reviewer outcome`` column).
        """
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
        # Descriptor lookup: the AI value columns type against the same fields.
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
        # ExtractionProposalRepository.latest_by_field ordering so the
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
                    ExtractionProposalRecord,
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
        for pid, rid, iid, fid, *_rest in proposal_rows:
            latest_id_per_key.setdefault((rid, iid, fid), pid)

        # 2. Evidence — one bulk query, summarized per proposal.
        evidence_by_pid = await load_evidence_summaries(self.db, [row[0] for row in proposal_rows])

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
        # "Instance #" 1..N. The index is per SIBLING GROUP, which is what
        # `section_instances` always gave a study section; children used to
        # be numbered 1..N over the flat tuple instead — 1..12 for a CHARMS
        # article with two models, which named nothing.
        instance_index_by_id: dict[UUID, int] = {}
        for article in articles:
            for ids in article.entries.values():
                for idx, iid in enumerate(ids, start=1):
                    instance_index_by_id[iid] = idx

        # 6. In-scope run versions feed the label-fallback chain below.
        run_stmt = select(ExtractionRun).where(ExtractionRun.id.in_(run_ids))
        run_by_id = {r.id: r for r in (await self.db.execute(run_stmt)).scalars().all()}

        # Label-fallback CHAIN (B-3a): anchor sections -> the RUN's pinned
        # snapshot -> live tables -> "(unknown ...)". An instance belongs to
        # its run's pinned version, not the anchor, so a section or field
        # removed after the run finalized must resolve from that version
        # before the live table (which may have lost the row entirely).
        section_label_by_entity: dict[UUID, str] = {}
        run_field_labels: dict[UUID, str] = {}
        for vid in {r.version_id for r in run_by_id.values()}:
            for section in await load_export_sections(self.db, version_id=vid):
                section_label_by_entity.setdefault(section.entity_type_id, section.label)
                for snap_field in section.fields:
                    run_field_labels.setdefault(snap_field.field_id, snap_field.label)
        for fid, label in run_field_labels.items():
            field_label_by_id.setdefault(fid, label)

        missing_entity_ids = {
            etid for etid, _aid in instance_meta.values()
        } - section_label_by_entity.keys()
        if missing_entity_ids:
            ent_label_rows = (
                await self.db.execute(
                    select(ExtractionEntityType.id, ExtractionEntityType.label).where(
                        ExtractionEntityType.id.in_(missing_entity_ids)
                    )
                )
            ).all()
            for etid, label in ent_label_rows:
                section_label_by_entity.setdefault(etid, label)

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
        for (
            pid,
            rid,
            iid,
            fid,
            proposed_value,
            confidence,
            rationale,
            ts,
            proposal,
        ) in proposal_rows:
            article = articles_by_run.get(rid)
            run = run_by_id.get(rid)
            if article is None or run is None:
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
            field = field_desc_by_id.get(fid) or _untyped_field(fid)
            final = value_map.get(value_key(rid, iid, fid, primary_rater(mode, target_reviewer_id)))
            evidence_text, evidence_pages = evidence_by_pid.get(pid, ("", ""))
            row = AIProposalRow(
                article_label=article.article_label,
                section_label=section_label,
                instance_index=instance_index_by_id.get(iid, 1),
                field_label=field_label_by_id.get(fid, "(unknown field)"),
                ai_proposed_value=display_value(
                    to_export_value(proposed_value, field, labels), field
                ),
                confidence=float(confidence) if confidence is not None else None,
                rationale=rationale,
                evidence_text=evidence_text,
                evidence_pages=evidence_pages,
                proposed_at=ts,
                model_used=proposal_model_used(proposal),
                reviewer_outcome=outcome,
                final_value_used=None if final is None else display_value(final, field),
            )
            out.append(row)

        return tuple(out)


# ----------------------------------------------------------------------
# Module-level pure helpers
# ----------------------------------------------------------------------


def _linked(
    proposal_id: UUID | None, run_id: UUID | None, source: str | None, proposed: Any
) -> LinkedProposal | None:
    if proposal_id is None or run_id is None or source is None:
        return None
    return LinkedProposal(proposal_id, run_id, source, proposed)


def _untyped_field(field_id: UUID) -> FieldDescriptor:
    """A proposal's field outside the active sections; drops the envelope unit
    until PR5 rewrites the AI sheet and deletes this (R15, R19)."""
    return FieldDescriptor(
        field_id=field_id, label="", type=ExtractionFieldType.TEXT, allowed_values=()
    )


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


#: Lowercase surname particles: a trailing "<particle...> <Name>" run is all
#: surname ("De Feo", "van der Berg").
# fmt: off
_SURNAME_PARTICLES = frozenset({
    "de", "del", "della", "der", "den", "da", "das", "dos", "di", "du", "van", "von",
    "la", "le", "lo", "ter", "ten", "af", "av", "bin", "ibn", "al",
})
# fmt: on


def _extract_surname(first_author: str) -> str:
    """Publication-style surname keeping particles: "Carlo De Feo" → "De Feo";
    "van der Berg, Anna" → "van der Berg" (the text before a comma)."""
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


def _base_label(
    title: str | None,
    authors: list[str] | None,
    year: int | None,
    article_id: UUID,
) -> str:
    """The label "Surname Year" (particle-aware), else the surname, else
    ``title[:60]``, else the short id."""
    surname = _extract_surname(authors[0] or "") if authors else ""
    if surname:
        return f"{surname} {year}" if year is not None else surname
    return title[:60] if title else short_id(article_id)


def _suffix_labels(rows: Sequence[tuple[UUID, str, datetime]]) -> dict[UUID, str]:
    """D2: in ``(created_at, id)`` order the first of a label keeps it bare;
    later ones append ``b``, ``c``, … so a label is stable once it appears."""
    seen: dict[str, int] = {}
    out: dict[UUID, str] = {}
    for aid, label, _ in sorted(rows, key=lambda r: (r[2], str(r[0]))):
        n = seen.get(label, 0)
        seen[label] = n + 1
        out[aid] = label + letter_for(n).lower() if n else label
    return out


__all__ = [
    "ArticleDescriptor",
    "ExportLayout",
    "ExportMode",
    "OmittedArticle",
    "ExtractionExportService",
    "FieldDescriptor",
    "ReviewerDescriptor",
    "SectionDescriptor",
    "AppError",
    "ExtractionCardinality",
]

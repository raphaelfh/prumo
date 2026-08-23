"""
Extraction Models.

Modelos for templates de extraction, entidades, fields,
instances, valores and suggestions de IA.
"""

from datetime import datetime
from enum import Enum as PyEnum
from typing import TYPE_CHECKING, Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, BaseModel, PostgreSQLEnumType, UUIDMixin
from app.models.extraction_versioning import TemplateKind

if TYPE_CHECKING:
    pass


class ExtractionFramework(str, PyEnum):
    """Framework de extraction de data."""

    CHARMS = "CHARMS"
    PICOS = "PICOS"
    CUSTOM = "CUSTOM"


class ExtractionFieldType(str, PyEnum):
    """Tipo de field de extraction."""

    TEXT = "text"
    NUMBER = "number"
    DATE = "date"
    SELECT = "select"
    MULTISELECT = "multiselect"
    BOOLEAN = "boolean"


class ExtractionCardinality(str, PyEnum):
    """Cardinalidade da entidade."""

    ONE = "one"
    MANY = "many"


# Default entry noun of a model_container when none was authored (B-8 seeded
# "model"): the AI instance label, the export record stem and the portable
# importer all fall back to it, so it lives here once.
DEFAULT_ENTRY_LABEL = "model"


class ExtractionEntityRole(str, PyEnum):
    """Structural role of an entity type within a template.

    Replaces the previous convention of identifying the "prediction models"
    container by ``name='prediction_models'`` (a magic string scattered
    across services and the frontend). The role makes the structural
    intent first-class in the schema:

    * ``STUDY_SECTION`` — root entity type (``parent_entity_type_id IS NULL``).
      Rendered as a top-level accordion, filled once per article.
    * ``MODEL_CONTAINER`` — root, ``cardinality='many'``. Drives the
      model selector UI. At most one per template (enforced by partial
      unique index).
    * ``MODEL_SECTION`` — child of a ``MODEL_CONTAINER``. Rendered once
      per model instance; only meaningful when a model is active.

    Database CHECK constraints enforce parent/role coherence (see
    migration ``0016_entity_role_column``).
    """

    STUDY_SECTION = "study_section"
    MODEL_CONTAINER = "model_container"
    MODEL_SECTION = "model_section"


class ExtractionRunStage(str, PyEnum):
    """Stage of the extraction execution (HITL lifecycle)."""

    PENDING = "pending"
    EXTRACT = "extract"
    CONSENSUS = "consensus"
    FINALIZED = "finalized"
    CANCELLED = "cancelled"


class ExtractionRunStatus(str, PyEnum):
    """Status da execucao de extraction."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ExtractionTemplateGlobal(BaseModel):
    """
    Template global de extraction (CHARMS, PICOS, etc.).

    Templates globais sao compartilhados entre projects.
    """

    __tablename__ = "extraction_templates_global"

    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    framework: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_framework"),
        nullable=False,
    )
    version: Mapped[str] = mapped_column(String, default="1.0.0", nullable=False)

    kind: Mapped[str] = mapped_column(
        PostgreSQLEnumType("template_kind"),
        nullable=False,
        default=TemplateKind.EXTRACTION.value,
        server_default=TemplateKind.EXTRACTION.value,
    )

    is_global: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    schema_: Mapped[dict[str, Any]] = mapped_column("schema", JSONB, default={}, nullable=False)

    llm_template_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    entity_types: Mapped[list["ExtractionEntityType"]] = relationship(
        "ExtractionEntityType",
        back_populates="global_template",
        foreign_keys="ExtractionEntityType.template_id",
    )

    # Indices definidos via __table_args__
    __table_args__ = (
        Index("idx_extraction_templates_global_schema_gin", "schema", postgresql_using="gin"),
        UniqueConstraint("id", "kind", name="uq_extraction_templates_global_id_kind"),
        # SHORT name: the 'ck' naming convention (base.py) expands it to
        # ck_extraction_templates_global_llm_instruction_len; a pre-expanded
        # ck_ literal would double-wrap and md5-truncate.
        CheckConstraint(
            "char_length(llm_template_instruction) <= 4000",
            name="llm_instruction_len",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionTemplateGlobal {self.name}>"


class ProjectExtractionTemplate(BaseModel):
    """
    Template de extraction clonado and customizado por project.

    Indices:
    - project_id: FK indexada
    - schema: GIN for busca em JSONB
    """

    __tablename__ = "project_extraction_templates"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    global_template_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_templates_global.id", ondelete="SET NULL"),
        nullable=True,
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    framework: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_framework"),
        nullable=False,
    )
    version: Mapped[str] = mapped_column(String, default="1.0.0", nullable=False)

    kind: Mapped[str] = mapped_column(
        PostgreSQLEnumType("template_kind"),
        nullable=False,
        default=TemplateKind.EXTRACTION.value,
        server_default=TemplateKind.EXTRACTION.value,
    )

    schema_: Mapped[dict[str, Any]] = mapped_column("schema", JSONB, default={}, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    llm_template_instruction: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Slice B-4: stamped by DB triggers on any live config write
    # (extraction_entity_types / extraction_fields — the editor writes
    # via PostgREST until B-7, so the DB is the only chokepoint);
    # cleared ONLY inside TemplateVersionService.republish's locked
    # section. NULL = live == published intent.
    config_draft_since: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    config_draft_by: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    """Who holds the ADVISORY editor lock on the open draft (B-9f).

    ``SET NULL``, deliberately not ``created_by``'s ``RESTRICT``: deleting a
    profile must never strand a template behind a lock nobody can release.

    Set by the SERVICE on every config write, never by the 0048 triggers —
    those run on an asyncpg session that sets no ``request.jwt.*``, so
    ``auth.uid()`` is NULL there and a trigger cannot know the actor.

    NULL while ``config_draft_since`` is set is a REAL state, not a bug: a
    draft opened before this column existed, or one opened by a raw
    PostgREST write back when that grant existed (0054 revoked it). It
    reads as "unattributed" and is claimable by the next writer."""

    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Relationships
    entity_types: Mapped[list["ExtractionEntityType"]] = relationship(
        "ExtractionEntityType",
        back_populates="project_template",
        foreign_keys="ExtractionEntityType.project_template_id",
    )
    instances: Mapped[list["ExtractionInstance"]] = relationship(
        "ExtractionInstance",
        back_populates="template",
    )

    # Indices definidos via __table_args__
    __table_args__ = (
        Index("idx_project_extraction_templates_schema_gin", "schema", postgresql_using="gin"),
        UniqueConstraint("id", "kind", name="uq_project_extraction_templates_id_kind"),
        # SHORT name — expands to ck_project_extraction_templates_llm_instruction_len.
        CheckConstraint(
            "char_length(llm_template_instruction) <= 4000",
            name="llm_instruction_len",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ProjectExtractionTemplate {self.name}>"


class ExtractionEntityType(BaseModel):
    """
    Tipo de entidade definida nos templates (dataset, model, etc.).
    """

    __tablename__ = "extraction_entity_types"

    # FK mutuamente exclusiva - or template global or template de project
    template_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_templates_global.id", ondelete="CASCADE"),
        nullable=True,
    )

    project_template_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.project_extraction_templates.id", ondelete="CASCADE"),
        nullable=True,
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Group entry noun interpolated into config-editor/run-view copy;
    # meaningful only for role='model_container' rows, seeded "model" (B-8).
    entry_label: Mapped[str | None] = mapped_column(String, nullable=True)

    parent_entity_type_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_entity_types.id", ondelete="CASCADE"),
        nullable=True,
    )

    cardinality: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_cardinality"),
        default="one",
        nullable=False,
    )

    # Structural discriminant — see ``ExtractionEntityRole``. Replaces the
    # legacy practice of identifying the model container by
    # ``name='prediction_models'``.
    role: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_entity_role"),
        default=ExtractionEntityRole.STUDY_SECTION.value,
        # No server_default: migration 0016 step 4 removed it so an INSERT that
        # omits `role` fails loudly rather than silently defaulting to
        # study_section. Keep the Python-side `default` for ORM inserts.
        nullable=False,
    )

    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Relationships
    global_template: Mapped["ExtractionTemplateGlobal | None"] = relationship(
        "ExtractionTemplateGlobal",
        back_populates="entity_types",
        foreign_keys=[template_id],
    )
    project_template: Mapped["ProjectExtractionTemplate | None"] = relationship(
        "ProjectExtractionTemplate",
        back_populates="entity_types",
        foreign_keys=[project_template_id],
    )
    fields: Mapped[list["ExtractionField"]] = relationship(
        "ExtractionField",
        back_populates="entity_type",
        cascade="all, delete-orphan",
    )
    parent: Mapped["ExtractionEntityType | None"] = relationship(
        "ExtractionEntityType",
        remote_side="ExtractionEntityType.id",
        foreign_keys=[parent_entity_type_id],
    )

    # These four DB invariants exist in the schema (baseline + 0016) but were
    # absent from the ORM, so `alembic revision --autogenerate` would emit DROPs
    # for them (silently un-guarding the role model). Declaring them here keeps
    # the model the source of truth. The deferred `model_section`-under-
    # `model_container` trigger (0016 step 7) can't live in __table_args__ and
    # stays migration-only. (#93)
    __table_args__ = (
        CheckConstraint(
            "(template_id IS NULL) <> (project_template_id IS NULL)",
            name="ck_extraction_entity_types_template_xor",
        ),
        CheckConstraint(
            "(role IN ('study_section', 'model_container') AND parent_entity_type_id IS NULL)"
            " OR (role = 'model_section' AND parent_entity_type_id IS NOT NULL)",
            name="ck_extraction_entity_types_role_parent",
        ),
        Index(
            "uq_extraction_entity_types_one_container_per_global",
            "template_id",
            unique=True,
            postgresql_where=text("role = 'model_container' AND template_id IS NOT NULL"),
        ),
        Index(
            "uq_extraction_entity_types_one_container_per_project",
            "project_template_id",
            unique=True,
            postgresql_where=text("role = 'model_container' AND project_template_id IS NOT NULL"),
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionEntityType {self.name}>"


class ExtractionField(BaseModel):
    """
    Campo especifico de cada tipo de entidade.
    """

    __tablename__ = "extraction_fields"

    entity_type_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_entity_types.id", ondelete="CASCADE"),
        nullable=False,
    )

    name: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    field_type: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_field_type"),
        nullable=False,
    )

    is_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    validation_schema: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, default={}, nullable=True
    )
    allowed_values: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    unit: Mapped[str | None] = mapped_column(String, nullable=True)
    allowed_units: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Descricao for LLM
    llm_description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # "Other" option support for select/multiselect fields
    allow_other: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    other_label: Mapped[str | None] = mapped_column(String, nullable=True)
    other_placeholder: Mapped[str | None] = mapped_column(String, nullable=True)

    # Opt-in "no value, on purpose" dispositions (ADR-0016). ``no_information`` is
    # universal (any source can be silent) so it needs no flag; these two are
    # per-field opt-ins for signaling-question style fields (PROBAST/CHARMS) and
    # drive the runtime FieldInput affordance + the frozen version snapshot.
    allows_not_applicable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    allows_not_evaluated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    # Relationships
    entity_type: Mapped["ExtractionEntityType"] = relationship(
        "ExtractionEntityType",
        back_populates="fields",
    )

    # Per-section name uniqueness (B-7, migration 0050). Declared as a
    # NAMED unique Index — not a UniqueConstraint — with the exact name
    # of the migration's CREATE UNIQUE INDEX, so autogenerate emits no
    # spurious diffs; the tuple must end with the schema dict (#93).
    __table_args__ = (
        Index(
            "uq_extraction_fields_entity_type_name",
            "entity_type_id",
            "name",
            unique=True,
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionField {self.name}>"


class ExtractionInstance(BaseModel):
    """
    Instancia especifica de entidade for cada article.

    Indices:
    - project_id, article_id, template_id: FKs indexadas
    - (article_id, entity_type_id, sort_order): busca ordenada
    - metadata: GIN for busca em JSONB
    """

    __tablename__ = "extraction_instances"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    article_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.articles.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    template_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.project_extraction_templates.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    entity_type_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_entity_types.id", ondelete="RESTRICT"),
        nullable=False,
    )

    parent_instance_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_instances.id", ondelete="CASCADE"),
        nullable=True,
    )

    label: Mapped[str] = mapped_column(String, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, default={}, nullable=False)

    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    is_template: Mapped[bool | None] = mapped_column(Boolean, default=False, nullable=True)

    # Relationships
    template: Mapped["ProjectExtractionTemplate"] = relationship(
        "ProjectExtractionTemplate",
        back_populates="instances",
    )

    # Indices definidos via __table_args__
    __table_args__ = (
        # Indice composto for busca ordenada por article
        Index(
            "idx_extraction_instances_article_entity_sort",
            "article_id",
            "entity_type_id",
            "sort_order",
        ),
        # Indice GIN for metadata
        Index("idx_extraction_instances_metadata_gin", "metadata", postgresql_using="gin"),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionInstance {self.label}>"


class ExtractionEvidence(BaseModel):
    """
    Evidencias que suportam valores extraidos or instances.

    Indices:
    - project_id, article_id: FKs indexadas
    - position: GIN for busca em JSONB
    """

    __tablename__ = "extraction_evidence"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    article_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.articles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    article_file_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.article_files.id", ondelete="SET NULL"),
        nullable=True,
    )

    run_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_runs.id", ondelete="CASCADE"),
        nullable=True,
    )
    # CASCADE, not SET NULL: evidence points at exactly one workflow target,
    # so nulling it can never satisfy the workflow_target_present CHECK —
    # the row follows its target (migration 0044).
    proposal_record_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_proposal_records.id", ondelete="CASCADE"),
        nullable=True,
    )
    reviewer_decision_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_reviewer_decisions.id", ondelete="CASCADE"),
        nullable=True,
    )
    consensus_decision_id: Mapped[UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_consensus_decisions.id", ondelete="CASCADE"),
        nullable=True,
    )

    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default={}, nullable=True)
    text_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    attribution_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    rank: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # order of an evidence span within its proposal (0 = primary/first; LLM order)

    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Indices definidos via __table_args__
    __table_args__ = (
        # Indice GIN for position JSONB
        Index("idx_extraction_evidence_position_gin", "position", postgresql_using="gin"),
        CheckConstraint(
            """
            run_id IS NOT NULL
            AND (
                proposal_record_id IS NOT NULL
                OR reviewer_decision_id IS NOT NULL
                OR consensus_decision_id IS NOT NULL
            )
            """,
            name="workflow_target_present",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionEvidence run={self.run_id}>"


class ExtractionRun(Base, UUIDMixin):
    """
    Execucao de IA for sugerir valores de extraction.

    Indices:
    - project_id, article_id, template_id: FKs indexadas
    - (status, stage): busca por status de execucao
    - parameters, results: GIN for busca em JSONB
    """

    __tablename__ = "extraction_runs"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    article_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.articles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    template_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.project_extraction_templates.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    kind: Mapped[str] = mapped_column(
        PostgreSQLEnumType("template_kind"),
        nullable=False,
        default=TemplateKind.EXTRACTION.value,
        server_default=TemplateKind.EXTRACTION.value,
    )

    version_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.extraction_template_versions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    hitl_config_snapshot: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default="{}",
    )

    stage: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_run_stage"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        PostgreSQLEnumType("extraction_run_status"),
        default="pending",
        nullable=False,
    )

    parameters: Mapped[dict[str, Any]] = mapped_column(JSONB, default={}, nullable=False)
    results: Mapped[dict[str, Any]] = mapped_column(JSONB, default={}, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Indices definidos via __table_args__
    __table_args__ = (
        # Indice composto for busca por status and estagio
        Index("idx_extraction_runs_status_stage", "status", "stage"),
        # Indices GIN for JSONB
        Index("idx_extraction_runs_parameters_gin", "parameters", postgresql_using="gin"),
        Index("idx_extraction_runs_results_gin", "results", postgresql_using="gin"),
        # One-live-run invariant (migration 0045): at most ONE non-terminal
        # (pending/extract/consensus) run per (project, article, template,
        # kind). A second live run silently shadows the first one's reviewer
        # decisions on session open — the run-orphaning data-loss bug. Writers
        # go through RunLifecycleService.resolve_or_create_extract_run (or the
        # session opener), which reuses the live run under the (article,
        # template) advisory lock; this index is the DB-level backstop.
        # ``kind`` is implied by template_id (composite FK below) — included
        # for intent + planner support.
        Index(
            "uq_one_live_extraction_run_per_coord",
            "project_id",
            "article_id",
            "template_id",
            "kind",
            unique=True,
            postgresql_where=text("stage IN ('pending', 'extract', 'consensus')"),
        ),
        ForeignKeyConstraint(
            ["template_id", "kind"],
            [
                "public.project_extraction_templates.id",
                "public.project_extraction_templates.kind",
            ],
            name="fk_extraction_runs_template_kind_coherence",
            ondelete="CASCADE",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ExtractionRun {self.id} stage={self.stage}>"

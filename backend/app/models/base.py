"""
SQLAlchemy Base Model.

Set a classe base for todos os modelos ORM.
Inclui mixins comuns como timestamps and UUID primary keys.
Inclui PostgreSQLEnumType for mapeamento correto de ENUMs PostgreSQL.
"""

from datetime import datetime
from enum import Enum as PyEnum
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, MetaData, String, TypeDecorator, func
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column

# =============================================================================
# MAPEAMENTO DE ENUMS POSTGRESQL
# =============================================================================
# Fonte da verdade: supabase/migrations/0002_enums.sql
# Cada key e o nome do tipo ENUM in the PostgreSQL,
# and o valor e a lista de valores permitidos.
# =============================================================================

POSTGRESQL_ENUM_VALUES: dict[str, list[str]] = {
    # Project enums
    "review_type": [
        "interventional",
        "predictive_model",
        "diagnostic",
        "prognostic",
        "qualitative",
        "other",
    ],
    "project_member_role": ["manager", "reviewer", "viewer", "consensus"],
    # File enums
    "file_role": ["MAIN", "SUPPLEMENT", "PROTOCOL", "DATASET", "APPENDIX", "FIGURE", "OTHER"],
    # Extraction enums
    "extraction_framework": ["CHARMS", "PICOS", "CUSTOM"],
    "extraction_field_type": ["text", "number", "date", "select", "multiselect", "boolean"],
    "extraction_cardinality": ["one", "many"],
    "extraction_source": ["human", "ai", "rule"],
    "extraction_run_stage": [
        "pending",
        "proposal",
        "review",
        "consensus",
        "finalized",
        "cancelled",
    ],
    "extraction_run_status": ["pending", "running", "completed", "failed"],
    "suggestion_status": ["pending", "accepted", "rejected"],
    "extraction_instance_status": ["pending", "in_progress", "completed", "reviewed", "archived"],
    # Extraction versioning + HITL config enums
    "hitl_config_scope_kind": ["project", "template"],
    "consensus_rule": ["unanimous", "majority", "arbitrator"],
    "template_kind": ["extraction", "quality_assessment"],
    "extraction_proposal_source": ["ai", "human", "system"],
    "extraction_reviewer_decision": ["accept_proposal", "reject", "edit"],
    "extraction_consensus_mode": ["select_existing", "manual_override"],
}


class PostgreSQLEnumType(TypeDecorator):
    """
    TypeDecorator que forca o uso correto do tipo ENUM nativo do PostgreSQL.

    Este TypeDecorator resolve o problema de casting ::VARCHAR que ocorre
    with asyncpg + SQLAlchemy quando se usa Enum do Python diretamente.

    Uso:
        # No model
        status: Mapped[str] = mapped_column(
            PostgreSQLEnumType("extraction_run_status"),
            default="pending",
            nullable=False,
        )

    Funcionamento:
        - Em PostgreSQL: usa o tipo ENUM nativo (sem ::VARCHAR)
        - Em outros dialetos: usa String como fallback
        - Aceita tanto string quanto Enum Python como valor

    Args:
        enum_name: Nome do tipo ENUM in the PostgreSQL (deve existir em POSTGRESQL_ENUM_VALUES)

    Raises:
        ValueError: If enum_name is not registered in POSTGRESQL_ENUM_VALUES
    """

    impl = String
    cache_ok = True

    def __init__(self, enum_name: str, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.enum_name = enum_name

        # Buscar valores do mapeamento
        enum_values = POSTGRESQL_ENUM_VALUES.get(enum_name)
        if enum_values is None:
            raise ValueError(
                f"ENUM '{enum_name}' is not registered in POSTGRESQL_ENUM_VALUES. "
                f"Available values: {list(POSTGRESQL_ENUM_VALUES.keys())}"
            )

        # Criar o tipo ENUM PostgreSQL nativo
        self._enum_type = PG_ENUM(
            *enum_values,
            name=enum_name,
            create_type=False,  # Tipo ja criado via migrations Supabase
            native_enum=True,
        )

    def load_dialect_impl(self, dialect: Any) -> Any:
        """Return o tipo apropriado for o dialeto."""
        if dialect.name == "postgresql":
            return self._enum_type
        # Fallback for outros bancos (ex: SQLite em testes)
        return dialect.type_descriptor(String())

    def process_bind_param(self, value: Any, _dialect: Any) -> str | None:
        """Processa o valor antes de enviar ao banco."""
        if value is None:
            return None
        # Se for um Enum Python, pegar o value
        if isinstance(value, PyEnum):
            return value.value
        return str(value)

    def process_result_value(self, value: Any, _dialect: Any) -> str | None:
        """Processa o valor recebido do banco."""
        # Return como string for compatibilidade with Enum Python
        return value


_naming_convention: dict[str, str] = {
    # Use PostgreSQL's default naming scheme for FK/PK/UQ so that autogenerate
    # comparisons against the existing database (which uses PG defaults) produce
    # a clean diff.  New constraints created via Alembic will follow the same
    # convention, keeping names consistent across the schema.
    "ix": "ix_%(column_0_label)s",
    "uq": "%(table_name)s_%(column_0_name)s_key",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "%(table_name)s_%(column_0_name)s_fkey",
    "pk": "%(table_name)s_pkey",
}


class Base(DeclarativeBase):
    """
    Classe base for modelos SQLAlchemy.

    Configuracoes:
    - Naming convention for constraints (deterministic names for Alembic)
    - Default schema: public
    - Type annotations nativas
    """

    metadata = MetaData(naming_convention=_naming_convention)

    # Default schema for all application tables
    __table_args__: dict[str, Any] = {
        "schema": "public",
    }

    @declared_attr.directive
    def __tablename__(cls) -> str:
        """Gera nome da tabela a partir do nome da classe."""
        # CamelCase -> snake_case
        name = cls.__name__
        return "".join(f"_{c.lower()}" if c.isupper() else c for c in name).lstrip("_")


class TimestampMixin:
    """
    Mixin for fields de timestamp.

    Adiciona created_at and updated_at automaticamente.
    """

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class UUIDMixin:
    """
    Mixin for primary key UUID.

    Gera UUID automaticamente.
    """

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )


class BaseModel(Base, UUIDMixin, TimestampMixin):
    """
    Modelo base with UUID and timestamps.

    Use for tabelas que precisam de id, created_at and updated_at.
    """

    __abstract__ = True

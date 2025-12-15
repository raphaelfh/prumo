# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
SQLAlchemy Base Model.

Define a classe base para todos os modelos ORM.
Inclui mixins comuns como timestamps e UUID primary keys.
"""

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column


class Base(DeclarativeBase):
    """
    Classe base para modelos SQLAlchemy.
    
    Configurações:
    - Naming convention para constraints
    - Type annotations nativas
    """
    
    # Naming convention para constraints (facilita migrations)
    __table_args__: dict[str, Any] = {
        "schema": "public",
    }
    
    @declared_attr.directive
    def __tablename__(cls) -> str:
        """Gera nome da tabela a partir do nome da classe."""
        # CamelCase -> snake_case
        name = cls.__name__
        return "".join(
            f"_{c.lower()}" if c.isupper() else c for c in name
        ).lstrip("_")


class TimestampMixin:
    """
    Mixin para campos de timestamp.
    
    Adiciona created_at e updated_at automaticamente.
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
    Mixin para primary key UUID.
    
    Gera UUID automaticamente.
    """
    
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )


class BaseModel(Base, UUIDMixin, TimestampMixin):
    """
    Modelo base com UUID e timestamps.
    
    Use para tabelas que precisam de id, created_at e updated_at.
    """
    
    __abstract__ = True


"""Project-scoped custom LLM endpoint (OpenAI-compatible).

SECRETS TABLE — API-only access. ``encrypted_api_key`` holds a Fernet
ciphertext (per-row derived key, ``derive_encryption_key`` with input
``endpoint:{id}``), so rows must never be readable from PostgREST:
migration 0055 enables RLS with a ``deny_all`` policy and revokes every
privilege from ``authenticated`` / ``anon``. All reads and writes go
through the manager-gated ``/api/v1`` endpoints; the backend connects
with its own role (the table owner, which bypasses RLS).

The service supplies ``id = uuid4()`` before insert (no server default —
the id feeds the per-row key derivation, so it must exist before the
ciphertext is produced). ``encrypted_api_key`` is nullable: keyless
endpoints (e.g. local Ollama) are legal.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import BaseModel

# Status de validacao do probe (Verify button)
ENDPOINT_VALIDATION_STATUSES = ("unverified", "ok", "failed")


class ProjectLlmEndpoint(BaseModel):
    """
    Custom OpenAI-compatible LLM endpoint shared by a project.

    Attributes:
        project_id: Owning project (CASCADE on project delete).
        label: Human-readable name, unique per project.
        base_url: OpenAI-compatible base URL (https, SSRF-guarded).
        encrypted_api_key: Fernet ciphertext; NULL for keyless endpoints.
        allowed_models: Model ids the picker may offer for this endpoint.
        capabilities: Probe findings (output_mode, models_seen, ...).
        validation_status: unverified | ok | failed (last probe outcome).
        last_validated_at: When the last probe ran.
        created_by: Manager who created the endpoint.
    """

    __tablename__ = "project_llm_endpoints"

    project_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    label: Mapped[str] = mapped_column(Text, nullable=False)

    base_url: Mapped[str] = mapped_column(Text, nullable=False)

    encrypted_api_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    allowed_models: Mapped[list[Any]] = mapped_column(
        JSONB,
        server_default=text("'[]'::jsonb"),
        nullable=False,
    )

    capabilities: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        server_default=text("'{}'::jsonb"),
        nullable=False,
    )

    validation_status: Mapped[str] = mapped_column(
        Text,
        server_default="unverified",
        nullable=False,
    )

    last_validated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_by: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("public.profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("project_id", "label", name="uq_llm_endpoint_label"),
        # SHORT name: the ck naming convention wraps it into
        # ck_project_llm_endpoints_llm_ep_vstatus.
        CheckConstraint(
            "validation_status IN ('unverified','ok','failed')",
            name="llm_ep_vstatus",
        ),
        {"schema": "public"},
    )

    def __repr__(self) -> str:
        return f"<ProjectLlmEndpoint project={self.project_id} label={self.label}>"

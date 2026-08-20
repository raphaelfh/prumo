"""Create project_llm_endpoints — the custom-LLM-endpoint secrets table.

C2 slice B1: a project manager can register OpenAI-compatible endpoints
(base URL + optional API key + allowed models) that the whole project
shares. ``encrypted_api_key`` holds a Fernet ciphertext under a per-row
derived key (``derive_encryption_key`` with input ``endpoint:{id}``), so
the id is supplied by the service (uuid4) before insert — no server
default. ``capabilities`` / ``validation_status`` / ``last_validated_at``
record the Verify-probe outcome; ``allowed_models`` is the manager-curated
list the engine picker offers.

RLS posture — deny-all, API-only (secrets table):

- The backend connects with its OWN role, not ``authenticated``
  (0054's rationale), so the REVOKE below cannot break app access; all
  reads and writes go through the manager-gated typed endpoints.
- ``deny_all`` (``FOR ALL USING (false)``, applies to PUBLIC) closes
  every remaining PostgREST path and is what the rls-coverage fitness
  gate's POLICY_RE recognizes. The backend role owns the table and
  owners bypass RLS (no FORCE), so the policy costs the app nothing.
- ``REVOKE ALL ... FROM authenticated, anon`` removes even the ability
  to attempt a statement: unlike the config tables (0054 revoked writes
  but kept SELECT for PostgREST readers), NOTHING may read this table
  from the client — a SELECT would hand out ciphertexts keyed by
  material derived from a server-side secret. Never a policy
  ``TO authenticated``. The probe test
  (``tests/integration/test_llm_endpoint_rls.py``) pins this posture.

Downgrade drops the table; the policy goes with it.

Revision ID: 0055_project_llm_endpoints
Revises: 0054_revoke_config_writes
Create Date: 2026-08-17
"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

from alembic import op

revision = "0055_project_llm_endpoints"
down_revision = "0054_revoke_config_writes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_llm_endpoints",
        # No server default: the service supplies uuid4() so the id can
        # feed the per-row Fernet key derivation before insert.
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.projects.id",
                ondelete="CASCADE",
                name="project_llm_endpoints_project_id_fkey",
            ),
            nullable=False,
        ),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("base_url", sa.Text(), nullable=False),
        sa.Column("encrypted_api_key", sa.Text(), nullable=True),
        sa.Column("allowed_models", JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("capabilities", JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("validation_status", sa.Text(), server_default="unverified", nullable=False),
        sa.Column("last_validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by",
            PG_UUID(as_uuid=True),
            sa.ForeignKey(
                "public.profiles.id",
                ondelete="RESTRICT",
                name="project_llm_endpoints_created_by_fkey",
            ),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("project_id", "label", name="uq_llm_endpoint_label"),
        # SHORT name pre-wrap; the ck naming convention has already been
        # applied in the model, so spell the final name here.
        sa.CheckConstraint(
            "validation_status IN ('unverified','ok','failed')",
            name="ck_project_llm_endpoints_llm_ep_vstatus",
        ),
        schema="public",
    )
    op.create_index(
        "ix_public_project_llm_endpoints_project_id",
        "project_llm_endpoints",
        ["project_id"],
        schema="public",
    )
    op.execute('ALTER TABLE "public"."project_llm_endpoints" ENABLE ROW LEVEL SECURITY;')
    op.execute(
        'CREATE POLICY "deny_all" ON "public"."project_llm_endpoints" FOR ALL USING (false);'
    )
    op.execute('REVOKE ALL ON "public"."project_llm_endpoints" FROM "authenticated", "anon";')


def downgrade() -> None:
    # The deny_all policy and the index are dropped with the table.
    op.drop_table("project_llm_endpoints", schema="public")

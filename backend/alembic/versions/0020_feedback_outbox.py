"""Slim feedback_reports into a Linear store-and-forward outbox.

- Replace old free-form columns (category/message/metadata) with structured
  outbox fields; add `feedback_attachments`.
- Drop the dead in-app-triage columns (status / category / message / metadata)
  — Linear's Triage owns triage now.
- Tighten RLS to service-role only (the client no longer writes this
  table directly; it goes through POST /api/v1/feedback).

Revision ID: 0020_feedback_outbox
Revises: 0019_gate_find_user_id_by_email
Create Date: 2026-05-30
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

revision = "0020_feedback_outbox"
down_revision = "0019_gate_find_user_id_by_email"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- new structured columns on feedback_reports ---
    op.add_column("feedback_reports", sa.Column("type", sa.String(32), nullable=False, server_default="bug"), schema="public")
    op.add_column("feedback_reports", sa.Column("severity", sa.String(16), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("summary", sa.Text(), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("description", sa.Text(), nullable=False, server_default=""), schema="public")
    op.add_column("feedback_reports", sa.Column("url", sa.Text(), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("route", sa.Text(), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("user_agent", sa.Text(), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("viewport_size", JSONB(), nullable=True), schema="public")
    op.add_column(
        "feedback_reports",
        sa.Column("project_id", PG_UUID(as_uuid=True), sa.ForeignKey("public.projects.id", ondelete="SET NULL"), nullable=True),
        schema="public",
    )
    op.add_column(
        "feedback_reports",
        sa.Column("article_id", PG_UUID(as_uuid=True), sa.ForeignKey("public.articles.id", ondelete="SET NULL"), nullable=True),
        schema="public",
    )
    op.add_column("feedback_reports", sa.Column("app_version", sa.String(64), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("linear_issue_id", sa.Text(), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("linear_identifier", sa.String(32), nullable=True), schema="public")
    op.add_column("feedback_reports", sa.Column("linear_url", sa.Text(), nullable=True), schema="public")
    op.add_column(
        "feedback_reports",
        sa.Column("forward_status", sa.String(16), nullable=False, server_default="pending"),
        schema="public",
    )
    op.add_column("feedback_reports", sa.Column("forward_error", sa.Text(), nullable=True), schema="public")
    op.add_column(
        "feedback_reports",
        sa.Column("forwarded_at", sa.DateTime(timezone=True), nullable=True),
        schema="public",
    )
    op.create_check_constraint(
        "feedback_reports_forward_status_check",
        "feedback_reports",
        "forward_status IN ('pending','issue_created','sent','failed')",
        schema="public",
    )

    # Remove server defaults used only to satisfy NOT NULL during backfill
    op.alter_column("feedback_reports", "type", server_default=None, schema="public")
    op.alter_column("feedback_reports", "description", server_default=None, schema="public")

    # --- drop dead triage columns ---
    for col in ("status", "category", "message", "metadata"):
        op.drop_column("feedback_reports", col, schema="public")

    # --- child table ---
    op.create_table(
        "feedback_attachments",
        sa.Column("id", PG_UUID(as_uuid=True), primary_key=True, server_default=sa.func.gen_random_uuid()),
        sa.Column(
            "feedback_report_id",
            PG_UUID(as_uuid=True),
            sa.ForeignKey("public.feedback_reports.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("linear_asset_url", sa.Text(), nullable=True),
        sa.Column("forward_status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("kind IN ('image','video')", name="feedback_attachments_kind_check"),
        sa.CheckConstraint(
            "forward_status IN ('pending','sent','failed')",
            name="feedback_attachments_forward_status_check",
        ),
        schema="public",
    )
    op.create_index(
        "ix_feedback_attachments_report_id",
        "feedback_attachments",
        ["feedback_report_id"],
        schema="public",
    )
    op.execute('ALTER TABLE "public"."feedback_attachments" ENABLE ROW LEVEL SECURITY;')
    op.execute("GRANT ALL ON TABLE public.feedback_attachments TO service_role;")

    # --- tighten RLS on feedback_reports (client no longer writes directly) ---
    op.execute('DROP POLICY IF EXISTS "feedback_reports_insert" ON public.feedback_reports;')
    op.execute('DROP POLICY IF EXISTS "feedback_reports_select_own" ON public.feedback_reports;')
    # service_role bypasses RLS; no permissive policies remain for authenticated/anon.


def downgrade() -> None:
    op.execute('DROP POLICY IF EXISTS "feedback_reports_insert" ON public.feedback_reports;')
    op.execute(
        'CREATE POLICY "feedback_reports_select_own" ON public.feedback_reports '
        "FOR SELECT USING (((user_id = auth.uid()) OR (auth.role() = 'service_role'::text)));"
    )
    op.execute(
        'CREATE POLICY "feedback_reports_insert" ON public.feedback_reports '
        "FOR INSERT WITH CHECK ((user_id = auth.uid()) OR (auth.role() = 'service_role'::text));"
    )

    op.drop_index("ix_feedback_attachments_report_id", table_name="feedback_attachments", schema="public")
    op.drop_table("feedback_attachments", schema="public")

    op.add_column(
        "feedback_reports",
        sa.Column("metadata", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        schema="public",
    )
    op.add_column(
        "feedback_reports",
        sa.Column("message", sa.Text(), nullable=False, server_default=""),
        schema="public",
    )
    op.add_column(
        "feedback_reports",
        sa.Column("category", sa.String(), nullable=False, server_default=""),
        schema="public",
    )
    op.add_column(
        "feedback_reports",
        sa.Column("status", sa.String(), nullable=False, server_default="open"),
        schema="public",
    )

    # Remove temporary server defaults
    op.alter_column("feedback_reports", "message", server_default=None, schema="public")
    op.alter_column("feedback_reports", "category", server_default=None, schema="public")
    op.alter_column("feedback_reports", "status", server_default=None, schema="public")

    op.drop_constraint("ck_feedback_reports_feedback_reports_forward_status_check", "feedback_reports", schema="public")
    for col in (
        "forwarded_at", "forward_error", "forward_status", "linear_url",
        "linear_identifier", "linear_issue_id", "app_version", "article_id",
        "project_id", "viewport_size", "user_agent", "route", "url",
        "description", "summary", "severity", "type",
    ):
        op.drop_column("feedback_reports", col, schema="public")

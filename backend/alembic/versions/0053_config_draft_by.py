"""Advisory editor-lock holder on the config draft (slice B-9f).

``config_draft_by`` records WHO opened the draft that
``config_draft_since`` (0048) already records the existence of. Together
they back the chip's "Draft · started Jul 30 by M. Costa · Take over".

Advisory on purpose. It is a coordination affordance between colleagues,
not an authorization boundary: it arbitrates the typed endpoints, and
0049 deliberately left ``GRANT ALL ... TO authenticated`` on the two
config tables in place (its own docstring names the REVOKE as a separate
follow-up now that B-7 has settled). A manager who bypasses the API with a
raw PostgREST call is the same manager who could drop the template.

``ON DELETE SET NULL``, NOT ``created_by``'s ``RESTRICT``: a deleted
profile must never strand a template behind a lock nobody can release.

Not populated by the 0048 triggers, and they are not touched here. A
trigger cannot know the actor on the typed-endpoint path — the asyncpg
session sets no ``request.jwt.*``, so ``auth.uid()`` is NULL there. The
service sets the holder; the trigger keeps stamping the timestamp and
keeps being the row-lock that serialises edits against republish.

No backfill. Every draft open at deploy time has no recoverable holder, so
it stays NULL and reads as "unattributed" — claimable by the next writer,
with the chip rendering a nameless variant rather than inventing an owner.

Revision ID: 0053_config_draft_by
Revises: 0052_template_version_note
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision = "0053_config_draft_by"
down_revision = "0052_template_version_note"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_extraction_templates",
        sa.Column(
            "config_draft_by",
            pg.UUID(as_uuid=True),
            sa.ForeignKey("public.profiles.id", ondelete="SET NULL"),
            nullable=True,
        ),
        schema="public",
    )


def downgrade() -> None:
    op.drop_column("project_extraction_templates", "config_draft_by", schema="public")

"""Optional per-project restriction on personal access tokens.

``personal_access_tokens.project_ids`` (``uuid[]``, NULL = every project the
token's user belongs to). The CHECK keeps a restriction non-empty and at most
20 entries. No grant change: the table stays deny-all (0078).

``downgrade`` fails closed: it revokes every active restricted token before
dropping the column, so a rollback never turns a project-restricted token into
an all-projects token. Affected users create a new token after re-upgrade.

Revision ID: 0082_pat_project_scope
Revises: 0081_revoke_member_writes
Create Date: 2026-10-14
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision = "0082_pat_project_scope"
down_revision = "0081_revoke_member_writes"
branch_labels = None
depends_on = None

_CHECK = "project_ids_check"  # expands to ck_personal_access_tokens_project_ids_check


def upgrade() -> None:
    op.add_column(
        "personal_access_tokens",
        sa.Column("project_ids", pg.ARRAY(pg.UUID(as_uuid=True)), nullable=True),
        schema="public",
    )
    op.create_check_constraint(
        _CHECK,
        "personal_access_tokens",
        "project_ids IS NULL OR cardinality(project_ids) BETWEEN 1 AND 20",
        schema="public",
    )


def downgrade() -> None:
    # Fail closed: without the column a restricted token would reach every project.
    op.execute(
        "UPDATE public.personal_access_tokens SET revoked_at = now() "
        "WHERE project_ids IS NOT NULL AND revoked_at IS NULL"
    )
    op.drop_constraint(
        op.f(f"ck_personal_access_tokens_{_CHECK}"),
        "personal_access_tokens",
        type_="check",
        schema="public",
    )
    op.drop_column("personal_access_tokens", "project_ids", schema="public")

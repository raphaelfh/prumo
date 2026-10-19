"""Protocol revision counter on projects.

``protocol_revision`` counts changes to a project's review protocol
(eligibility, study design, review type, PICOTS and the "send to AI"
switch). The services bump it inside the row lock they already hold; a
no-op write never bumps.

``integer NOT NULL DEFAULT 1`` plus a CHECK ``>= 1``. No data is written.

Downgrade drops the CHECK and the column.

Revision ID: 0088_protocol_revision
Revises: 0087_template_instrument
"""

import sqlalchemy as sa

from alembic import op

revision = "0088_protocol_revision"
down_revision = "0087_template_instrument"
branch_labels = None
depends_on = None

# SHORT constraint name: the naming convention expands it to
# ck_projects_protocol_revision.
_CONSTRAINT = "protocol_revision"


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column("protocol_revision", sa.Integer(), nullable=False, server_default=sa.text("1")),
        schema="public",
    )
    op.create_check_constraint(_CONSTRAINT, "projects", "protocol_revision >= 1", schema="public")


def downgrade() -> None:
    op.drop_constraint(_CONSTRAINT, "projects", type_="check", schema="public")
    op.drop_column("projects", "protocol_revision", schema="public")

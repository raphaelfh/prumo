"""add check_cardinality_one PostgreSQL function

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-01

Adds check_cardinality_one() — a SECURITY DEFINER function used by the
frontend to validate whether a cardinality='one' instance can be created
before attempting the INSERT.  The function returns TRUE when no existing
instance is found (creation is allowed) and FALSE otherwise.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE
        OR REPLACE FUNCTION check_cardinality_one(
            p_article_id       UUID,
            p_entity_type_id   UUID,
            p_parent_instance_id UUID DEFAULT NULL
        ) RETURNS BOOLEAN
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        BEGIN
            -- Returns TRUE  → creation is allowed (no existing instance)
            -- Returns FALSE → a cardinality=one instance already exists
        RETURN NOT EXISTS (SELECT 1
                           FROM extraction_instances
                           WHERE article_id = p_article_id
                             AND entity_type_id = p_entity_type_id
                             AND (
                               (p_parent_instance_id IS NULL AND parent_instance_id IS NULL)
                                   OR parent_instance_id = p_parent_instance_id
                               ));
        END;
        $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS check_cardinality_one(UUID, UUID, UUID);")

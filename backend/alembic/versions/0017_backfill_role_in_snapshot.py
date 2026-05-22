"""Backfill ``role`` into pre-0016 entity_types inside template version snapshots

Revision ID: 0017_backfill_role_in_snapshot
Revises: 0016_entity_role_column
Create Date: 2026-05-18

``extraction_template_versions.schema_`` stores an immutable JSONB
snapshot of the template's entity_types tree at publish time. Versions
created before migration 0016 have entries without the ``role`` key —
which is silently wrong for any future consumer that partitions a
snapshot by role.

This migration patches the JSONB in-place by joining the snapshot
entity_types (by id) with the live ``extraction_entity_types`` table
and writing back the array with ``role`` filled in. It does NOT
introduce new information — the role is derived from structure that
was already there (parent_entity_type_id + cardinality + name), so
historical accuracy is preserved.

If a snapshot row no longer matches any live entity_type (e.g. the
template was deleted), we leave the snapshot's entry untouched —
versions are append-only audit; we don't fabricate roles for orphaned
data.

The migration is idempotent: re-running it on an already-patched
snapshot is a no-op because ``jsonb_set`` with the same value
produces the same JSONB.

Downgrade is a no-op: we cannot identify which snapshots were patched
by this migration. The patch is information-preserving (derives role
from existing structure), so leaving it in place after downgrade is
safe; future snapshots written by 0016+ already include role.
"""

from alembic import op

revision = "0017_backfill_role_in_snapshot"
down_revision = "0016_entity_role_column"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE public.extraction_template_versions AS v
        SET schema = jsonb_set(
            v.schema,
            '{entity_types}',
            COALESCE(
                (
                    SELECT jsonb_agg(
                        CASE
                            WHEN live.role IS NULL THEN snap_et
                            ELSE jsonb_set(snap_et, '{role}', to_jsonb(live.role::text), true)
                        END
                        ORDER BY (snap_et->>'sort_order')::int NULLS LAST
                    )
                    FROM jsonb_array_elements(v.schema->'entity_types') AS snap_et
                    LEFT JOIN public.extraction_entity_types AS live
                           ON live.id = (snap_et->>'id')::uuid
                ),
                '[]'::jsonb
            ),
            true
        )
        WHERE v.schema ? 'entity_types'
          AND jsonb_array_length(v.schema->'entity_types') > 0
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(v.schema->'entity_types') AS snap_et
              WHERE NOT (snap_et ? 'role')
          )
        """
    )


def downgrade() -> None:
    # No-op: we can't identify which snapshots were patched by this
    # migration. The patch is information-preserving (derives role from
    # existing structure that was already there), so leaving it in place
    # after downgrade is safe — future versions written by 0016+ already
    # include role.
    pass

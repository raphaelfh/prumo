"""One entity_key per coordinate, enforced by the database.

``uq_extraction_instances_entity_key`` is a partial unique index over
``(article_id, entity_type_id, parent_instance_id, metadata->>'entity_key')``
for keyed rows only, ``NULLS NOT DISTINCT`` so root coordinates (no parent)
are covered too.

Before the index is built, existing duplicates are healed: at each
coordinate the oldest holder (``created_at``, then ``id``) keeps the key;
every other holder drops it and appends ``{who, when, from, to: null}`` to
its ``entity_key_history``. The heal is idempotent (a re-run finds nothing
to heal). The table is locked in SHARE ROW EXCLUSIVE mode first so a writer
still running the previous release cannot land a duplicate between the heal
and the index build. The audit prints counts and instance ids only, never
keys or labels.

Downgrade drops the index. The heal is not reversed: keys removed from the
losing holders stay removed, and their history records them.

Revision ID: 0090_entity_key_unique
Revises: 0089_evidence_content_version
"""

import sqlalchemy as sa

from alembic import context, op

revision = "0090_entity_key_unique"
down_revision = "0089_evidence_content_version"
branch_labels = None
depends_on = None

_INDEX = "uq_extraction_instances_entity_key"

_LOCK = "LOCK TABLE public.extraction_instances IN SHARE ROW EXCLUSIVE MODE"

_AUDIT = """
SELECT count(*) AS groups, coalesce(sum(n), 0) - count(*) AS losers
FROM (
    SELECT count(*) AS n
    FROM public.extraction_instances
    WHERE metadata ? 'entity_key'
    GROUP BY article_id, entity_type_id, parent_instance_id, metadata->>'entity_key'
    HAVING count(*) > 1
) dup
"""

_HEAL = """
WITH ranked AS (
    SELECT id, row_number() OVER (
        PARTITION BY article_id, entity_type_id, parent_instance_id, metadata->>'entity_key'
        ORDER BY created_at, id
    ) AS rn
    FROM public.extraction_instances
    WHERE metadata ? 'entity_key'
)
UPDATE public.extraction_instances i
SET metadata = (i.metadata - 'entity_key') || jsonb_build_object(
    'entity_key_history',
    COALESCE(i.metadata->'entity_key_history', '[]'::jsonb) || jsonb_build_array(
        jsonb_build_object(
            'who', 'migration:0090_entity_key_unique',
            'when', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
            'from', i.metadata->>'entity_key',
            'to', NULL
        )
    )
)
FROM ranked r
WHERE r.id = i.id AND r.rn > 1
RETURNING i.id
"""

_CREATE_INDEX = f"""
CREATE UNIQUE INDEX {_INDEX} ON public.extraction_instances
    (article_id, entity_type_id, parent_instance_id, (metadata->>'entity_key'))
    NULLS NOT DISTINCT
    WHERE metadata ? 'entity_key'
"""


def upgrade() -> None:
    op.execute(_LOCK)
    if context.is_offline_mode():
        op.execute(_HEAL)
    else:
        bind = op.get_bind()
        groups, losers = bind.execute(sa.text(_AUDIT)).one()
        print(f"0090_entity_key_unique: {groups} duplicate group(s), {losers} holder(s) to heal")
        healed = [str(row[0]) for row in bind.execute(sa.text(_HEAL))]
        if healed:
            print(f"0090_entity_key_unique: healed instance ids: {', '.join(sorted(healed))}")
    op.execute(_CREATE_INDEX)


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS public.{_INDEX}")

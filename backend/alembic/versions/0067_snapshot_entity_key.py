"""Backfill ``is_entity_key`` into the field objects of stored snapshots.

``is_entity_key`` (0059) became part of the template-version snapshot with
#798, but every snapshot published before that lacks the key in its field
objects, while 0059/0066 stamped the flag on the LIVE rows by name. Read
as "absent means false", such a baseline would report every seeded key as
a phantom unpublished change and — worse — Discard would write the
baseline back and clear the backfilled key, refusing the next AI re-run.

This is the 0017 shape (``role``), one level deeper: join each snapshot
field object to its live row by id and write the live flag in. It is the
only honest source — the key was never versioned before #798, so "the
flag at publish time" is unknowable and the live flag is what every reader
already trusted. Doing it here rather than at read time keeps the diff
engine free of any seed-coordinate list: a key a manager moved by hand
between 0059 and #798 is captured exactly, not approximated.

A field object whose live row is gone is left untouched (versions are
append-only audit; nothing is fabricated), so the reader's canonical
default — absent ≡ false — is the whole remaining era rule.

Idempotent: field objects that already carry the key are skipped by the
outer predicate and re-emitted unchanged. Array order is preserved via
``WITH ORDINALITY``; ``jsonb_set`` on ``{entity_types}`` leaves the
conditional top-level ``llm_template_instruction`` key alone.

Downgrade is a no-op, as 0017's: the patch is information-preserving and
pre-#798 readers ignore the key.

Revision ID: 0067_snapshot_entity_key
Revises: 0066_entity_key_clone_heal
"""

from alembic import op

revision = "0067_snapshot_entity_key"
down_revision = "0066_entity_key_clone_heal"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
UPDATE public.extraction_template_versions AS v
SET schema = jsonb_set(
    v.schema,
    '{entity_types}',
    COALESCE(
        (
            SELECT jsonb_agg(
                jsonb_set(
                    snap_et.et,
                    '{fields}',
                    COALESCE(
                        (
                            SELECT jsonb_agg(
                                CASE
                                    WHEN snap_f.f ? 'is_entity_key' OR live.id IS NULL
                                        THEN snap_f.f
                                    ELSE jsonb_set(
                                        snap_f.f,
                                        '{is_entity_key}',
                                        to_jsonb(live.is_entity_key),
                                        true
                                    )
                                END
                                ORDER BY snap_f.ord
                            )
                            FROM jsonb_array_elements(snap_et.et -> 'fields')
                                 WITH ORDINALITY AS snap_f(f, ord)
                            LEFT JOIN public.extraction_fields AS live
                                   ON live.id = (snap_f.f ->> 'id')::uuid
                        ),
                        '[]'::jsonb
                    ),
                    true
                )
                ORDER BY snap_et.ord
            )
            FROM jsonb_array_elements(v.schema -> 'entity_types')
                 WITH ORDINALITY AS snap_et(et, ord)
        ),
        '[]'::jsonb
    ),
    true
)
WHERE v.schema ? 'entity_types'
  AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v.schema -> 'entity_types') AS snap_et(et)
      CROSS JOIN jsonb_array_elements(snap_et.et -> 'fields') AS snap_f(f)
      WHERE NOT (snap_f.f ? 'is_entity_key')
  )
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    """Intentionally empty — see the module docstring."""

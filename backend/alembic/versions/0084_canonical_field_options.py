"""Every live field's options stored as canonical ``[{value, label}]``.

``extraction_fields.allowed_values`` has held three shapes over time: bare
strings (``["Yes", "No"]``), the ``{"options": [...]}`` wrapper, and
``{value[, label]}`` objects, sometimes mixed in one list. One UPDATE rewrites
every live row (global catalogue and project clones alike) to the one
canonical shape, in element order:

- a non-blank string ``s`` -> ``{"value": s, "label": s}``;
- an object with a non-empty string ``value`` -> that value, its non-empty
  string ``label`` or else the value as the label;
- an object with only a non-empty string ``label`` -> the label as both;
- anything else is dropped, and a list left empty becomes SQL ``NULL``.

These are exactly the labels ``app.llm.claim_value.normalize_options`` derives
for the same input, and option codes never change, so a template whose
published baseline still stores the legacy shape shows no diff row (no
"option renamed") against its migrated live tree. Rows already canonical are
not selected, so the statement is idempotent.

Frozen ``extraction_template_versions.schema`` snapshots are not touched; the
read side keeps normalizing them. The UPDATE runs with
``trg_extraction_fields_mark_draft`` disabled (precedent 0051): a shape-only
rewrite is not a config edit, and leaving the trigger on would stamp
``config_draft_since`` on every project template.

Downgrade is a no-op: the migration is data-only and forward-only, and the
legacy shapes it replaced are still readable, so there is nothing to undo.

Revision ID: 0084_canonical_field_options
Revises: 0083_mcp_oauth
"""

from alembic import op

revision = "0084_canonical_field_options"
down_revision = "0083_mcp_oauth"
branch_labels = None
depends_on = None

_TRIGGER = "trg_extraction_fields_mark_draft"

UPGRADE_SQL = """
WITH legacy AS (
    SELECT f.id,
           CASE WHEN jsonb_typeof(f.allowed_values) = 'array' THEN f.allowed_values
                ELSE f.allowed_values -> 'options' END AS opts
    FROM public.extraction_fields AS f
    WHERE (
        jsonb_typeof(f.allowed_values) = 'object'
        AND jsonb_typeof(f.allowed_values -> 'options') = 'array'
    ) OR (
        jsonb_typeof(f.allowed_values) = 'array'
        AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(f.allowed_values) AS e(elem)
            WHERE NOT coalesce(
                jsonb_typeof(e.elem -> 'value') = 'string' AND e.elem ->> 'value' <> ''
                AND jsonb_typeof(e.elem -> 'label') = 'string' AND e.elem ->> 'label' <> '',
                false
            )
        )
    )
),
canonical AS (
    SELECT l.id,
           (
               SELECT jsonb_agg(o.item ORDER BY o.ord)
               FROM (
                   SELECT e.ord,
                          CASE
                              WHEN jsonb_typeof(e.elem) = 'string'
                                   AND btrim(e.elem #>> '{}') <> ''
                                  THEN jsonb_build_object(
                                      'value', e.elem #>> '{}', 'label', e.elem #>> '{}'
                                  )
                              WHEN jsonb_typeof(e.elem -> 'value') = 'string'
                                   AND e.elem ->> 'value' <> ''
                                  THEN jsonb_build_object(
                                      'value', e.elem ->> 'value',
                                      'label', CASE
                                          WHEN jsonb_typeof(e.elem -> 'label') = 'string'
                                               AND e.elem ->> 'label' <> ''
                                              THEN e.elem ->> 'label'
                                          ELSE e.elem ->> 'value'
                                      END
                                  )
                              WHEN jsonb_typeof(e.elem -> 'label') = 'string'
                                   AND e.elem ->> 'label' <> ''
                                  THEN jsonb_build_object(
                                      'value', e.elem ->> 'label', 'label', e.elem ->> 'label'
                                  )
                          END AS item
                   FROM jsonb_array_elements(l.opts) WITH ORDINALITY AS e(elem, ord)
               ) AS o
               WHERE o.item IS NOT NULL
           ) AS options
    FROM legacy AS l
)
UPDATE public.extraction_fields AS f
SET allowed_values = c.options
FROM canonical AS c
WHERE f.id = c.id
"""


def upgrade() -> None:
    # A shape-only rewrite of every row: keep the 0048 draft marker quiet.
    op.execute(f"ALTER TABLE public.extraction_fields DISABLE TRIGGER {_TRIGGER}")
    op.execute(UPGRADE_SQL)
    op.execute(f"ALTER TABLE public.extraction_fields ENABLE TRIGGER {_TRIGGER}")


def downgrade() -> None:
    # Data-only and forward-only: the legacy shapes are still readable, so
    # there is nothing to undo.
    pass

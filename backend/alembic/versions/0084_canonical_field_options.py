"""Every live field's options stored as canonical ``[{value, label}]``.

``extraction_fields.allowed_values`` has held three shapes over time: bare
strings (``["Yes", "No"]``), the ``{"options": [...]}`` wrapper, and
``{value[, label]}`` objects, sometimes mixed in one list. One UPDATE rewrites
every live row (global catalogue and project clones alike) to the one
canonical shape, in element order:

- a string ``s`` that is not all whitespace -> ``{"value": s, "label": s}``;
- an object with a truthy ``value`` -> ``str(value)``, with ``str(label)`` when
  the label is truthy and the value otherwise (scalars rendered as Python's
  ``str()`` renders them: ``1``, ``1.0``, ``True``); extra keys are dropped;
- an object with only a truthy ``label`` -> ``str(label)`` as both;
- anything else is dropped, and a list left empty becomes SQL ``NULL``.

These are exactly the options ``app.llm.claim_value.normalize_options`` derives
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

#: Characters Python's ``str.strip()`` removes (``str.isspace``), spelled as
#: regex escapes so a bare option made only of them is dropped as Python drops it.
_PY_WHITESPACE = (
    r"[\t\n\u000b\f\r\u001c-\u001f \u0085\u00a0\u1680\u2000-\u200a"
    r"\u2028\u2029\u202f\u205f\u3000]"
)

#: ``str(x)`` of one JSON scalar as Python decodes it, or NULL when Python
#: finds it falsy (``""``, ``0``, ``0.0``, ``false``, ``null``). jsonb prints a
#: number without a ``.`` only for an integer (Python ``int``: the text as is);
#: a ``.`` means a Python ``float``, whose ``repr`` is the shortest round-trip
#: digits — float8's text form with ``extra_float_digits >= 1`` — except that
#: Python keeps fixed notation up to 1e16 (float8 switches at 1e15) and always
#: shows a ``.0`` on an integral value. Magnitudes outside [1e-300, 1e300]
#: keep their text: no option writer produces them, and the float8 cast would
#: raise and block the deploy.
_PY_STR = """
CASE jsonb_typeof({x})
    WHEN 'string' THEN nullif({x} #>> '{{}}', '')
    WHEN 'boolean' THEN CASE WHEN {x} = 'true'::jsonb THEN 'True' END
    WHEN 'number' THEN CASE
        WHEN {x} #>> '{{}}' !~ '[.]' THEN nullif({x} #>> '{{}}', '0')
        WHEN ({x} #>> '{{}}')::numeric = 0 THEN NULL
        WHEN abs(({x} #>> '{{}}')::numeric) NOT BETWEEN 1e-300 AND 1e300
            THEN {x} #>> '{{}}'
        ELSE (
            SELECT CASE WHEN r.t ~ '[.e]' THEN r.t ELSE r.t || '.0' END
            FROM (
                SELECT CASE WHEN abs(ff.f) >= 1e15 AND abs(ff.f) < 1e16
                            THEN (ff.f::text)::numeric::text
                            ELSE ff.f::text END AS t
                FROM (SELECT ({x} #>> '{{}}')::float8 AS f) AS ff
            ) AS r
        )
    END
END
"""

UPGRADE_SQL = f"""
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
                jsonb_typeof(e.elem) = 'object'
                AND e.elem - 'value' - 'label' = '{{}}'::jsonb
                AND jsonb_typeof(e.elem -> 'value') = 'string' AND e.elem ->> 'value' <> ''
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
                              WHEN jsonb_typeof(e.elem) = 'string' THEN CASE
                                  WHEN e.elem #>> '{{}}' !~ '^{_PY_WHITESPACE}*$'
                                      THEN jsonb_build_object(
                                          'value', e.elem #>> '{{}}', 'label', e.elem #>> '{{}}'
                                      )
                              END
                              WHEN p.v IS NOT NULL
                                  THEN jsonb_build_object('value', p.v, 'label', coalesce(p.l, p.v))
                              WHEN p.l IS NOT NULL
                                  THEN jsonb_build_object('value', p.l, 'label', p.l)
                          END AS item
                   FROM jsonb_array_elements(l.opts) WITH ORDINALITY AS e(elem, ord)
                   CROSS JOIN LATERAL (
                       SELECT {_PY_STR.format(x="e.elem -> 'value'")} AS v,
                              {_PY_STR.format(x="e.elem -> 'label'")} AS l
                   ) AS p
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
    # The float rendering above assumes shortest round-trip float8 output.
    op.execute("SET LOCAL extra_float_digits = 1")
    op.execute(UPGRADE_SQL)
    op.execute(f"ALTER TABLE public.extraction_fields ENABLE TRIGGER {_TRIGGER}")


def downgrade() -> None:
    # Data-only and forward-only: the legacy shapes are still readable, so
    # there is nothing to undo.
    pass

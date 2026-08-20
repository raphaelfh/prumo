"""Per-section field-name uniqueness: heal duplicates, then index (B-7).

``CREATE UNIQUE INDEX uq_extraction_fields_entity_type_name ON
public.extraction_fields (entity_type_id, name)`` is the DB backstop
behind the typed endpoints' read-time duplicate checks
(``template_field_service`` remaps a 23505 on THIS index name to
``DuplicateFieldNameError``) and behind the residual manager-JWT
PostgREST writes named in the 0049 docstring. Plain index — not
CONCURRENTLY: Alembic runs transactional and the config tables are tiny.

Duplicates are creatable pre-B-7 (stale queue takenNames; update-behind-
insert key renames skipping validateKeyCommit), so a defensive heal
precedes the index. Prod duplicate state is UNKNOWN — run this audit
against prod READ-ONLY before promoting and record the output in the
promotion PR:

    -- Duplicate audit. Covers BOTH lineages: grouping is per section,
    -- so global- and project-lineage sections are swept alike.
    SELECT entity_type_id, name, count(*)
    FROM public.extraction_fields
    GROUP BY entity_type_id, name
    HAVING count(*) > 1;

    -- Hybrid-row audit (2026-08-08 panel, decision 1): rows claiming
    -- BOTH lineages predate 0049's RLS floor and deserve eyes.
    SELECT id FROM public.extraction_entity_types
    WHERE template_id IS NOT NULL AND project_template_id IS NOT NULL;

Heal algorithm (panel decision 6 — deterministic, collision-proof,
idempotent):

- Keeper = first row per ``(entity_type_id, name)`` under
  ``row_number() OVER (PARTITION BY entity_type_id, name ORDER BY
  created_at, id)``; every ``rn > 1`` row is renamed, in rn order.
- Rename target = the FIRST FREE ``<name>_<n>`` suffix (n from 2),
  probed with NOT EXISTS against ALL current names in that section.
  Pre-existing ``foo_2`` rows AND names healed earlier in this same DO
  block are both visible to the probe (each SPI query sees prior
  updates), so no rename can collide and abort the deploy transaction.
- Idempotent: after the heal no ``rn > 1`` row exists, so a re-run
  (downgrade -> upgrade) selects nothing and renames nothing.

The 0048 mark-draft trigger stays ENABLED through the heal —
deliberately (panel decision 6). A healed template's live config now
genuinely differs from its published snapshot, so the "Unpublished
changes" stamp is semantically CORRECT drift, not backfill noise: the
0048 warning targets every-row backfills, while this heal touches only
duplicate rows. Markers are never blanket-cleared afterwards — that
would re-arm the clone-path silent drift-heal B-4 closed.

Notes:

- Healed names can exceed the 50-char Pydantic/Zod name cap
  (``<name>_<n>`` on top of a 50-char name). Harmless: the cap gates
  only new writes, and any later rename of the field clears it.
- Seed interplay: the global catalogue ships from ``python -m
  app.seed``'s fixed roster, so a healed GLOBAL-lineage field desyncs
  the live catalogue from the roster. The audit above covers the global
  lineage precisely so promotion runs the probe FIRST and resolves any
  global duplicate deliberately rather than by suffix.
- Downgrade drops the INDEX only. The heal is permanent data repair:
  the pre-heal names were corrupt state, not schema.

Revision ID: 0050_field_name_unique_heal
Revises: 0049_config_write_rls_manager
"""

from alembic import op

revision = "0050_field_name_unique_heal"
down_revision = "0049_config_write_rls_manager"
branch_labels = None
depends_on = None

_INDEX_NAME = "uq_extraction_fields_entity_type_name"

_HEAL_DUPLICATE_NAMES = """
DO $$
DECLARE
    dup RECORD;
    candidate text;
    n integer;
BEGIN
    FOR dup IN
        SELECT id, entity_type_id, name
        FROM (
            SELECT id, entity_type_id, name,
                   row_number() OVER (
                       PARTITION BY entity_type_id, name
                       ORDER BY created_at, id
                   ) AS rn
            FROM public.extraction_fields
        ) ranked
        WHERE rn > 1
        ORDER BY entity_type_id, name, rn
    LOOP
        n := 2;
        LOOP
            candidate := dup.name || '_' || n;
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM public.extraction_fields
                WHERE entity_type_id = dup.entity_type_id
                  AND name = candidate
            );
            n := n + 1;
        END LOOP;
        UPDATE public.extraction_fields
        SET name = candidate
        WHERE id = dup.id;
    END LOOP;
END $$;
"""


def upgrade() -> None:
    op.execute(_HEAL_DUPLICATE_NAMES)
    op.create_index(
        _INDEX_NAME,
        "extraction_fields",
        ["entity_type_id", "name"],
        unique=True,
        schema="public",
    )


def downgrade() -> None:
    # Index only — the heal is permanent data repair (see docstring).
    op.drop_index(_INDEX_NAME, table_name="extraction_fields", schema="public")

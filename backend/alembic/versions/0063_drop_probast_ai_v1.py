"""Delete the orphaned PROBAST+AI v1.0.0 catalogue row.

PR #693 moved the PROBAST+AI catalogue row to a new primary key (``…0002``)
and shipped no migration for the old one, so every database seeded between
2026-07-25 (#557/#561) and 2026-08-24 still carries a SECOND global template
literally named "PROBAST+AI", version 1.0.0, with 10 sections and 58 fields.
No seeder converges it, no migration removed it, and nothing in the codebase
references its id — it only pads the QA template picker with a superseded
instrument.

Note this is not the same thing as the plain "PROBAST" catalogue row
(``00b00000-…-0001``): that is classic PROBAST (Wolff et al. 2019), a
DIFFERENT instrument rather than an older version of this one, and it is the
fixture the E2E QA suite and seven integration test files are pinned to. It
is deliberately untouched.

What the delete reaches, from the FK graph:

* CASCADE to its own catalogue sections and fields (``template_id``).
* SET NULL on ``project_extraction_templates.global_template_id`` for any
  project clone descended from it. That is the accepted cost, taken with the
  tradeoff on the table: a clone keeps its own copied structure, instances,
  runs, versions and published states — those hang off ``project_template_id``
  and are minted under fresh ids at clone time — and loses only the
  provenance link, which costs clone dedupe (``_find_existing_clone``) and the
  origin's inherited default instruction.

The DELETE is SELF-GUARDING rather than gated on a query run while writing
it. ``extraction_instances.entity_type_id`` is ON DELETE RESTRICT, and
``railway.toml`` runs ``alembic upgrade head`` inside the boot command, so one
row pointing at a catalogue entity type would abort the deploy — and then
every later deploy at the same statement, including the one carrying the fix.
A stale catalogue row is recoverable; a stuck deploy is not. This mirrors
``seed_probast_ai._catalogue_is_referenced``, which downgrades the same
hazard to a loud skip for the v2 row. Probing instances is sufficient:
proposals, decisions, reviewer states, consensus decisions and published
states each hang off an instance whose coordinate coherence is enforced
(``assert_coords_coherent``), so none can reach a catalogue field without an
instance reaching a catalogue entity type first.

Revision ID: 0063_drop_probast_ai_v1
Revises: 0062_allows_no_information
Create Date: 2026-08-30

"""

from alembic import op

revision = "0063_drop_probast_ai_v1"
down_revision = "0062_allows_no_information"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM public.extraction_templates_global g
        WHERE g.id = '00ba0000-0000-0000-0000-000000000001'
          AND NOT EXISTS (
              SELECT 1
              FROM public.extraction_instances i
              JOIN public.extraction_entity_types et ON et.id = i.entity_type_id
              WHERE et.template_id = g.id
          )
        """
    )


def downgrade() -> None:
    """No-op: the tree this dropped cannot be reconstructed from here.

    Re-seeding does not bring it back either — ``seed_probast_ai`` has written
    ``…0002`` since #693, and no code path creates ``…0001`` any more.
    Restoring the row means restoring a backup, so failing loudly here would
    only block an unrelated downgrade past this point.
    """

"""Re-stamp ``is_entity_key`` on project clones created after 0059.

0059 added the column and backfilled by NAME, which covered every template
that existed at the time — global catalogue and project clones alike. What it
could not cover is clones made *afterwards*, because
``TemplateCloneService`` copied the field row attribute by attribute from a
hand-written list and ``is_entity_key`` was never added to it.

So the identity silently stopped travelling into new projects. The seed stamps
the GLOBAL catalogue and does not run on deploy; the clone is what a Run
resolves against. The result, for every project that cloned CHARMS since 0059:
``entity_key.resolve_key_field`` finds no key field on ``prediction_models`` /
``final_predictors``, and the first AI extraction into a repeating section
raises ``MissingEntityKeyError`` — "declares no identity field". The affected
projects cannot fix themselves without a manager hand-marking the field in the
template editor.

The code leak is closed in the same change (``CLONED_FIELD_COLUMNS``, guarded
by ``tests/unit/test_template_clone_field_columns.py``). This migration heals
the rows already written, because a code fix alone leaves every project cloned
in that window broken.

The statement is 0059's, unchanged and deliberately so: matched by NAME (a
clone carries fresh ids), idempotent (``IS DISTINCT FROM true``), and yielding
to any entity type that already declares a key so it cannot trip
``uq_extraction_fields_one_entity_key``. Re-running it is a no-op wherever
0059 already did the work.

``downgrade`` is a no-op: nothing here distinguishes a flag this migration set
from one 0059 set or a manager declared by hand, so clearing them would
destroy data this migration never owned. 0059's own downgrade drops the column
outright, which is the only honest way to undo the concept.

Revision ID: 0066_entity_key_reclone_heal
Revises: 0065_revoke_anon_model_prog
"""

from alembic import op

revision = "0066_entity_key_reclone_heal"
down_revision = "0065_revoke_anon_model_prog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE public.extraction_fields f
           SET is_entity_key = true
          FROM public.extraction_entity_types et
         WHERE et.id = f.entity_type_id
           AND (et.name, f.name) IN (
                 ('prediction_models',   'model_name'),
                 ('prediction_models',   'mdl_name'),
                 ('final_predictors',    'predictor_name'),
                 ('numeric_performance', 'pnum_validation_type')
               )
           AND f.is_entity_key IS DISTINCT FROM true
           AND NOT EXISTS (
                 SELECT 1
                   FROM public.extraction_fields other
                  WHERE other.entity_type_id = f.entity_type_id
                    AND other.is_entity_key
               )
        """
    )


def downgrade() -> None:
    """Intentionally empty — see the module docstring."""

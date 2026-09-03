"""Re-stamp ``is_entity_key`` on project clones created after 0059.

0059 backfilled by name every field row that existed at the time, global
catalogue and project clones alike. Clones made since then lost the flag:
``TemplateCloneService`` copied fields from a hand-written column list that
never included ``is_entity_key``. The seed converges only the global
catalogue, and a Run resolves against the clone, so every project that
imported CHARMS in that window has repeating sections with no key, and the
first AI extraction into one raises ``MissingEntityKeyError``. The clone now
copies every column by default (``CLONED_FIELD_COLUMNS``); this heals the
rows already written.

The UPDATE is 0059's verbatim: matched by name (a clone carries fresh ids),
idempotent, and yielding to any entity type that already declares a key, so
it cannot trip ``uq_extraction_fields_one_entity_key``. The coordinates
mirror ``app.seed.ENTITY_KEY_FIELDS``; ``test_seed_entity_keys`` pins both
migrations to that list.

``downgrade`` is a no-op: a flag set here is indistinguishable from one 0059
set or a manager declared by hand, so clearing it would destroy data this
migration never owned. Dropping the column (0059's downgrade) is the only
honest undo.

Revision ID: 0066_entity_key_clone_heal
Revises: 0065_revoke_anon_model_prog
"""

from alembic import op

revision = "0066_entity_key_clone_heal"
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

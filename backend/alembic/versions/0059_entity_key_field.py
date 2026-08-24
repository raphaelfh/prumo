"""Declare an identity key on repeating-group fields.

An AI re-run creates a second instance for an entity it already extracted:
run 1 names a model "XGBoost", run 2 names the same model "Gradient
Boosting", and the two half-filled instances never meet in consensus.

Root cause is that ``cardinality='many'`` has no identity mechanism. The
trigger that would enforce one bails out for it explicitly
(``enforce_extraction_instance_cardinality``, baseline_v1.sql:283:
``IF v_cardinality IS DISTINCT FROM 'one' THEN RETURN NEW``), so every
repeating group is unprotected.

``is_entity_key`` marks the field whose value identifies an instance
within its ``(article, entity_type, parent_instance)`` coordinate. The
partial unique index allows at most one per entity type. It is NOT
conditioned on cardinality — a key declared on a ``cardinality='one'``
type is inert rather than rejected, which keeps the constraint simple and
survives a section being toggled between ``one`` and ``many``.

**Why this migration backfills.** ``app.seed`` guards every template with
an early return — ``seed.py:241`` for CHARMS, ``seed.py:2030`` for CHARMS
+ Multimodal — so editing the seed stamps nothing in a database that
already holds them, which is every existing installation, production
included. And the seed does not run on deploy. Without the backfill the
column would ship, no CHARMS template would declare a key, and the
service-layer refusal (spec §5.3) would then block AI re-runs on the
primary workflow: a production regression rather than a no-op.

The backfill matches by NAME, never by id — a project clone of a seeded
template carries fresh ids for every row, and existing projects must keep
working without a re-clone. It is idempotent
(``is_entity_key IS DISTINCT FROM true``) and yields to any entity type
that already declares a key, so re-running it cannot trip the index.

The four coordinates mirror ``app.seed.ENTITY_KEY_FIELDS``;
``test_entity_key_migration`` pins the two lists against each other so
they cannot drift.

``downgrade`` drops the index and the column. That discards any key a
manager declared by hand — unavoidable when the column itself goes, and
noted here so it is a known cost rather than a surprise.

Revision ID: 0059_entity_key_field
Revises: 0058_scope_config_read_rls
"""

import sqlalchemy as sa

from alembic import op

revision = "0059_entity_key_field"
down_revision = "0058_scope_config_read_rls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "extraction_fields",
        sa.Column("is_entity_key", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema="public",
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_extraction_fields_one_entity_key "
        "ON public.extraction_fields (entity_type_id) WHERE is_entity_key"
    )
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
               );
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.uq_extraction_fields_one_entity_key")
    op.drop_column("extraction_fields", "is_entity_key", schema="public")

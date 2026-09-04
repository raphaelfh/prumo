"""Stamp the entry noun on the two seeded groups that shipped without one.

Every ``cardinality='many'`` section is an entry group whose noun
(``entry_label``) names one of its entries in the identification prompt
and on the run form. CHARMS' ``final_predictors`` and CHARMS +
Multimodal's ``numeric_performance`` shipped before the noun reached
non-container sections, so their global catalogue rows carry NULL and read
as the ``entry`` fallback. ``seed_charms`` / ``seed_charms_mm``
early-return on an existing template, so the seed can never repair an
installation that already holds them — this UPDATE is the only path to
existing databases, prod's global catalogue included
(``test_seed_entry_nouns`` pins it against the seed's declaration).

Global rows only (``template_id IS NOT NULL``; the ``template_xor`` CHECK
makes that the global lineage exactly): the noun is versioned config since
#798, so stamping a project clone without patching its published snapshot
would surface a phantom unpublished change, and Discard would write NULL
back (the 0067 lesson). Global templates carry no snapshot, and a clone
copies every column, so clones made after this migration carry the noun
while earlier clones keep the ``entry`` fallback until a manager names it
in the inspector.

Idempotent: ``entry_label IS NULL`` skips rows already stamped, by an
earlier run or by hand. Downgrade is a no-op: a noun written here is
indistinguishable from one a manager typed, and no reader treats it as
an error.

Revision ID: 0068_seeded_entry_nouns
Revises: 0067_snapshot_entity_key
"""

from alembic import op

revision = "0068_seeded_entry_nouns"
down_revision = "0067_snapshot_entity_key"
branch_labels = None
depends_on = None

UPGRADE_SQL = """
UPDATE public.extraction_entity_types AS et
SET entry_label = nouns.noun
FROM (VALUES ('final_predictors', 'predictor'), ('numeric_performance', 'validation'))
     AS nouns(name, noun)
WHERE et.name = nouns.name
  AND et.template_id IS NOT NULL
  AND et.cardinality = 'many'
  AND et.entry_label IS NULL
"""


def upgrade() -> None:
    op.execute(UPGRADE_SQL)


def downgrade() -> None:
    """Intentionally empty — see the module docstring."""

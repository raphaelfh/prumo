"""Revoke PostgREST writes on the two live config tables (0049 residual).

0049 manager-gated the INSERT/UPDATE policies on
``extraction_entity_types`` / ``extraction_fields`` and named the rest of
the job in its own docstring (panel decision 2): "a MANAGER's JWT can
still write these tables via PostgREST (GRANT ALL to ``authenticated``
stays), bypassing endpoint validation [...] Follow-up once B-7 settles:
``REVOKE INSERT, UPDATE ON extraction_entity_types, extraction_fields
FROM authenticated``." B-7 and B-9 have since shipped: every
template-config write now goes through a manager-gated typed endpoint.
This is that revoke.

RLS is the security floor, but a policy only decides between writes that
are allowed to reach it — the GRANT is what makes PostgREST able to
attempt the write at all. Everything the endpoints own beyond
"is this caller a manager of this project" is therefore invisible to a
direct PostgREST call: per-section name uniqueness, the config-draft
marker and its editor lock, cardinality/role coherence, the republish
that re-pins the active snapshot. Those were backstopped only by 0050's
unique index and the ck constraints; removing the privilege removes the
path instead of racing it.

SELECT is deliberately untouched: ~10 frontend call sites read both
tables straight from PostgREST (``useTemplateEntityTypes``,
``qaTemplateService``, ``templateService``, ...) and no frontend code
writes either table. The backend connects with its own role, not
``authenticated``, so services and migrations are unaffected.

Baseline granted ``ALL`` (baseline_v1.sql:3029, :3040 — plus
``SELECT`` to ``anon``, left alone). ``downgrade`` re-grants exactly the
two revoked privileges, which restores that ``ALL``.

Residual: DELETE stays granted, so a manager JWT can still delete
sections/fields around the endpoints (the DELETE policy has been
manager-gated since baseline). Out of scope here — 0049's approved
follow-up names INSERT and UPDATE only.

Revision ID: 0054_revoke_config_writes
Revises: 0053_config_draft_by
"""

from alembic import op

revision = "0054_revoke_config_writes"
down_revision = "0053_config_draft_by"
branch_labels = None
depends_on = None

_TABLES = '"public"."extraction_entity_types", "public"."extraction_fields"'


def upgrade() -> None:
    op.execute(f'REVOKE INSERT, UPDATE ON {_TABLES} FROM "authenticated";')


def downgrade() -> None:
    op.execute(f'GRANT INSERT, UPDATE ON {_TABLES} TO "authenticated";')

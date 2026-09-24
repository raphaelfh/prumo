"""Revoke PostgREST writes on ``projects`` (0054 / 0057 sibling).

Baseline granted ``ALL`` on ``public.projects`` to ``authenticated``
(baseline_v1.sql:3119) behind four RLS policies, so a manager JWT could
``PATCH`` / ``DELETE /rest/v1/projects`` straight through PostgREST. That
routes around every guarantee the typed endpoints now carry (constitution
§VI; ADR 0007's dual-write class):

* **Descriptive columns.** ``PATCH /projects/{id}/details``
  (``project_details_service``) is the one writer: a typed whitelist of 11
  columns and an ``expected`` precondition under a row lock, so a Settings
  save cannot silently clobber a value another writer (the researcher MCP
  agent) changed since the page loaded. A raw ``UPDATE`` skips all three,
  and could also write columns no Settings field exposes
  (``settings.managers_see_reviewers``, ``picots_config_ai_review``,
  ``is_active``), each owned by its own typed route.
* **Delete.** ``DELETE /projects/{id}`` is the one path that deletes a
  project, behind the same manager gate.
* **Insert.** No client inserts a row: projects are created through the
  ``create_project_with_member`` RPC, SECURITY DEFINER, which also writes
  the creator's manager membership. A raw ``INSERT`` would create a project
  with no member at all — invisible to its own creator under
  ``project_select``.

Same principal, same project, so this is not a privilege escalation: it is
the *path* that is wrong, and removing the privilege removes it instead of
racing it. The four policies stay as the floor under any future grant.

SELECT is deliberately untouched: the Settings load, the project hub, the
project view and the extraction screens read the table straight from
PostgREST (``scripts/fitness/check_frontend_data_path.baseline``).

``service_role`` and ``postgres`` are untouched — the backend, the seed and
the E2E admin fixtures connect with those. The RPC runs as its owner, so it
keeps inserting. As in 0057, ``authenticated`` keeps TRUNCATE (no PostgREST
verb), and ``anon`` has no grant here and a NULL ``auth.uid()`` under RLS.

``downgrade`` re-grants exactly the three revoked privileges, restoring the
baseline ``ALL``.

Revision ID: 0077_revoke_project_writes
Revises: 0076_extraction_batches
"""

from alembic import op

revision = "0077_revoke_project_writes"
down_revision = "0076_extraction_batches"
branch_labels = None
depends_on = None

_TABLE = '"public"."projects"'


def upgrade() -> None:
    op.execute(f'REVOKE INSERT, UPDATE, DELETE ON {_TABLE} FROM "authenticated";')


def downgrade() -> None:
    op.execute(f'GRANT INSERT, UPDATE, DELETE ON {_TABLE} TO "authenticated";')

"""Revoke PostgREST writes on ``project_extraction_templates`` (0054 sibling).

0054 did this for ``extraction_entity_types`` / ``extraction_fields``; its
GRANT-vs-RLS reasoning transfers verbatim and is not repeated here.
Baseline granted ``ALL`` to ``authenticated`` (baseline_v1.sql:3112) and
manager-gated the four policies (:2793 ff.), so everything the endpoints
own beyond "is this caller a manager of this project" was invisible to a
direct PostgREST call.

The portable-template slice
(``docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md``)
made that concrete. Its guards live only in the services:

* **§5.6 activate** deactivates the kind-scoped sibling before flipping
  the flag. A raw ``UPDATE ... SET is_active = true`` skips that and
  trips ``uq_one_active_extraction_template_per_project`` — or, for QA
  (several may be active), silently leaves two.
* **§5.7 delete** refuses the active template and any template still
  referenced by ``extraction_runs`` / ``extraction_instances`` (guards
  under a row lock — see the spec and ``template_delete_service``), then
  removes the template-scoped ``extraction_hitl_configs`` row, which
  ``scope_id`` has no FK to cascade from.

Same principal, same project, so this is not a privilege escalation: a
manager may legitimately do all three. It is the *path* that is wrong —
removing the privilege removes it instead of racing it.

SELECT is deliberately untouched: eight frontend call sites read the
table straight from PostgREST (``extractionDataService``,
``qaTemplateService``, ``projectSettingsService``, ``template-helpers``),
and revoking it would blank the template pickers.

INSERT also closes ``templateService.createCustomTemplate``. That path is
user-reachable, not dead code — it is the Configuration-tab empty-state
button, i.e. the first-run onboarding path — but it is already broken for
an unrelated reason; see its JSDoc.

``service_role`` and ``postgres`` are untouched — the backend, the seed
and the E2E admin fixtures all connect with those, not ``authenticated``.

Two residuals, both unreachable through PostgREST. ``authenticated``
keeps TRUNCATE, for which PostgREST exposes no verb. And ``anon``: no
migration grants it anything here, but a local Supabase bootstrap leaves
it ``ALL`` through ``pg_default_acl`` (prod, checked 2026-08-23, has
SELECT only). Either way RLS stops it — every policy calls
``is_project_manager(project_id, auth.uid())``, false for a NULL
``auth.uid()``.

``downgrade`` re-grants exactly the three revoked privileges, restoring
the baseline ``ALL``.

Revision ID: 0057_revoke_project_tpl_writes
Revises: 0056_proposal_provenance
"""

from alembic import op

revision = "0057_revoke_project_tpl_writes"
down_revision = "0056_proposal_provenance"
branch_labels = None
depends_on = None

_TABLE = '"public"."project_extraction_templates"'


def upgrade() -> None:
    op.execute(f'REVOKE INSERT, UPDATE, DELETE ON {_TABLE} FROM "authenticated";')


def downgrade() -> None:
    op.execute(f'GRANT INSERT, UPDATE, DELETE ON {_TABLE} TO "authenticated";')

"""Revoke PostgREST writes on ``project_extraction_templates`` (0054 sibling).

0054 did this for ``extraction_entity_types`` / ``extraction_fields`` and
its reasoning transfers verbatim: RLS is the security floor, but a policy
only decides between writes that are allowed to *reach* it — the GRANT is
what makes PostgREST able to attempt the write at all. Baseline granted
``ALL`` to ``authenticated`` (baseline_v1.sql:3112) and manager-gated the
four policies (:2793 ff.), so everything the endpoints own beyond "is
this caller a manager of this project" is invisible to a direct
PostgREST call.

The portable-template slice
(``docs/superpowers/specs/2026-08-23-template-portable-import-export-design.md``)
made that gap concrete. Its guards live only in
``template_delete_service`` / ``project_template_active_service``:

* **§5.6 activate** deactivates the kind-scoped sibling before flipping
  the flag. A raw ``UPDATE ... SET is_active = true`` skips that and
  trips ``uq_one_active_extraction_template_per_project`` — or, for QA
  (several may be active), silently leaves two.
* **§5.7 delete** refuses the active template, refuses one referenced by
  ``extraction_runs`` / ``extraction_instances`` (a ``SELECT ... FOR
  UPDATE`` pre-check, not belt-and-braces: ``extraction_runs`` carries a
  composite ``ON DELETE CASCADE`` FK next to the ``RESTRICT`` one and
  Postgres fires RI triggers in *name* order, so the wrong order deletes
  runs), and deletes the template-scoped ``extraction_hitl_configs`` row
  in the same transaction — ``scope_id`` has no FK, so a raw ``DELETE``
  orphans it.

Same principal, same project, so this is not a privilege escalation: a
manager may legitimately do all three. It is the *path* that is wrong —
removing the privilege removes it instead of racing it.

SELECT is deliberately untouched: eight frontend call sites read the
table straight from PostgREST (``extractionDataService``,
``qaTemplateService``, ``projectSettingsService``, ``template-helpers``),
and revoking it would blank the template pickers.

INSERT closes one live frontend writer,
``templateService.createCustomTemplate``, which is already dead on
arrival: the 0004 constraint trigger
``project_extraction_templates_active_version`` (DEFERRABLE INITIALLY
DEFERRED) requires an active ``extraction_template_versions`` row that a
single PostgREST insert cannot create. Its replacement is the typed
``POST /projects/{id}/templates/clone`` / ``/import``, tracked separately.

``service_role`` and ``postgres`` are untouched — the backend, the seed
and the E2E admin fixtures all connect with those, not ``authenticated``.

Residuals, both unreachable through PostgREST and both matching 0054:
``anon`` keeps ``ALL`` from Supabase's schema default privileges (every
policy calls ``is_project_manager(project_id, auth.uid())``, which is
false for a NULL ``auth.uid()``), and ``authenticated`` keeps TRUNCATE,
for which PostgREST exposes no verb.

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

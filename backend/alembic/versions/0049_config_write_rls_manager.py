"""Manager-gate the template-config write policies (slice B-7).

The four INSERT/UPDATE policies on the two live config tables
(``extraction_entity_types`` / ``extraction_fields``) drop from
``is_project_member`` to ``is_project_manager``, both UPDATEs gain an
explicit WITH CHECK, and the entity-types pair gains ``template_id IS
NULL`` (2026-08-08 panel, decision 1 — BLOCKING). B-7 moved every
config-editor write onto manager-gated typed endpoints; this closes the
member-writable PostgREST hole the editor used to rely on. SELECT
(``USING (true)``) and DELETE (already manager since baseline) are
untouched.

The ``template_id IS NULL`` predicate closes a global-catalogue
injection hole: the old INSERT policy only required ``project_template_id
IS NOT NULL`` + membership, so a hybrid row (BOTH lineage ids set) passed
RLS and was stopped solely by the ``ck_extraction_entity_types_
template_xor`` data-model CHECK. Any self-made project's manager JWT was
one relaxed constraint away from inserting sections into the GLOBAL
catalogue — rows every tenant's future clone imports, including an
attacker-controlled ``llm_description`` (cross-tenant prompt injection).
RLS is the security floor and must not lean on a data-model invariant.
The fields pair needs no such predicate: its et JOIN pet chain resolves
via ``project_template_id`` and already excludes global lineage.

Explicit USING + WITH CHECK on the UPDATEs is belt-and-braces (panel
decision 3): USING already gates NEW rows when WITH CHECK is absent —
the historical cross-template-move pass-through existed because
membership predicates cannot express "same template as OLD", not because
of a missing check. The endpoint layer remains the enforcement for that;
explicit WITH CHECK is the contract.

Residual (panel decision 2): a MANAGER's JWT can still write these
tables via PostgREST (GRANT ALL to ``authenticated`` stays), bypassing
endpoint validation — backstopped by 0050's unique index and the ck
constraints. Follow-up once B-7 settles: ``REVOKE INSERT, UPDATE ON
extraction_entity_types, extraction_fields FROM authenticated``.

DROP POLICY IF EXISTS + CREATE in both directions (0041 precedent);
downgrade restores the four asymmetric baseline policies VERBATIM
(baseline_v1.sql:2470-2480, :2511-2523 — entity-types INSERT keeps its
``project_template_id IS NOT NULL`` guard, UPDATEs are USING-only with
NO WITH CHECK, the fields pair uses the bare et JOIN pet chain).

Revision ID: 0049_config_write_rls_manager
Revises: 0048_config_draft_marker
"""

from alembic import op

revision = "0049_config_write_rls_manager"
down_revision = "0048_config_draft_marker"
branch_labels = None
depends_on = None

_POLICIES = (
    ("extraction_entity_types", "extraction_entity_types_project_insert"),
    ("extraction_entity_types", "extraction_entity_types_project_update"),
    ("extraction_fields", "extraction_fields_project_insert"),
    ("extraction_fields", "extraction_fields_project_update"),
)

# Manager-gated predicates. The entity-types predicate pins BOTH lineage
# columns; the fields predicate keeps the baseline et JOIN pet chain
# (global-lineage rows have project_template_id NULL and never join).
_ENTITY_TYPES_MANAGER_PREDICATE = """
    (("project_template_id" IS NOT NULL) AND ("template_id" IS NULL) AND (EXISTS ( SELECT 1
       FROM "public"."project_extraction_templates" "pet"
      WHERE (("pet"."id" = "extraction_entity_types"."project_template_id") AND "public"."is_project_manager"("pet"."project_id", "auth"."uid"())))))
"""

_FIELDS_MANAGER_PREDICATE = """
    ((EXISTS ( SELECT 1
       FROM ("public"."extraction_entity_types" "et"
         JOIN "public"."project_extraction_templates" "pet" ON (("pet"."id" = "et"."project_template_id")))
      WHERE (("et"."id" = "extraction_fields"."entity_type_id") AND "public"."is_project_manager"("pet"."project_id", "auth"."uid"())))))
"""


def _drop_policies() -> None:
    for table, policy in _POLICIES:
        op.execute(f'DROP POLICY IF EXISTS "{policy}" ON "public"."{table}";')


def upgrade() -> None:
    _drop_policies()
    op.execute(
        f"""
        CREATE POLICY "extraction_entity_types_project_insert"
            ON "public"."extraction_entity_types" FOR INSERT
            WITH CHECK {_ENTITY_TYPES_MANAGER_PREDICATE};
        """
    )
    op.execute(
        f"""
        CREATE POLICY "extraction_entity_types_project_update"
            ON "public"."extraction_entity_types" FOR UPDATE
            USING {_ENTITY_TYPES_MANAGER_PREDICATE}
            WITH CHECK {_ENTITY_TYPES_MANAGER_PREDICATE};
        """
    )
    op.execute(
        f"""
        CREATE POLICY "extraction_fields_project_insert"
            ON "public"."extraction_fields" FOR INSERT
            WITH CHECK {_FIELDS_MANAGER_PREDICATE};
        """
    )
    op.execute(
        f"""
        CREATE POLICY "extraction_fields_project_update"
            ON "public"."extraction_fields" FOR UPDATE
            USING {_FIELDS_MANAGER_PREDICATE}
            WITH CHECK {_FIELDS_MANAGER_PREDICATE};
        """
    )


def downgrade() -> None:
    # Restore the four ASYMMETRIC baseline policies verbatim
    # (baseline_v1.sql:2470-2480 and :2511-2523).
    _drop_policies()
    op.execute(
        """
        CREATE POLICY "extraction_entity_types_project_insert" ON "public"."extraction_entity_types" FOR INSERT WITH CHECK ((("project_template_id" IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM "public"."project_extraction_templates" "pet"
          WHERE (("pet"."id" = "extraction_entity_types"."project_template_id") AND "public"."is_project_member"("pet"."project_id", "auth"."uid"()))))));
        """
    )
    op.execute(
        """
        CREATE POLICY "extraction_entity_types_project_update" ON "public"."extraction_entity_types" FOR UPDATE USING ((("project_template_id" IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM "public"."project_extraction_templates" "pet"
          WHERE (("pet"."id" = "extraction_entity_types"."project_template_id") AND "public"."is_project_member"("pet"."project_id", "auth"."uid"()))))));
        """
    )
    op.execute(
        """
        CREATE POLICY "extraction_fields_project_insert" ON "public"."extraction_fields" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
           FROM ("public"."extraction_entity_types" "et"
             JOIN "public"."project_extraction_templates" "pet" ON (("pet"."id" = "et"."project_template_id")))
          WHERE (("et"."id" = "extraction_fields"."entity_type_id") AND "public"."is_project_member"("pet"."project_id", "auth"."uid"())))));
        """
    )
    op.execute(
        """
        CREATE POLICY "extraction_fields_project_update" ON "public"."extraction_fields" FOR UPDATE USING ((EXISTS ( SELECT 1
           FROM ("public"."extraction_entity_types" "et"
             JOIN "public"."project_extraction_templates" "pet" ON (("pet"."id" = "et"."project_template_id")))
          WHERE (("et"."id" = "extraction_fields"."entity_type_id") AND "public"."is_project_member"("pet"."project_id", "auth"."uid"())))));
        """
    )

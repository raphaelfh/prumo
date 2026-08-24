"""Scope entity-type / field SELECT to project members (0054 sibling).

``extraction_entity_types_select`` and ``extraction_fields_select`` were
both ``USING (true)`` (baseline_v1.sql:2482, :2525), and neither carries a
``TO`` clause — ``pg_policy.polroles`` is ``{0}``, i.e. PUBLIC. Combined
with the baseline grants (``SELECT`` to ``anon`` as well as
``authenticated``, baseline_v1.sql:3029, :3040) that made every project's
section tree, field vocabulary and authored ``llm_description`` readable
through ``/rest/v1/extraction_fields`` **without signing in** — the
publishable anon key was enough. Measured on the local stack before this
change: ``set role anon`` with no JWT returned 388 field rows, 292 of them
global-catalogue and 96 belonging to a project the caller had no
membership in.

The templates themselves were never this open: ``project_extraction_
templates`` is member-gated, and 0054/0057 already removed the *write*
privileges on these same tables. 0054 left SELECT alone on the explicit
grounds that "~10 frontend call sites read both tables straight from
PostgREST". That reasoning held for the call sites and missed the row
scope: the fix is not to revoke the grant (which would blank the template
pickers, exactly as 0054 warned) but to scope the *rows*.

Portable templates (#669/#670, shipped 2026-08-23) raise the stake: a
template is now an authored, exportable artifact, so its field prompts are
the product of someone's work rather than incidental schema.

**Identical-predicate rule** (extraction-hitl-architecture.md §3). The two
read paths must encode the same predicate. The API path already did —
``extraction_runs`` endpoints call ``ensure_project_member``
(extraction_runs.py:107) and every ``template_structure`` endpoint is
``require_project_manager``, strictly narrower. Only the RLS path was
open, so the layers *disagreed*. This restores the rule rather than
bending it.

**Shape — one predicate, one place.** Lineage is a XOR
(``ck_extraction_entity_types_template_xor`` guarantees exactly one of
``template_id`` / ``project_template_id`` is set), so
``project_template_id IS NULL`` is precisely "global catalogue row".
Visibility is therefore a property of the *entity type*, and a field is
visible exactly when its parent entity type is. That is expressed once, in
``can_read_entity_type``, and both policies call it.

Expressing it once is not only tidiness. Several frontend call sites read
fields with no template filter at all — ``template-helpers.ts:125`` and
``qaTemplateService.ts:74`` select by ``.in('entity_type_id', ids)`` and
rely on the id list being pre-filtered. Two hand-written policies that
drifted apart would break those reads in ways that are very hard to trace.

The helper is ``SECURITY DEFINER`` / ``STABLE`` /
``SET search_path = public, pg_catalog``, matching ``is_project_member``
and ``is_project_arbitrator`` exactly (verified against their
``pg_proc.proconfig``). It returns a boolean about visibility and exposes
no row content, the same posture those two already have.

``SECURITY DEFINER`` also flattens the evaluation. Written as a literal
nested ``EXISTS``, the fields policy reads ``extraction_entity_types``,
whose own policy reads ``project_extraction_templates``, whose policy
calls ``is_project_member`` — a policy-within-policy chain three deep, in
which the fields policy's inner branch is redundant with the entity-type
policy that filters the same subquery. The helper removes the chain.

That nested form was written first and abandoned for cause: on the local
stack it segfaulted the backend (signal 11) under ``set role anon``,
taking the whole cluster into recovery. It could not be reproduced in an
isolated container with the same image, extensions, preload libraries,
settings, schema and data, across 1000+ concurrent mixed-role queries and
repeated policy swaps — so the trigger is not understood and the shape is
simply not used. The helper form was stress-tested the same way with zero
crashes. Repro notes kept out of tree; the observation is recorded here so
the nested form is not "simplified" back in later.

**Cost.** ``is_project_member`` is STABLE + SECURITY DEFINER and both
lookups are index-backed: ``extraction_fields.entity_type_id`` has
``idx_extraction_fields_entity_type``, and the helper probes primary keys.
No new index is needed.

**Anon.** After this change an unauthenticated caller keeps the global
catalogue (``auth.uid()`` is NULL, so ``is_project_member`` is false and
only the ``IS NULL`` branch survives) and loses every project row. Whether
the *global* catalogue should be anon-readable at all is a separate
question and deliberately not decided here.

``downgrade`` restores the two ``USING (true)`` policies and drops the
helper.

Revision ID: 0058_scope_config_read_rls
Revises: 0057_revoke_project_tpl_writes
"""

from alembic import op

revision = "0058_scope_config_read_rls"
down_revision = "0057_revoke_project_tpl_writes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.can_read_entity_type(
            p_entity_type_id uuid,
            p_user_id uuid
        ) RETURNS boolean
            LANGUAGE sql
            STABLE
            SECURITY DEFINER
            SET search_path = 'public, pg_catalog'
        AS $$
            SELECT EXISTS (
                SELECT 1
                FROM public.extraction_entity_types et
                LEFT JOIN public.project_extraction_templates t
                       ON t.id = et.project_template_id
                WHERE et.id = p_entity_type_id
                  AND (
                      et.project_template_id IS NULL
                      OR public.is_project_member(t.project_id, p_user_id)
                  )
            );
        $$;
        """
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.can_read_entity_type(uuid, uuid) "
        "TO anon, authenticated, service_role;"
    )

    op.execute(
        'DROP POLICY IF EXISTS "extraction_entity_types_select" ON public.extraction_entity_types;'
    )
    op.execute(
        """
        CREATE POLICY "extraction_entity_types_select"
            ON public.extraction_entity_types
            FOR SELECT USING (
                public.can_read_entity_type(extraction_entity_types.id, auth.uid())
            );
        """
    )

    op.execute('DROP POLICY IF EXISTS "extraction_fields_select" ON public.extraction_fields;')
    op.execute(
        """
        CREATE POLICY "extraction_fields_select"
            ON public.extraction_fields
            FOR SELECT USING (
                public.can_read_entity_type(extraction_fields.entity_type_id, auth.uid())
            );
        """
    )


def downgrade() -> None:
    op.execute(
        'DROP POLICY IF EXISTS "extraction_entity_types_select" ON public.extraction_entity_types;'
    )
    op.execute(
        'CREATE POLICY "extraction_entity_types_select" '
        "ON public.extraction_entity_types FOR SELECT USING (true);"
    )

    op.execute('DROP POLICY IF EXISTS "extraction_fields_select" ON public.extraction_fields;')
    op.execute(
        'CREATE POLICY "extraction_fields_select" '
        "ON public.extraction_fields FOR SELECT USING (true);"
    )

    op.execute("DROP FUNCTION IF EXISTS public.can_read_entity_type(uuid, uuid);")

"""Evaluate ``auth.uid()`` once per query in the config-read policies.

Supabase's ``auth_rls_init_plan`` performance advisor flags an RLS policy
that calls ``auth.uid()`` directly: the planner treats it as
row-dependent and re-evaluates it for EVERY row scanned, instead of once
per statement. Wrapping the call in a scalar subquery — ``(select
auth.uid())`` — makes it an InitPlan, evaluated once and reused.

0058 introduced both policies with the bare call, so both are flagged.
These two tables are among the hottest reads in the app (the config
editor, the template pickers and the import dialog all scan them), so the
per-row evaluation is paid on the reads that matter most.

The predicate is otherwise UNCHANGED — this is a planner-shape fix, not a
semantics change. ``can_read_entity_type`` still receives the same uuid,
and its own body is untouched.

Note on the wider backlog: 110 ``auth_rls_init_plan`` fingerprints are
already in the preflight advisor baseline, so this pattern exists across
most of the schema. Those are deliberately NOT swept here — that is a
project-wide change with its own risk surface. Only the two policies this
lineage introduced are corrected, so the slice leaves no new instance of
the class behind it.

Revision ID: 0061_rls_initplan_config_reads
Revises: 0060_revoke_anon_entity_key
"""

from alembic import op

revision = "0061_rls_initplan_config_reads"
down_revision = "0060_revoke_anon_entity_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        'DROP POLICY IF EXISTS "extraction_entity_types_select" ON public.extraction_entity_types;'
    )
    op.execute(
        """
        CREATE POLICY "extraction_entity_types_select"
            ON public.extraction_entity_types
            FOR SELECT USING (
                public.can_read_entity_type(
                    extraction_entity_types.id, (SELECT auth.uid())
                )
            );
        """
    )

    op.execute('DROP POLICY IF EXISTS "extraction_fields_select" ON public.extraction_fields;')
    op.execute(
        """
        CREATE POLICY "extraction_fields_select"
            ON public.extraction_fields
            FOR SELECT USING (
                public.can_read_entity_type(
                    extraction_fields.entity_type_id, (SELECT auth.uid())
                )
            );
        """
    )


def downgrade() -> None:
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

"""Widen legacy template-version snapshots to the full entity_types/fields shape.

The frozen snapshot in ``extraction_template_versions.schema_`` historically
omitted ``role`` + ``description`` on entity_types and 8 field columns
(``validation_schema``, ``unit``, ``allowed_units``, ``llm_description``,
``allow_other``, ``other_label``, ``other_placeholder``, ``description``). The
run-open view (Phase 2) reads the snapshot structurally for the first time, so
narrow snapshots would render wrong.

Nothing read ``schema_`` structurally before this change — every consumer read
the live ``extraction_entity_types``/``extraction_fields`` tables — so
re-deriving a narrow snapshot from the current live template for that
``project_template_id`` loses no frozen behavior that was ever honored.

Idempotent: only snapshots whose first entity_type lacks the ``role`` key
(narrow) are rewritten; re-running is a no-op. Forward-only: the downgrade
cannot reliably reconstruct the prior narrow shape and is a documented no-op.

Revision ID: 0026_widen_template_version_snapshot
Revises: 0025_reviewer_scoped_select_rls
Create Date: 2026-06-08
"""

from alembic import op

revision = "0026_widen_template_version_snapshot"
down_revision = "0025_reviewer_scoped_select_rls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Re-derive the entity_types tree from the live template, but only for
    # snapshots detected as narrow (first entity_type missing the 'role' key).
    # Empty-tree snapshots (entity_types = []) are excluded: `'[]'::jsonb -> 0`
    # is NULL and `NOT (NULL ? 'role')` is NULL, which is not-true in WHERE, so
    # the row is skipped unchanged — the correct outcome (nothing to widen).
    # Keep this jsonb_build_object key list IN SYNC with
    # app/services/extraction_snapshot.SNAPSHOT_SQL.
    op.execute(
        """
        UPDATE public.extraction_template_versions v
        SET schema = jsonb_build_object(
            'entity_types', COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'id', et.id,
                            'name', et.name,
                            'label', et.label,
                            'description', et.description,
                            'parent_entity_type_id', et.parent_entity_type_id,
                            'cardinality', et.cardinality,
                            'role', et.role,
                            'sort_order', et.sort_order,
                            'is_required', et.is_required,
                            'fields', COALESCE(
                                (
                                    SELECT jsonb_agg(jsonb_build_object(
                                        'id', f.id,
                                        'name', f.name,
                                        'label', f.label,
                                        'description', f.description,
                                        'field_type', f.field_type,
                                        'is_required', f.is_required,
                                        'validation_schema', f.validation_schema,
                                        'allowed_values', f.allowed_values,
                                        'unit', f.unit,
                                        'allowed_units', f.allowed_units,
                                        'sort_order', f.sort_order,
                                        'llm_description', f.llm_description,
                                        'allow_other', f.allow_other,
                                        'other_label', f.other_label,
                                        'other_placeholder', f.other_placeholder
                                    ) ORDER BY f.sort_order)
                                    FROM public.extraction_fields f
                                    WHERE f.entity_type_id = et.id
                                ),
                                '[]'::jsonb
                            )
                        ) ORDER BY et.sort_order
                    )
                    FROM public.extraction_entity_types et
                    WHERE et.project_template_id = v.project_template_id
                ),
                '[]'::jsonb
            )
        )
        WHERE NOT ((v.schema -> 'entity_types' -> 0) ? 'role');
        """
    )


def downgrade() -> None:
    # Forward-only data widening. The prior narrow shape cannot be reconstructed
    # without re-dropping columns the read path now depends on, and no consumer
    # relies on the snapshot being narrow. Intentional no-op.
    pass

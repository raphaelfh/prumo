"""Draft marker for template config edits (slice B-4).

``config_draft_since`` on project_extraction_templates records "there
are unpublished config edits". AFTER-row triggers on the two live
config tables stamp it (editor writes are PostgREST until B-7 — the DB
is the only chokepoint); ``TemplateVersionService.republish`` clears it
under its locks. SECURITY DEFINER so the stamp bypasses RLS regardless
of writer; EXECUTE revoked from client roles (0046 precedent — trigger
fns are never RLS-invoked).

The stamp is ``COALESCE(config_draft_since, now())`` with NO IS NULL
predicate: an UPDATE whose WHERE misses the committed row takes no row
lock, so a predicate-guarded stamp concurrent with a mid-flight publish
would commit unserialized and the publish would clear a draft it never
snapshotted. The always-matching UPDATE row-locks the template and
serializes every edit behind republish's FOR UPDATE; COALESCE keeps the
first-edit timestamp.

WARNING for future migrations: DML on extraction_entity_types /
extraction_fields now fires these triggers — a 0039-style backfill
would stamp EVERY project template (every chip flips to "Unpublished
changes", every drift-path re-import 409s). Wrap such DML in
``ALTER TABLE ... DISABLE TRIGGER trg_<table>_mark_draft`` /
re-ENABLE, or clear the markers afterwards.

Global-lineage rows (template_id set, project_template_id NULL — the
seed's lineage) resolve v_old/v_new to NULL and are skipped.

Revision ID: 0048_config_draft_marker
Revises: 0047_llm_template_instruction
"""

import sqlalchemy as sa

from alembic import op

revision = "0048_config_draft_marker"
down_revision = "0047_llm_template_instruction"
branch_labels = None
depends_on = None

_TABLES = ("extraction_entity_types", "extraction_fields")


def upgrade() -> None:
    op.add_column(
        "project_extraction_templates",
        sa.Column("config_draft_since", sa.DateTime(timezone=True), nullable=True),
        schema="public",
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.mark_template_config_draft()
            RETURNS trigger
            LANGUAGE plpgsql
            SECURITY DEFINER
            SET search_path = public
            AS $$
            DECLARE
                v_old uuid;
                v_new uuid;
            BEGIN
                -- Resolve OLD and NEW separately: a same-project
                -- re-point (RLS permits it) must stamp BOTH templates,
                -- or the source is left in silent-self-heal state.
                IF TG_TABLE_NAME = 'extraction_entity_types' THEN
                    IF TG_OP IN ('DELETE', 'UPDATE') THEN
                        v_old := OLD.project_template_id;
                    END IF;
                    IF TG_OP IN ('INSERT', 'UPDATE') THEN
                        v_new := NEW.project_template_id;
                    END IF;
                ELSE
                    -- extraction_fields: resolve via the owning
                    -- section. On a cascade delete the parent row may
                    -- already be gone (NULL lookup -> skip; the
                    -- entity-type trigger has stamped already).
                    IF TG_OP IN ('DELETE', 'UPDATE') THEN
                        SELECT project_template_id INTO v_old
                        FROM public.extraction_entity_types
                        WHERE id = OLD.entity_type_id;
                    END IF;
                    IF TG_OP IN ('INSERT', 'UPDATE') THEN
                        SELECT project_template_id INTO v_new
                        FROM public.extraction_entity_types
                        WHERE id = NEW.entity_type_id;
                    END IF;
                END IF;

                IF v_old IS NOT NULL THEN
                    UPDATE public.project_extraction_templates
                    SET config_draft_since =
                        COALESCE(config_draft_since, now())
                    WHERE id = v_old;
                END IF;
                IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
                    UPDATE public.project_extraction_templates
                    SET config_draft_since =
                        COALESCE(config_draft_since, now())
                    WHERE id = v_new;
                END IF;

                -- AFTER trigger: the return value is ignored.
                RETURN NULL;
            END;
            $$;
        """
    )
    op.execute(
        "REVOKE EXECUTE ON FUNCTION public.mark_template_config_draft() "
        "FROM PUBLIC, anon, authenticated;"
    )
    for table in _TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_mark_draft ON public.{table};")
        op.execute(
            f"""
            CREATE TRIGGER trg_{table}_mark_draft
                AFTER INSERT OR UPDATE OR DELETE ON public.{table}
                FOR EACH ROW
                EXECUTE FUNCTION public.mark_template_config_draft();
            """
        )


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_mark_draft ON public.{table};")
    op.execute("DROP FUNCTION IF EXISTS public.mark_template_config_draft();")
    op.drop_column("project_extraction_templates", "config_draft_since", schema="public")

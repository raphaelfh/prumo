"""zotero article parity, sync runs, and author entities

Revision ID: 20260328_006
Revises: 0004
Create Date: 2026-03-28

Statements run one-by-one via ``_run_statements`` (explicit tuples) instead of
naive ``split(";")``, matching revision ``20260421_0007`` and avoiding breakage
on PL/pgSQL ``DO`` blocks. This migration has no ``DO $$`` blocks; the old split
was safe here, but the explicit pattern is easier to review.
"""

from alembic import op

revision: str = "20260328_006"
down_revision: str | None = "0004"
branch_labels = None
depends_on = None


def _run_statements(statements: tuple[str, ...]) -> None:
    for stmt in statements:
        op.execute(stmt)


_UPGRADE_DDL = (
    "ALTER TABLE public.articles\n            ADD COLUMN IF NOT EXISTS sync_state text NOT NULL DEFAULT 'active',\n            ADD COLUMN IF NOT EXISTS removed_at_source_at timestamptz NULL,\n            ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL,\n            ADD COLUMN IF NOT EXISTS sync_conflict_log jsonb NULL,\n            ADD COLUMN IF NOT EXISTS pdf_extracted_text text NULL,\n            ADD COLUMN IF NOT EXISTS semantic_abstract_text text NULL,\n            ADD COLUMN IF NOT EXISTS semantic_fulltext_text text NULL,\n            ADD COLUMN IF NOT EXISTS source_lineage text NULL",
    "CREATE INDEX IF NOT EXISTS idx_articles_sync_state\n            ON public.articles(sync_state)",
    "CREATE INDEX IF NOT EXISTS idx_articles_last_synced_at\n            ON public.articles(last_synced_at DESC)",
    "CREATE TABLE IF NOT EXISTS public.article_authors\n        (\n            id\n            uuid\n            PRIMARY\n            KEY\n            DEFAULT\n            gen_random_uuid\n        (\n        ),\n            normalized_name text NOT NULL,\n            display_name text NOT NULL,\n            orcid text NULL,\n            source_hint jsonb NULL,\n            created_at timestamptz NOT NULL DEFAULT now\n        (\n        ),\n            updated_at timestamptz NOT NULL DEFAULT now\n        (\n        )\n            )",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_article_authors_normalized_orcid\n            ON public.article_authors(normalized_name, COALESCE (orcid, ''))",
    "CREATE INDEX IF NOT EXISTS idx_article_authors_normalized_name\n            ON public.article_authors(normalized_name)",
    "CREATE TABLE IF NOT EXISTS public.article_author_links\n        (\n            id\n            uuid\n            PRIMARY\n            KEY\n            DEFAULT\n            gen_random_uuid\n        (\n        ),\n            article_id uuid NOT NULL REFERENCES public.articles\n        (\n            id\n        ) ON DELETE CASCADE,\n            author_id uuid NOT NULL REFERENCES public.article_authors\n        (\n            id\n        )\n          ON DELETE RESTRICT,\n            author_order integer NOT NULL,\n            creator_type text NOT NULL DEFAULT 'author',\n            raw_creator_payload jsonb NULL,\n            created_at timestamptz NOT NULL DEFAULT now\n        (\n        ),\n            updated_at timestamptz NOT NULL DEFAULT now\n        (\n        ),\n            CONSTRAINT article_author_links_article_id_author_order_key UNIQUE\n        (\n            article_id,\n            author_order\n        ),\n            CONSTRAINT article_author_links_article_id_author_id_creator_type_key UNIQUE\n        (\n            article_id,\n            author_id,\n            creator_type\n        )\n            )",
    "CREATE INDEX IF NOT EXISTS idx_article_author_links_article_id\n            ON public.article_author_links(article_id)",
    "CREATE INDEX IF NOT EXISTS idx_article_author_links_author_id\n            ON public.article_author_links(author_id)",
    "CREATE TABLE IF NOT EXISTS public.article_sync_runs\n        (\n            id\n            uuid\n            PRIMARY\n            KEY\n            DEFAULT\n            gen_random_uuid\n        (\n        ),\n            project_id uuid NOT NULL REFERENCES public.projects\n        (\n            id\n        ) ON DELETE CASCADE,\n            requested_by_user_id uuid NOT NULL,\n            started_at timestamptz NOT NULL DEFAULT now\n        (\n        ),\n            completed_at timestamptz NULL,\n            status text NOT NULL DEFAULT 'pending',\n            source text NOT NULL DEFAULT 'zotero',\n            source_collection_key text NULL,\n            total_received integer NOT NULL DEFAULT 0,\n            persisted integer NOT NULL DEFAULT 0,\n            updated integer NOT NULL DEFAULT 0,\n            skipped integer NOT NULL DEFAULT 0,\n            failed integer NOT NULL DEFAULT 0,\n            removed_at_source integer NOT NULL DEFAULT 0,\n            reactivated integer NOT NULL DEFAULT 0,\n            failure_summary jsonb NULL,\n            created_at timestamptz NOT NULL DEFAULT now\n        (\n        ),\n            updated_at timestamptz NOT NULL DEFAULT now\n        (\n        )\n            )",
    "CREATE INDEX IF NOT EXISTS idx_article_sync_runs_project_id\n            ON public.article_sync_runs(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_article_sync_runs_requested_by_user_id\n            ON public.article_sync_runs(requested_by_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_article_sync_runs_status\n            ON public.article_sync_runs(status)",
    "CREATE TABLE IF NOT EXISTS public.article_sync_events\n        (\n            id\n            uuid\n            PRIMARY\n            KEY\n            DEFAULT\n            gen_random_uuid\n        (\n        ),\n            project_id uuid NOT NULL REFERENCES public.projects\n        (\n            id\n        ) ON DELETE CASCADE,\n            article_id uuid NULL REFERENCES public.articles\n        (\n            id\n        )\n          ON DELETE SET NULL,\n            sync_run_id uuid NOT NULL REFERENCES public.article_sync_runs\n        (\n            id\n        )\n          ON DELETE CASCADE,\n            zotero_item_key text NULL,\n            status text NOT NULL,\n            authority_rule_applied text NULL,\n            error_code text NULL,\n            error_message text NULL,\n            event_payload jsonb NULL,\n            processed_at timestamptz NOT NULL DEFAULT now\n        (\n        ),\n            created_at timestamptz NOT NULL DEFAULT now\n        (\n        ),\n            updated_at timestamptz NOT NULL DEFAULT now\n        (\n        )\n            )",
    "CREATE INDEX IF NOT EXISTS idx_article_sync_events_sync_run_id\n            ON public.article_sync_events(sync_run_id)",
    "CREATE INDEX IF NOT EXISTS idx_article_sync_events_project_id\n            ON public.article_sync_events(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_article_sync_events_status\n            ON public.article_sync_events(status)",
)

_UPGRADE_RLS = (
    "ALTER TABLE public.article_authors ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE public.article_author_links ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE public.article_sync_runs ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE public.article_sync_events ENABLE ROW LEVEL SECURITY",
    'CREATE\n        POLICY "article_authors_select"\n            ON public.article_authors FOR\n        SELECT TO authenticated\n            USING (\n            EXISTS (\n            SELECT 1\n            FROM public.article_author_links aal\n            JOIN public.articles a ON a.id = aal.article_id\n            JOIN public.project_members pm ON pm.project_id = a.project_id\n            WHERE aal.author_id = article_authors.id\n            AND pm.user_id = auth.uid()\n            )\n            )',
    'CREATE\n        POLICY "article_authors_manage"\n            ON public.article_authors FOR ALL TO authenticated\n            USING (true)\n            WITH CHECK (true)',
    'CREATE\n        POLICY "article_author_links_select"\n            ON public.article_author_links FOR\n        SELECT TO authenticated\n            USING (\n            EXISTS (\n            SELECT 1\n            FROM public.articles a\n            JOIN public.project_members pm ON pm.project_id = a.project_id\n            WHERE a.id = article_author_links.article_id\n            AND pm.user_id = auth.uid()\n            )\n            )',
    'CREATE\n        POLICY "article_author_links_insert"\n            ON public.article_author_links FOR INSERT TO authenticated\n            WITH CHECK (\n                EXISTS (\n                    SELECT 1\n                    FROM public.articles a\n                    JOIN public.project_members pm ON pm.project_id = a.project_id\n                    WHERE a.id = article_author_links.article_id\n                      AND pm.user_id = auth.uid()\n                )\n            )',
    'CREATE\n        POLICY "article_author_links_update"\n            ON public.article_author_links FOR\n        UPDATE TO authenticated\n            USING (\n            EXISTS (\n            SELECT 1\n            FROM public.articles a\n            JOIN public.project_members pm ON pm.project_id = a.project_id\n            WHERE a.id = article_author_links.article_id\n            AND pm.user_id = auth.uid()\n            )\n            )\n        WITH CHECK (\n            EXISTS (\n            SELECT 1\n            FROM public.articles a\n            JOIN public.project_members pm ON pm.project_id = a.project_id\n            WHERE a.id = article_author_links.article_id\n            AND pm.user_id = auth.uid()\n            )\n            )',
    'CREATE\n        POLICY "article_author_links_delete"\n            ON public.article_author_links FOR DELETE\n        TO authenticated\n            USING (\n                EXISTS (\n                    SELECT 1\n                    FROM public.articles a\n                    JOIN public.project_members pm ON pm.project_id = a.project_id\n                    WHERE a.id = article_author_links.article_id\n                      AND pm.user_id = auth.uid()\n                )\n            )',
    'CREATE\n        POLICY "article_sync_runs_select"\n            ON public.article_sync_runs FOR\n        SELECT TO authenticated\n            USING (\n            EXISTS (\n            SELECT 1\n            FROM public.project_members pm\n            WHERE pm.project_id = article_sync_runs.project_id\n            AND pm.user_id = auth.uid()\n            )\n            )',
    'CREATE\n        POLICY "article_sync_runs_insert"\n            ON public.article_sync_runs FOR INSERT TO authenticated\n            WITH CHECK (\n                EXISTS (\n                    SELECT 1\n                    FROM public.project_members pm\n                    WHERE pm.project_id = article_sync_runs.project_id\n                      AND pm.user_id = auth.uid()\n                )\n            )',
    'CREATE\n        POLICY "article_sync_runs_update"\n            ON public.article_sync_runs FOR\n        UPDATE TO authenticated\n            USING (\n            EXISTS (\n            SELECT 1\n            FROM public.project_members pm\n            WHERE pm.project_id = article_sync_runs.project_id\n            AND pm.user_id = auth.uid()\n            )\n            )\n        WITH CHECK (\n            EXISTS (\n            SELECT 1\n            FROM public.project_members pm\n            WHERE pm.project_id = article_sync_runs.project_id\n            AND pm.user_id = auth.uid()\n            )\n            )',
    'CREATE\n        POLICY "article_sync_runs_delete"\n            ON public.article_sync_runs FOR DELETE\n        TO authenticated\n            USING (\n                EXISTS (\n                    SELECT 1\n                    FROM public.project_members pm\n                    WHERE pm.project_id = article_sync_runs.project_id\n                      AND pm.user_id = auth.uid()\n                )\n            )',
    'CREATE\n        POLICY "article_sync_events_select"\n            ON public.article_sync_events FOR\n        SELECT TO authenticated\n            USING (\n            EXISTS (\n            SELECT 1\n            FROM public.project_members pm\n            WHERE pm.project_id = article_sync_events.project_id\n            AND pm.user_id = auth.uid()\n            )\n            )',
    'CREATE\n        POLICY "article_sync_events_insert"\n            ON public.article_sync_events FOR INSERT TO authenticated\n            WITH CHECK (\n                EXISTS (\n                    SELECT 1\n                    FROM public.project_members pm\n                    WHERE pm.project_id = article_sync_events.project_id\n                      AND pm.user_id = auth.uid()\n                )\n            )',
    'CREATE\n        POLICY "article_sync_events_update"\n            ON public.article_sync_events FOR\n        UPDATE TO authenticated\n            USING (\n            EXISTS (\n            SELECT 1\n            FROM public.project_members pm\n            WHERE pm.project_id = article_sync_events.project_id\n            AND pm.user_id = auth.uid()\n            )\n            )\n        WITH CHECK (\n            EXISTS (\n            SELECT 1\n            FROM public.project_members pm\n            WHERE pm.project_id = article_sync_events.project_id\n            AND pm.user_id = auth.uid()\n            )\n            )',
    'CREATE\n        POLICY "article_sync_events_delete"\n            ON public.article_sync_events FOR DELETE\n        TO authenticated\n            USING (\n                EXISTS (\n                    SELECT 1\n                    FROM public.project_members pm\n                    WHERE pm.project_id = article_sync_events.project_id\n                      AND pm.user_id = auth.uid()\n                )\n            )',
)

_DOWNGRADE_SQL = (
    'DROP POLICY IF EXISTS "article_sync_events_delete" ON public.article_sync_events',
    'DROP POLICY IF EXISTS "article_sync_events_update" ON public.article_sync_events',
    'DROP POLICY IF EXISTS "article_sync_events_insert" ON public.article_sync_events',
    'DROP POLICY IF EXISTS "article_sync_events_select" ON public.article_sync_events',
    'DROP POLICY IF EXISTS "article_sync_runs_delete" ON public.article_sync_runs',
    'DROP POLICY IF EXISTS "article_sync_runs_update" ON public.article_sync_runs',
    'DROP POLICY IF EXISTS "article_sync_runs_insert" ON public.article_sync_runs',
    'DROP POLICY IF EXISTS "article_sync_runs_select" ON public.article_sync_runs',
    'DROP POLICY IF EXISTS "article_author_links_delete" ON public.article_author_links',
    'DROP POLICY IF EXISTS "article_author_links_update" ON public.article_author_links',
    'DROP POLICY IF EXISTS "article_author_links_insert" ON public.article_author_links',
    'DROP POLICY IF EXISTS "article_author_links_select" ON public.article_author_links',
    'DROP POLICY IF EXISTS "article_authors_manage" ON public.article_authors',
    'DROP POLICY IF EXISTS "article_authors_select" ON public.article_authors',
    "DROP TABLE IF EXISTS public.article_sync_events",
    "DROP TABLE IF EXISTS public.article_sync_runs",
    "DROP TABLE IF EXISTS public.article_author_links",
    "DROP TABLE IF EXISTS public.article_authors",
    "DROP INDEX IF EXISTS public.idx_articles_last_synced_at",
    "DROP INDEX IF EXISTS public.idx_articles_sync_state",
    "ALTER TABLE public.articles\n            DROP COLUMN IF EXISTS source_lineage,\n            DROP COLUMN IF EXISTS semantic_fulltext_text,\n            DROP COLUMN IF EXISTS semantic_abstract_text,\n            DROP COLUMN IF EXISTS pdf_extracted_text,\n            DROP COLUMN IF EXISTS sync_conflict_log,\n            DROP COLUMN IF EXISTS last_synced_at,\n            DROP COLUMN IF EXISTS removed_at_source_at,\n            DROP COLUMN IF EXISTS sync_state",
)


def upgrade() -> None:
    _run_statements(_UPGRADE_DDL)
    _run_statements(_UPGRADE_RLS)


def downgrade() -> None:
    _run_statements(_DOWNGRADE_SQL)

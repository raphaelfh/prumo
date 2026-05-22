"""lock article_authors_insert and enable RLS on alembic_version

Revision ID: 0018_lock_article_authors_rls
Revises: 0017_backfill_role_in_snapshot
Create Date: 2026-05-21

Two Supabase advisor warnings closed here:

1. ``rls_policy_always_true`` on ``public.article_authors``: the
   ``article_authors_insert`` policy was ``WITH CHECK (true)``, letting
   any authenticated user INSERT (BOLA-like). The backend is the only
   writer (via ``ArticleAuthorRepository``); it uses the service role
   which bypasses RLS. The frontend never INSERTs directly. Drop the
   policy so authenticated cannot INSERT at all.

2. ``rls_disabled_in_public`` (ERROR-level) on ``public.alembic_version``:
   Alembic creates this table without RLS. Enable RLS and add no
   policies — authenticated/anon cannot read/write; the service role
   used by the migration runner bypasses RLS, so ``alembic upgrade
   head`` keeps working.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0018_lock_article_authors_rls"
down_revision = "0017_backfill_role_in_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- article_authors: lock INSERT --------------------------------------
    # SELECT/UPDATE/DELETE policies stay; they already gate by membership
    # through the article_author_links -> articles -> project_members chain.
    op.execute('DROP POLICY IF EXISTS "article_authors_insert" ON public.article_authors;')

    # --- alembic_version: enable RLS, no policies = deny all non-bypassing
    op.execute("ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY;")


def downgrade() -> None:
    op.execute("ALTER TABLE public.alembic_version DISABLE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY "article_authors_insert" ON public.article_authors
        FOR INSERT TO authenticated WITH CHECK (true);
        """
    )

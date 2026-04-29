"""storage.objects RLS policies for the articles bucket

Revision ID: 0003_storage_object_policies
Revises: 0002_drop_extracted_values
Create Date: 2026-04-28

These policies live ON ``storage.objects`` but consult public tables
(``article_files`` + ``projects``), so they have to be created here —
Alembic owns the public schema, supabase migrations own auth/storage
DDL but cannot reference our tables.

The squashed ``0001_baseline_v1`` was generated via
``supabase db dump --schema=public`` which strips everything outside
``public``, so the original storage policies (previously written by
the unsquashed ``0001_initial_public_schema.py``) didn't survive.
Without them, the storage bucket has RLS enabled but zero policies →
every upload fails with ``new row violates row-level security``.

This migration restores the four article-bucket policies (SELECT,
INSERT, UPDATE, DELETE), each scoped to project members through the
``is_project_member`` helper that the baseline already defined.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0003_storage_object_policies"
down_revision = "0002_drop_extracted_values"
branch_labels = None
depends_on = None


_SELECT_POLICY = """
    CREATE POLICY "Members can view article files"
    ON storage.objects FOR SELECT
    USING (
      bucket_id = 'articles' AND
      EXISTS (
        SELECT 1 FROM public.article_files af
        JOIN public.projects p ON p.id = af.project_id
        WHERE af.storage_key = storage.objects.name
        AND public.is_project_member(p.id, auth.uid())
      )
    );
"""

_INSERT_POLICY = """
    CREATE POLICY "Authenticated users can upload article files"
    ON storage.objects FOR INSERT
    WITH CHECK (
      bucket_id = 'articles' AND
      auth.uid() IS NOT NULL
    );
"""

_UPDATE_POLICY = """
    CREATE POLICY "Members can update article files"
    ON storage.objects FOR UPDATE
    USING (
      bucket_id = 'articles' AND
      EXISTS (
        SELECT 1 FROM public.article_files af
        JOIN public.projects p ON p.id = af.project_id
        WHERE af.storage_key = storage.objects.name
        AND public.is_project_member(p.id, auth.uid())
      )
    );
"""

_DELETE_POLICY = """
    CREATE POLICY "Members can delete article files"
    ON storage.objects FOR DELETE
    USING (
      bucket_id = 'articles' AND
      EXISTS (
        SELECT 1 FROM public.article_files af
        JOIN public.projects p ON p.id = af.project_id
        WHERE af.storage_key = storage.objects.name
        AND public.is_project_member(p.id, auth.uid())
      )
    );
"""


def _drop_all() -> None:
    op.execute('DROP POLICY IF EXISTS "Members can view article files" ON storage.objects;')
    op.execute(
        'DROP POLICY IF EXISTS "Authenticated users can upload article files" ON storage.objects;'
    )
    op.execute('DROP POLICY IF EXISTS "Members can update article files" ON storage.objects;')
    op.execute('DROP POLICY IF EXISTS "Members can delete article files" ON storage.objects;')


def upgrade() -> None:
    # Drop first so the migration is idempotent across re-runs (the
    # policies live on storage.objects, which survives ``DROP SCHEMA
    # public CASCADE`` in the baseline downgrade).
    _drop_all()
    op.execute(_SELECT_POLICY)
    op.execute(_INSERT_POLICY)
    op.execute(_UPDATE_POLICY)
    op.execute(_DELETE_POLICY)


def downgrade() -> None:
    _drop_all()

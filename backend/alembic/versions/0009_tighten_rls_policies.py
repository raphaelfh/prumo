"""tighten always-true RLS policies on article_authors and feedback_reports

Revision ID: 0009_tighten_rls_policies
Revises: 0008_function_hardening
Create Date: 2026-04-29

Two RLS policies were flagged by the ``rls_policy_always_true`` linter:

1. ``article_authors.article_authors_manage`` — ``ALL`` for authenticated
   with both USING and WITH CHECK = true. The companion
   ``article_authors_select`` already restricts SELECT through the
   article_author_links → articles → project_members chain. We drop the
   blanket policy and add per-command policies so writes follow the same
   project-membership gate (INSERT stays open because new authors must be
   inserted before any link exists).

2. ``feedback_reports.feedback_reports_insert`` — INSERT with WITH CHECK
   = true and an empty role list (so even ``anon`` could INSERT). Restrict
   to ``authenticated`` and force ``user_id = auth.uid()`` so no one can
   spoof another user's feedback.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0009_tighten_rls_policies"
down_revision = "0008_function_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- article_authors -----------------------------------------------
    # Drop the blanket ALL-true policy. The existing ``article_authors_select``
    # policy stays in place — it already restricts reads to project members.
    op.execute('DROP POLICY IF EXISTS "article_authors_manage" ON public.article_authors;')

    op.execute(
        """
        CREATE POLICY "article_authors_insert" ON public.article_authors
        FOR INSERT TO authenticated WITH CHECK (true);
        """
    )
    op.execute(
        """
        CREATE POLICY "article_authors_update" ON public.article_authors
        FOR UPDATE TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM public.article_author_links aal
            JOIN public.articles a ON a.id = aal.article_id
            WHERE aal.author_id = article_authors.id
              AND public.is_project_member(a.project_id, auth.uid())
          )
        );
        """
    )
    op.execute(
        """
        CREATE POLICY "article_authors_delete" ON public.article_authors
        FOR DELETE TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM public.article_author_links aal
            JOIN public.articles a ON a.id = aal.article_id
            WHERE aal.author_id = article_authors.id
              AND public.is_project_manager(a.project_id, auth.uid())
          )
        );
        """
    )

    # --- feedback_reports ----------------------------------------------
    op.execute('DROP POLICY IF EXISTS "feedback_reports_insert" ON public.feedback_reports;')

    op.execute(
        """
        CREATE POLICY "feedback_reports_insert" ON public.feedback_reports
        FOR INSERT TO authenticated
        WITH CHECK (user_id = auth.uid());
        """
    )


def downgrade() -> None:
    # --- feedback_reports ----------------------------------------------
    op.execute('DROP POLICY IF EXISTS "feedback_reports_insert" ON public.feedback_reports;')
    op.execute(
        """
        CREATE POLICY "feedback_reports_insert" ON public.feedback_reports
        FOR INSERT WITH CHECK (true);
        """
    )

    # --- article_authors -----------------------------------------------
    op.execute('DROP POLICY IF EXISTS "article_authors_delete" ON public.article_authors;')
    op.execute('DROP POLICY IF EXISTS "article_authors_update" ON public.article_authors;')
    op.execute('DROP POLICY IF EXISTS "article_authors_insert" ON public.article_authors;')

    op.execute(
        """
        CREATE POLICY "article_authors_manage" ON public.article_authors
        FOR ALL TO authenticated USING (true) WITH CHECK (true);
        """
    )

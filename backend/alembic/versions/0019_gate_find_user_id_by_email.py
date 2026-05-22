"""gate find_user_id_by_email by project_id + manager check

Revision ID: 0019_gate_find_user_id_by_email
Revises: 0018_lock_article_authors_and_alembic_version
Create Date: 2026-05-21

Supabase advisor flagged
``authenticated_security_definer_function_executable`` on
``public.find_user_id_by_email(p_email text)`` — any signed-in user can
enumerate ``auth.users`` UUIDs by email via
``/rest/v1/rpc/find_user_id_by_email``.

Replace the single-arg overload with a two-arg version that takes
``p_project_id`` and rejects callers that are not project managers of
that project. Managers already see all member emails through
``get_project_members``, so this collapses the enumeration surface to
data the caller already has.

The frontend ``TeamMembersSection`` is updated in the same PR to pass
``p_project_id`` alongside ``p_email``.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0019_gate_find_user_id_by_email"
down_revision = "0018_lock_article_authors_rls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS public.find_user_id_by_email(text);")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.find_user_id_by_email(
            p_email text,
            p_project_id uuid
        )
        RETURNS uuid
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_catalog
        AS $fn$
        BEGIN
          IF NOT public.is_project_manager(p_project_id, auth.uid()) THEN
            RAISE EXCEPTION 'forbidden: caller is not a manager of the target project'
              USING ERRCODE = '42501';
          END IF;
          RETURN (
            SELECT id FROM auth.users WHERE email = p_email LIMIT 1
          );
        END;
        $fn$;
        """
    )

    op.execute(
        "REVOKE EXECUTE ON FUNCTION public.find_user_id_by_email(text, uuid) FROM anon, PUBLIC;"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(text, uuid) TO authenticated;"
    )


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS public.find_user_id_by_email(text, uuid);")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email text)
        RETURNS uuid
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_catalog
        AS $fn$
        BEGIN
          RETURN (
            SELECT id FROM auth.users WHERE email = p_email LIMIT 1
          );
        END;
        $fn$;
        """
    )
    op.execute("REVOKE EXECUTE ON FUNCTION public.find_user_id_by_email(text) FROM anon, PUBLIC;")
    op.execute("GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(text) TO authenticated;")

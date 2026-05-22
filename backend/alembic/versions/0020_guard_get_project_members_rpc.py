"""guard get_project_members by project membership

Revision ID: 0020_guard_get_project_members_rpc
Revises: 0019_gate_find_user_id_by_email
Create Date: 2026-05-22

``public.get_project_members(p_project_id)`` is exposed through Supabase
PostgREST as an authenticated RPC and runs as ``SECURITY DEFINER`` so it
can join ``auth.users`` for member email addresses. Without an explicit
membership gate inside the function, any signed-in user can pass any
project UUID and bypass ``project_members`` RLS to list that project's
roster and emails.

Mirror the 0019 hardening pattern: keep the RPC available to authenticated
users, but reject callers who are not members of the requested project
before reading ``auth.users`` or ``profiles``.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0020_guard_get_project_members_rpc"
down_revision = "0019_gate_find_user_id_by_email"
branch_labels = None
depends_on = None


_RETURNS_TABLE = """
RETURNS TABLE (
    id uuid,
    user_id uuid,
    role public.project_member_role,
    permissions jsonb,
    created_at timestamp with time zone,
    user_email text,
    user_full_name text,
    user_avatar_url text
)
"""


def upgrade() -> None:
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION public.get_project_members(p_project_id uuid)
        {_RETURNS_TABLE}
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_catalog
        AS $fn$
        BEGIN
          IF NOT public.is_project_member(p_project_id, auth.uid()) THEN
            RAISE EXCEPTION 'forbidden: caller is not a member of the target project'
              USING ERRCODE = '42501';
          END IF;

          RETURN QUERY
          SELECT pm.id,
                 pm.user_id,
                 pm.role,
                 pm.permissions,
                 pm.created_at,
                 u.email::text AS user_email,
                 p.full_name::text AS user_full_name,
                 p.avatar_url::text AS user_avatar_url
          FROM public.project_members pm
          JOIN auth.users u ON u.id = pm.user_id
          LEFT JOIN public.profiles p ON p.id = pm.user_id
          WHERE pm.project_id = p_project_id;
        END;
        $fn$;
        """
    )
    op.execute(
        "REVOKE EXECUTE ON FUNCTION public.get_project_members(uuid) FROM anon, PUBLIC;"
    )
    op.execute("GRANT EXECUTE ON FUNCTION public.get_project_members(uuid) TO authenticated;")
    op.execute("GRANT EXECUTE ON FUNCTION public.get_project_members(uuid) TO service_role;")


def downgrade() -> None:
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION public.get_project_members(p_project_id uuid)
        {_RETURNS_TABLE}
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_catalog
        AS $fn$
        BEGIN
          RETURN QUERY
          SELECT pm.id,
                 pm.user_id,
                 pm.role,
                 pm.permissions,
                 pm.created_at,
                 u.email::text AS user_email,
                 p.full_name::text AS user_full_name,
                 p.avatar_url::text AS user_avatar_url
          FROM public.project_members pm
          JOIN auth.users u ON u.id = pm.user_id
          LEFT JOIN public.profiles p ON p.id = pm.user_id
          WHERE pm.project_id = p_project_id;
        END;
        $fn$;
        """
    )
    op.execute(
        "REVOKE EXECUTE ON FUNCTION public.get_project_members(uuid) FROM anon, PUBLIC;"
    )
    op.execute("GRANT EXECUTE ON FUNCTION public.get_project_members(uuid) TO authenticated;")
    op.execute("GRANT EXECUTE ON FUNCTION public.get_project_members(uuid) TO service_role;")

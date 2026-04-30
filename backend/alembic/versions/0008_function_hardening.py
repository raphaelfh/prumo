"""harden public functions: pin search_path + revoke anon EXECUTE on SECURITY DEFINER

Revision ID: 0008_function_hardening
Revises: 0007_drop_migration_status
Create Date: 2026-04-29

Two classes of fixes flagged by the Supabase database linter:

1. ``function_search_path_mutable`` — every function under public must
   pin ``search_path`` to a known list so callers cannot redirect lookups
   to a hostile schema. We set ``search_path = public, pg_catalog``.

2. ``anon_security_definer_function_executable`` /
   ``authenticated_security_definer_function_executable`` — every
   ``SECURITY DEFINER`` function under public is callable through
   ``/rest/v1/rpc/<fn>`` by default. Most of these are RLS helpers
   (``is_project_*``) and trigger-only helpers (``handle_new_user``)
   that should not be exposed as RPC. We revoke EXECUTE from ``anon``
   and ``public`` and grant only the roles that actually need it.

The full list of SECURITY DEFINER functions:
  - ``handle_new_user()`` — trigger only, no RPC role needs EXECUTE
  - ``is_project_member`` / ``is_project_manager`` / ``is_project_reviewer``
    — RLS helpers; ``authenticated`` keeps EXECUTE so RLS evaluates,
    ``anon`` is revoked
  - ``check_cardinality_one`` — RPC used by the frontend, ``authenticated`` only
  - ``create_project_with_member`` — RPC used by the frontend, ``authenticated`` only
  - ``find_user_id_by_email`` — RPC used by the frontend, ``authenticated`` only
  - ``get_project_members`` — RPC used by the frontend, ``authenticated`` only
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0008_function_hardening"
down_revision = "0007_drop_migration_status"
branch_labels = None
depends_on = None


# Functions that only need search_path pinning (no SECURITY DEFINER).
_SEARCH_PATH_ONLY = [
    "set_updated_at()",
    "update_updated_at_column()",
    "enforce_consensus_override_justification()",
    "validate_extraction_instance_hierarchy()",
    "validate_instance_project_consistency()",
    "assert_project_template_has_active_version()",
    "ensure_single_default_api_key()",
    "calculate_model_progress(p_project_id uuid, p_article_id uuid)",
]


# SECURITY DEFINER functions: pin search_path + revoke anon/public EXECUTE.
# Each entry maps signature → roles that should retain EXECUTE.
_SECURITY_DEFINER = {
    "handle_new_user()": [],  # trigger only
    "is_project_member(p_project_id uuid, p_user_id uuid)": ["authenticated"],
    "is_project_manager(p_project_id uuid, p_user_id uuid)": ["authenticated"],
    "is_project_reviewer(p_project_id uuid, p_user_id uuid)": ["authenticated"],
    "check_cardinality_one(p_article_id uuid, p_entity_type_id uuid, p_parent_instance_id uuid)": [
        "authenticated"
    ],
    "create_project_with_member(p_name text, p_description text, p_review_type review_type, p_created_by uuid)": [
        "authenticated"
    ],
    "find_user_id_by_email(p_email text)": ["authenticated"],
    "get_project_members(p_project_id uuid)": ["authenticated"],
}


def upgrade() -> None:
    for sig in _SEARCH_PATH_ONLY:
        op.execute(f"ALTER FUNCTION public.{sig} SET search_path = public, pg_catalog;")

    for sig, keep_roles in _SECURITY_DEFINER.items():
        op.execute(f"ALTER FUNCTION public.{sig} SET search_path = public, pg_catalog;")
        op.execute(f"REVOKE EXECUTE ON FUNCTION public.{sig} FROM anon, PUBLIC;")
        for role in keep_roles:
            op.execute(f"GRANT EXECUTE ON FUNCTION public.{sig} TO {role};")


def downgrade() -> None:
    for sig in _SEARCH_PATH_ONLY:
        op.execute(f"ALTER FUNCTION public.{sig} RESET search_path;")

    for sig, keep_roles in _SECURITY_DEFINER.items():
        op.execute(f"ALTER FUNCTION public.{sig} RESET search_path;")
        # Restore the broader default grants Supabase ships with.
        op.execute(f"GRANT EXECUTE ON FUNCTION public.{sig} TO anon, authenticated, service_role;")
        for role in keep_roles:
            # No-op: the GRANT above already covers them.
            _ = role

"""revoke EXECUTE on handle_new_user from authenticated

Revision ID: 0010_lock_handle_new_user
Revises: 0009_tighten_rls_policies
Create Date: 2026-04-29

``handle_new_user()`` only runs through the ``on_auth_user_created``
trigger on ``auth.users``. The trigger fires with the function's owner
privileges (``SECURITY DEFINER``), so signed-in users do not need
``EXECUTE`` to make profile creation work — and exposing it via
``/rest/v1/rpc/handle_new_user`` lets a logged-in user call it
directly with a forged ``NEW`` record. Drop the grant.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0010_lock_handle_new_user"
down_revision = "0009_tighten_rls_policies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;")


def downgrade() -> None:
    op.execute("GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated;")

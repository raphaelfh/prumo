"""Close the anon RPC oracle 0058 opened on ``can_read_entity_type``.

0058 scoped the entity-type / field SELECT policies to project members and
granted the helper they call to ``anon, authenticated, service_role`` so
the policy could still be evaluated for every caller that holds SELECT.

That grant exposes the helper at ``/rest/v1/rpc/can_read_entity_type``,
where the publishable anon key is enough to call it. It returns a boolean,
so an unauthenticated caller can use it as an oracle: given an entity type
id, probe user ids to learn who is a member of the owning project.

Supabase's ``anon_security_definer_function_executable`` advisor flags it,
and the check confirmed it is the **only** SECURITY DEFINER function in
``public`` that ``anon`` may execute — ``is_project_member``,
``is_project_manager``, ``is_project_reviewer`` and
``is_project_arbitrator`` are all granted to ``authenticated`` and never
to ``anon``. 0058 broke that established posture; this restores it.

Practical exploitability was low — it needs two random uuids, and for
global-catalogue rows the function returns true for everyone and leaks
nothing. Project-lineage ids are freshly generated per clone. Narrow, but
real, new, and cheap to close.

**Also revokes anon's SELECT on both tables.** Leaving the table grant
while removing the function grant would turn an anon read into a
permission error on the function rather than a clean denial, and it would
leave the anon surface half-closed for no benefit. 0058 deliberately left
"should the global catalogue be anon-readable at all" open; the advisor
answers it — preserving anon reads costs an anon-executable SECURITY
DEFINER function, which is a worse trade than closing them. Every frontend
read of these tables runs on an authenticated session (the config editor
and the import dialog are both post-login), so nothing legitimate
regresses.

``service_role`` and ``authenticated`` are untouched: the backend connects
as ``service_role`` (bypassing RLS entirely) and the app's real callers
are ``authenticated``.

**The crash 0058 could not explain, explained.** 0058's docstring records
that an earlier nested-EXISTS draft of its policy segfaulted the Postgres
backend under ``set role anon`` and could not be reproduced. It can be,
and the trigger is now characterised:

    An RLS policy expression that calls a SECURITY DEFINER function the
    CURRENT ROLE lacks EXECUTE on segfaults this Postgres (17.6, Supabase
    build) instead of raising "permission denied for function".

The nested draft called ``is_project_member`` directly from the policy,
and ``anon`` may not execute it — hence the crash. The shipped helper form
survived only because 0058 granted ``anon`` EXECUTE on
``can_read_entity_type``: inside a SECURITY DEFINER function the inner
``is_project_member`` call runs as the definer, so no permission check
happens. That grant was load-bearing, not sloppiness.

The 2026-08-23 reproduction attempt failed because its repro script
granted ``anon`` EXECUTE — it accidentally included the very thing that
prevents the crash. Confirmed here by controlled experiment: revoke the
grant, re-grant table SELECT, query as anon → segfault, reproducibly.

This migration is safe from it. Removing anon's table SELECT means the
policy is never evaluated for anon at all: the read is refused with
"permission denied for table" before any function is reached. Restoring
the grant WITHOUT the EXECUTE grant would reintroduce the crash, which is
why ``downgrade`` restores both together and why the read-RLS probes
assert anon's privilege rather than issuing an anon SELECT.

``downgrade`` restores exactly what was revoked, returning to 0058's state.

Revision ID: 0060_revoke_anon_entity_key
Revises: 0059_entity_key_field
"""

from alembic import op

revision = "0060_revoke_anon_entity_key"
down_revision = "0059_entity_key_field"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # REVOKE FROM anon alone is a SILENT NO-OP here: Postgres grants EXECUTE
    # on every new function to PUBLIC by default, so anon keeps the privilege
    # through PUBLIC even after its explicit grant is gone. Verified on the
    # function's ACL, which read
    # {=X/postgres, postgres=X, authenticated=X, service_role=X} — that
    # leading "=X" IS the PUBLIC grant. Revoke it, then re-grant the two roles
    # that must keep it. Same family as a column-level REVOKE being a no-op
    # over a table grant.
    op.execute("REVOKE EXECUTE ON FUNCTION public.can_read_entity_type(uuid, uuid) FROM PUBLIC;")
    op.execute("REVOKE EXECUTE ON FUNCTION public.can_read_entity_type(uuid, uuid) FROM anon;")
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.can_read_entity_type(uuid, uuid) "
        "TO authenticated, service_role;"
    )
    op.execute(
        "REVOKE SELECT ON public.extraction_entity_types, public.extraction_fields FROM anon;"
    )


def downgrade() -> None:
    op.execute("GRANT EXECUTE ON FUNCTION public.can_read_entity_type(uuid, uuid) TO PUBLIC;")
    op.execute("GRANT EXECUTE ON FUNCTION public.can_read_entity_type(uuid, uuid) TO anon;")
    op.execute("GRANT SELECT ON public.extraction_entity_types, public.extraction_fields TO anon;")

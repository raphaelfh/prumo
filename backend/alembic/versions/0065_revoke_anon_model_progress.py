"""Revoke anon's EXECUTE on ``calculate_model_progress``.

0060 restored the posture that no SECURITY DEFINER function in ``public``
is callable by ``anon``, and pinned it with a class-wide test rather than a
single-function one. That test has been failing on any freshly built
database ever since, and the reason is that 0060 closed the function 0058
opened while an older one was still open.

``calculate_model_progress`` is the last member of the class.
``0022_scope_model_progress_run`` recreates it with
``CREATE OR REPLACE FUNCTION`` and then runs only::

    REVOKE ALL ON FUNCTION public.calculate_model_progress(uuid, uuid) FROM PUBLIC;
    GRANT EXECUTE ... TO authenticated, service_role;

That is the inverse of the trap 0060's own comment documents, and it is why
the half-revoke survived review: ``FROM PUBLIC`` is the right call when the
privilege arrives through PUBLIC, but here it arrives as a DIRECT grant to
``anon``. Supabase ships a default ACL on the schema —
``pg_default_acl`` holds ``postgres|f|{postgres=X/postgres, anon=X/postgres,
authenticated=X/postgres, service_role=X/postgres}`` — so every function
created in ``public`` is granted to ``anon`` by name at creation time.
Revoking PUBLIC never touches it. The live ACL confirmed it::

    {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}

There is no leading ``=X`` (no PUBLIC grant) — 0022's revoke did work. The
``anon=X`` beside it is the default ACL's, and nothing has ever removed it.

Exposure: the function is reachable at ``/rest/v1/rpc/calculate_model_progress``
with the publishable anon key. It takes two uuids and returns progress for an
article/model pair, so an unauthenticated caller who can guess or obtain those
ids learns whether the pair exists and how far its extraction has got. Narrow
— the ids are random uuids and are not enumerable — but it is a SECURITY
DEFINER function running with the owner's privileges, which is exactly the
class 0060 decided should be empty.

``authenticated`` and ``service_role`` keep EXECUTE: the backend connects as
``service_role`` and every real caller is ``authenticated``. Both are re-granted
explicitly rather than left to the earlier grant, so this migration is
idempotent against the ACL it inherits.

Verified against a database rebuilt end to end (``make db-fresh``): the
class-wide probe in ``tests/integration/test_anon_entity_key_revoked.py``
goes from one leaked function to none, and the other twelve SECURITY DEFINER
functions in ``public`` were already correctly closed.

NOTE ON CI: the Backend Tests job passes this test today WITHOUT this fix,
because CI's database is built from Alembic against plain Postgres and has no
Supabase ``pg_default_acl`` granting ``anon``. CI cannot observe this bug
class at all. Local (and prod) can, which is why the local gate caught it.

``downgrade`` restores the anon grant, returning to 0022's state.

Revision ID: 0065_revoke_anon_model_prog
Revises: 0064_flatten_picots_timing
"""

from alembic import op

revision = "0065_revoke_anon_model_prog"
down_revision = "0064_flatten_picots_timing"
branch_labels = None
depends_on = None

_FN = "public.calculate_model_progress(uuid, uuid)"


def upgrade() -> None:
    # Both revokes, deliberately. FROM PUBLIC is what 0022 already did and is
    # kept so this holds on a database where the privilege arrived that way
    # instead; FROM anon is the one that actually removes the default ACL's
    # direct grant here. Neither is sufficient alone across both shapes.
    op.execute(f"REVOKE EXECUTE ON FUNCTION {_FN} FROM PUBLIC;")
    op.execute(f"REVOKE EXECUTE ON FUNCTION {_FN} FROM anon;")
    op.execute(f"GRANT EXECUTE ON FUNCTION {_FN} TO authenticated, service_role;")


def downgrade() -> None:
    op.execute(f"GRANT EXECUTE ON FUNCTION {_FN} TO anon;")

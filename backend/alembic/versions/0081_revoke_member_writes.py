"""API-only writes for article text and extraction history; append-only trigger.

One write path. Article text (``article_files``, ``article_text_blocks``) and
the extraction history (evidence, reviewer decisions and states, consensus
decisions, published states, proposal records) are written by the backend
only: its endpoints validate, lock and record provenance. This migration
revokes INSERT/UPDATE/DELETE on those tables from ``authenticated`` (INSERT and
UPDATE only on ``article_files``). The table-level revoke on
``extraction_proposal_records`` also drops the per-column INSERT/UPDATE grants
0056 left there. Shape follows ``0077_revoke_project_writes``.

The RLS policies stay as the floor under any future grant.

What stays readable: SELECT is untouched on every table here, so the
frontend's PostgREST reads keep working. ``authenticated`` keeps DELETE on
``article_files``; its FK cascades remove the file's text blocks and null the
evidence link.

Append-only history. ``refuse_append_only_change`` refuses UPDATE and DELETE on
reviewer decisions, consensus decisions and proposal records for every role
except the table's owner (SQLSTATE 42501). FK cascades run as the owner of the
referencing table and the backend connects as the owner, so instance/run
deletes and the backend's own corrections keep working.

``downgrade`` re-grants exactly what was revoked (for proposal records: table
DELETE plus 0056's column-level INSERT/UPDATE), then drops the triggers and the
function.

Revision ID: 0081_revoke_member_writes
Revises: 0080_article_text_fts
"""

from alembic import op

revision = "0081_revoke_member_writes"
down_revision = "0080_article_text_fts"
branch_labels = None
depends_on = None

_ALL_WRITES = (
    "article_text_blocks",
    "extraction_evidence",
    "extraction_reviewer_decisions",
    "extraction_consensus_decisions",
    "extraction_reviewer_states",
    "extraction_published_states",
    "extraction_proposal_records",
)
_APPEND_ONLY = (
    "extraction_reviewer_decisions",
    "extraction_consensus_decisions",
    "extraction_proposal_records",
)
# 0056's client-writable column list for extraction_proposal_records, verbatim.
_PROPOSAL_COLUMNS = (
    "id",
    "run_id",
    "instance_id",
    "field_id",
    "source",
    "source_user_id",
    "proposed_value",
    "confidence_score",
    "rationale",
    "created_at",
    "updated_at",
)


def upgrade() -> None:
    op.execute('REVOKE INSERT, UPDATE ON "public"."article_files" FROM "authenticated";')
    for t in _ALL_WRITES:
        op.execute(f'REVOKE INSERT, UPDATE, DELETE ON "public"."{t}" FROM "authenticated";')
    op.execute(
        """
        CREATE FUNCTION public.refuse_append_only_change() RETURNS trigger
        LANGUAGE plpgsql SET search_path = '' AS $$
        BEGIN
          IF current_user <> pg_catalog.pg_get_userbyid(
               (SELECT relowner FROM pg_catalog.pg_class WHERE oid = TG_RELID)) THEN
            RAISE EXCEPTION 'append-only table: % rows change only through the backend',
              TG_TABLE_NAME
              USING ERRCODE = '42501';
          END IF;
          RETURN COALESCE(NEW, OLD);
        END $$;
        """
    )
    op.execute("REVOKE EXECUTE ON FUNCTION public.refuse_append_only_change() FROM PUBLIC;")
    op.execute("REVOKE EXECUTE ON FUNCTION public.refuse_append_only_change() FROM anon;")
    for t in _APPEND_ONLY:
        op.execute(
            f"CREATE TRIGGER refuse_append_only_change BEFORE UPDATE OR DELETE ON public.{t} "
            "FOR EACH ROW EXECUTE FUNCTION public.refuse_append_only_change();"
        )


def downgrade() -> None:
    for t in _APPEND_ONLY:
        op.execute(f"DROP TRIGGER IF EXISTS refuse_append_only_change ON public.{t};")
    op.execute("DROP FUNCTION IF EXISTS public.refuse_append_only_change();")
    op.execute('GRANT INSERT, UPDATE ON "public"."article_files" TO "authenticated";')
    cols = ", ".join(_PROPOSAL_COLUMNS)
    for t in _ALL_WRITES:
        if t == "extraction_proposal_records":
            op.execute(f'GRANT DELETE ON "public"."{t}" TO "authenticated";')
            op.execute(
                f'GRANT INSERT ({cols}), UPDATE ({cols}) ON "public"."{t}" TO "authenticated";'
            )
        else:
            op.execute(f'GRANT INSERT, UPDATE, DELETE ON "public"."{t}" TO "authenticated";')

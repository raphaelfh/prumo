"""Per-proposal engine provenance (slice 0a).

``provenance`` records the engine that produced THIS proposal's value:
``{provider, model, endpoint_id, key_scope, mode_requested, mode_executed,
passes}``. It answers a question the run-level record structurally cannot.

``extraction_runs.results['provenance']['sections'][entity_type_id]`` is
LAST-WRITE-WINS: ``merge_provenance_section`` overwrites the whole snapshot on
every re-extract of that section. Proposals, by contrast, are append-only. So a
coordinate re-extracted twice keeps both values while retaining only the LATEST
execution record, and the older version is retroactively relabelled with the
newer run's ``mode_executed``/``passes``. Storing the engine on the row makes
each version carry its own truth.

The two records are complementary, not redundant, and the invariant is:

* ``extraction_proposal_records.provenance`` — immutable per row; how THIS
  value was produced. Engine identity only.
* ``extraction_runs.results.provenance.sections[et]`` — last-write-wins per
  section; how the LATEST run of that section executed. Keeps identity
  (``ran_by_user_id``), tokens and ``prompt_composition``.

Engine identity ONLY, deliberately. The section snapshot's first key is
``ran_by_user_id``, and the blind-review scrub lives inside
``_load_run_provenance``, which walks dicts read from ``extraction_runs.results``
and never sees a proposal row. Copying the snapshot verbatim onto the row would
hand a peer's user id to a blind reviewer on every AI proposal, reopening the
leak #474/0041 closed. Excluding identity at the WRITE makes the guarantee
"never stored" rather than "scrubbed on read". It also keeps the row ~150 bytes
instead of the 2-8 KB the snapshot reaches via ``prompt_composition``.

Provenance cannot ride inside ``proposed_value``: ``record_proposal``'s
idempotency check compares that bag (``extraction_proposal_service.py``), so
folding engine metadata in would make the same value under a different engine
compare UNEQUAL and append a phantom audit row on every re-run.

No backfill. 97 of 98 production runs predate the C1b engine pin, so there is
nothing to derive a per-proposal engine from; legacy rows stay NULL and readers
fall back to the section snapshot.

GRANT NARROWING. The baseline gives ``authenticated`` a table-wide UPDATE that
reaches this table through PostgREST, so without this the audit record of how a
value was produced would be client-forgeable. Note the SHAPE: a column-level
``REVOKE UPDATE (provenance)`` layered on a table-level grant is a silent NO-OP
(verified empirically) — the table-wide UPDATE must be revoked and the remaining
columns re-granted explicitly. Nothing in the product writes this table from the
client (the frontend only SELECTs it; E2E seeds run as ``service_role``), so the
revoked grant is vestigial. CONSEQUENCE FOR FUTURE MIGRATIONS: because the grant
is now per-column, a later column-add must also ``GRANT UPDATE (<new_col>)`` if
that column is meant to be client-updatable.

Revision ID: 0056_proposal_provenance
Revises: 0055_project_llm_endpoints
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

from alembic import op

revision = "0056_proposal_provenance"
down_revision = "0055_project_llm_endpoints"
branch_labels = None
depends_on = None

# Every column of extraction_proposal_records EXCEPT ``provenance``. Spelled out
# because Postgres cannot express "all columns but one" in a GRANT.
_CLIENT_UPDATABLE_COLUMNS = (
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
    op.add_column(
        "extraction_proposal_records",
        sa.Column("provenance", pg.JSONB(), nullable=True),
        schema="public",
    )
    columns = ", ".join(_CLIENT_UPDATABLE_COLUMNS)
    op.execute("REVOKE UPDATE ON TABLE public.extraction_proposal_records FROM authenticated")
    op.execute(
        f"GRANT UPDATE ({columns}) ON TABLE public.extraction_proposal_records TO authenticated"
    )


def downgrade() -> None:
    # Restore the table-wide grant first: once the column is gone the per-column
    # grants naming it would be invalid, and the baseline state is table-wide.
    op.execute("REVOKE UPDATE ON TABLE public.extraction_proposal_records FROM authenticated")
    op.execute("GRANT UPDATE ON TABLE public.extraction_proposal_records TO authenticated")
    op.drop_column("extraction_proposal_records", "provenance", schema="public")

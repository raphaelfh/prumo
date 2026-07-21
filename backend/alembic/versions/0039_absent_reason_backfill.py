"""Backfill in-band disposition strings -> absent_reason marker (ADR-0016 Phase 3)

Rewrites every stored in-band disposition value ("No information" /
"Not applicable" / "Not evaluated" and the PROBAST abbreviations "NI" / "NA")
into the coded marker ``{"value": null, "absent_reason": <code>}`` across the
three value-bearing tables — proposals, reviewer decisions, published states —
for ALL runs including finalized ones, so historical exports stay correct and no
in-band disposition survives in any encoding.

Scope is the run's **frozen version snapshot**
(``extraction_template_versions.schema``), NOT the live ``extraction_fields``
(Phase 2 mutated those): a value is rewritten only when the string is present in
that field's frozen ``allowed_values``. A coincidental free-text ``"NA"`` on a
field whose snapshot domain lacks it is left untouched — the exact rule the
write-path helper (``value_semantics.disposition_to_marker``) uses.

An ``accept_proposal`` reviewer decision carries ``value = NULL`` and inherits
correctness from its migrated proposal, so it is not double-handled here.

Every statement is set-based (one ``UPDATE ... FROM`` per string × table) so
``alembic upgrade 0038:0039 --sql`` renders a reviewable predicate. The
constants below are controlled literals (no user input).

**Downgrade** restores the disposition string that is actually present in each
field's snapshot domain (``"NI"`` for a PROBAST field, ``"No information"`` for a
Yes/No/NI field) — never a domain-invalid full-word. A marker set natively on a
field whose domain carries no in-band string (e.g. a numeric field marked via the
runtime control) has no in-band equivalent and is correctly left as a marker.

Revision ID: 0039_absent_reason_backfill
Revises: 0038_field_disposition_flags
Create Date: 2026-07-01

"""

from alembic import op

revision = "0039_absent_reason_backfill"
down_revision = "0038_field_disposition_flags"
branch_labels = None
depends_on = None

# (table, jsonb value column) — the three value-bearing coordinate tables.
_TABLES = (
    ("extraction_proposal_records", "proposed_value"),
    ("extraction_reviewer_decisions", "value"),
    ("extraction_published_states", "value"),
)

# In-band disposition string -> marker code (both encodings). "Unclear" is a
# substantive value and is intentionally absent.
_STRING_TO_CODE = (
    ("No information", "no_information"),
    ("Not applicable", "not_applicable"),
    ("Not evaluated", "not_evaluated"),
    ("NI", "no_information"),
    ("NA", "not_applicable"),
)

# Downgrade: marker code -> candidate in-band strings, full-word first so a plain
# Yes/No/NI field restores "No information" and a PROBAST field restores "NI".
_CODE_TO_STRINGS = (
    ("no_information", ("No information", "NI")),
    ("not_applicable", ("Not applicable", "NA")),
    ("not_evaluated", ("Not evaluated",)),
)


def _snapshot_join() -> str:
    """The row -> run -> frozen version snapshot -> field-in-domain join shared by
    both directions. Expands each run's snapshot to (entity_type, field) and keeps
    the one field matching the row's coordinate."""
    return (
        "FROM public.extraction_runs r "
        "JOIN public.extraction_template_versions v ON v.id = r.version_id "
        "CROSS JOIN LATERAL jsonb_array_elements(v.schema -> 'entity_types') AS et "
        "CROSS JOIN LATERAL jsonb_array_elements(et -> 'fields') AS f "
    )


def upgrade_statements() -> list[str]:
    """The set-based UPDATE per (string × table). Exposed so the migration test
    can run the exact statements inside a rolled-back transaction — shelling out
    ``alembic downgrade`` for a *data* migration would rewrite the whole shared
    dev DB, not just the test's rows."""
    stmts: list[str] = []
    for table, col in _TABLES:
        for string, code in _STRING_TO_CODE:
            stmts.append(
                f"UPDATE public.{table} AS tgt "
                f"SET {col} = jsonb_build_object('value', NULL::text, 'absent_reason', '{code}') "
                f"{_snapshot_join()}"
                f"WHERE tgt.run_id = r.id "
                f"AND (f ->> 'id')::uuid = tgt.field_id "
                f"AND f -> 'allowed_values' ? '{string}' "
                f"AND tgt.{col} ->> 'value' = '{string}' "
                f"AND NOT (tgt.{col} ? 'absent_reason')"
            )
    return stmts


def downgrade_statements() -> list[str]:
    stmts: list[str] = []
    for table, col in _TABLES:
        for code, strings in _CODE_TO_STRINGS:
            values = ", ".join(f"('{s}')" for s in strings)
            stmts.append(
                f"UPDATE public.{table} AS tgt "
                f"SET {col} = jsonb_build_object('value', dom.str) "
                f"{_snapshot_join()}"
                f"CROSS JOIN LATERAL ("
                f"  SELECT c.str FROM (VALUES {values}) AS c(str) "
                f"  WHERE f -> 'allowed_values' ? c.str LIMIT 1"
                f") AS dom "
                f"WHERE tgt.run_id = r.id "
                f"AND (f ->> 'id')::uuid = tgt.field_id "
                f"AND tgt.{col} ->> 'absent_reason' = '{code}' "
                f"AND tgt.{col} ->> 'value' IS NULL"
            )
    return stmts


def upgrade() -> None:
    for stmt in upgrade_statements():
        op.execute(stmt)


def downgrade() -> None:
    for stmt in downgrade_statements():
        op.execute(stmt)

"""Which stored extraction values break the value envelope, per table.

A stored value must be ``NULL`` (SQL ``NULL`` or the JSON ``null`` an ORM
write of ``None`` stores) or a JSON object with a ``value`` key, whose
keys are only ``value``, ``unit`` and ``absent_reason`` (plus
``verification`` on proposal records), and whose ``absent_reason``, when set,
is one of the coded dispositions. A legacy double wrap
(``{"value": {"value": 22, "unit": "mg"}}``) passes: the outer object is a
valid envelope.

This reporter is the evidence a maintainer records before a database CHECK
on these columns is added. It is strictly read-only (SELECT only) and never
repairs a row. The rule lives in ONE place, the SQL ``CASE`` in
``_KIND_SQL``; there is no Python re-implementation to drift from it.

Run it with::

    cd backend && uv run python -m app.services.value_envelope_audit

It exits 1 when any stored value breaks the envelope, else 0.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import text

from app.services.value_contract import ENVELOPE_KEYS
from app.services.value_semantics import AbsentReason

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

__all__ = [
    "EnvelopeViolation",
    "TableAudit",
    "audit_value_envelopes",
    "format_report",
]


class EnvelopeViolation(StrEnum):
    """Why a stored value is off the envelope.

    The CASE checks these in rule order (first wins): not an object, no
    ``value``, ``verification`` outside proposals, unknown key, bad reason.
    """

    NOT_OBJECT = "not_object"
    MISSING_VALUE = "missing_value"
    UNKNOWN_KEY = "unknown_key"
    BAD_ABSENT_REASON = "bad_absent_reason"
    VERIFICATION_OUTSIDE_PROPOSAL = "verification_outside_proposal"


@dataclass(frozen=True, slots=True)
class TableAudit:
    """One table's findings; empty dicts mean a clean table."""

    table: str
    counts: dict[EnvelopeViolation, int]
    sample_ids: dict[EnvelopeViolation, list[UUID]]  # at most 5 per kind, newest first
    last_30_days: int


# (table, value column, carries `verification`). Fixed: the only names ever
# rendered into the audit SQL.
_TABLES: tuple[tuple[str, str, bool], ...] = (
    ("extraction_reviewer_decisions", "value", False),
    ("extraction_consensus_decisions", "value", False),
    ("extraction_published_states", "value", False),
    ("extraction_proposal_records", "proposed_value", True),
)


def _sql_array(items: list[str]) -> str:
    return "ARRAY[" + ", ".join(f"'{item}'" for item in items) + "]::text[]"


def _kind_case(column: str, carries_verification: bool) -> str:
    """The envelope rule as one SQL CASE: the violation kind, or NULL."""
    allowed = sorted(ENVELOPE_KEYS | ({"verification"} if carries_verification else set()))
    verification_rule = (
        ""
        if carries_verification
        else f"WHEN {column} ? 'verification' "
        f"THEN '{EnvelopeViolation.VERIFICATION_OUTSIDE_PROPOSAL.value}' "
    )
    return (
        "CASE "
        # The app's "no value": an ORM write of None stores jsonb 'null'.
        f"WHEN jsonb_typeof({column}) = 'null' THEN NULL "
        f"WHEN jsonb_typeof({column}) <> 'object' THEN '{EnvelopeViolation.NOT_OBJECT.value}' "
        f"WHEN NOT ({column} ? 'value') THEN '{EnvelopeViolation.MISSING_VALUE.value}' "
        f"{verification_rule}"
        f"WHEN EXISTS (SELECT 1 FROM jsonb_object_keys({column}) AS k "
        f"WHERE k <> ALL ({_sql_array(allowed)})) "
        f"THEN '{EnvelopeViolation.UNKNOWN_KEY.value}' "
        # `->>` turns a JSON null into SQL NULL, so an explicit null reason
        # passes, as it does on the write path.
        f"WHEN ({column} ->> 'absent_reason') <> ALL "
        f"({_sql_array([reason.value for reason in AbsentReason])}) "
        f"THEN '{EnvelopeViolation.BAD_ABSENT_REASON.value}' "
        "END"
    )


_KIND_SQL: dict[str, str] = {
    table: _kind_case(column, carries_verification)
    for table, column, carries_verification in _TABLES
}


async def audit_value_envelopes(db: "AsyncSession") -> list[TableAudit]:
    """One grouped SELECT per table; reads only."""
    audits: list[TableAudit] = []
    for table, column, _ in _TABLES:
        rows = (
            await db.execute(
                text(
                    "SELECT kind, count(*), "
                    "count(*) FILTER (WHERE created_at >= now() - interval '30 days'), "
                    # Only the newest five ids per kind are ever aggregated.
                    "array_agg(id ORDER BY rn) FILTER (WHERE rn <= 5) "
                    "FROM (SELECT id, created_at, kind, row_number() OVER "
                    "(PARTITION BY kind ORDER BY created_at DESC, id) AS rn "
                    f"FROM (SELECT id, created_at, {_KIND_SQL[table]} AS kind "
                    f"FROM public.{table} WHERE {column} IS NOT NULL) AS x "
                    "WHERE kind IS NOT NULL) AS ranked GROUP BY kind"
                )
            )
        ).all()
        audits.append(
            TableAudit(
                table=table,
                counts={EnvelopeViolation(kind): count for kind, count, _, _ in rows},
                sample_ids={EnvelopeViolation(kind): list(ids) for kind, _, _, ids in rows},
                last_30_days=sum(recent for _, _, recent, _ in rows),
            )
        )
    return audits


def format_report(audits: list[TableAudit]) -> str:
    """The operator-facing report. Pure, so its wording is testable."""
    lines: list[str] = []
    for audit in audits:
        total = sum(audit.counts.values())
        recent = f" ({audit.last_30_days} in the last 30 days)" if total else ""
        lines.append(f"{audit.table}: {total}{recent}")
        for kind in EnvelopeViolation:
            if kind in audit.counts:
                samples = ", ".join(str(row_id) for row_id in audit.sample_ids.get(kind, []))
                lines.append(f"  {kind.value}: {audit.counts[kind]}  samples: {samples}")
    grand_total = sum(sum(audit.counts.values()) for audit in audits)
    lines.append(f"Total: {grand_total} stored value(s) break the value envelope.")
    return "\n".join(lines)


async def _report() -> int:  # pragma: no cover - operator entry point
    """Open a session, print the report, and return the number of violators."""
    from app.core.deps import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        # Server-enforced: any write in this transaction would fail.
        await db.execute(text("SET TRANSACTION READ ONLY"))
        audits = await audit_value_envelopes(db)
    print(format_report(audits))
    return sum(sum(audit.counts.values()) for audit in audits)


if __name__ == "__main__":  # pragma: no cover - operator entry point
    import asyncio

    raise SystemExit(0 if asyncio.run(_report()) == 0 else 1)

"""The value-envelope audit's operator report (Task 2.4a).

The report is the evidence a maintainer records before a database CHECK on
the value columns is added, so its wording carries the table, the violation
kind, the count, sample ids and the 30-day count.
"""

from __future__ import annotations

from uuid import UUID

from app.services.value_envelope_audit import EnvelopeViolation, TableAudit, format_report

ROW_A = UUID("00000000-0000-0000-0000-00000000000a")
ROW_B = UUID("00000000-0000-0000-0000-00000000000b")


def test_an_empty_audit_reports_a_zero_total() -> None:
    clean = TableAudit(
        table="extraction_reviewer_decisions", counts={}, sample_ids={}, last_30_days=0
    )

    report = format_report([clean])

    assert "extraction_reviewer_decisions: 0" in report
    assert "Total: 0 stored value(s) break the value envelope." in report


def test_a_finding_lists_table_kind_count_samples_and_recent_count() -> None:
    finding = TableAudit(
        table="extraction_consensus_decisions",
        counts={EnvelopeViolation.UNKNOWN_KEY: 7},
        sample_ids={EnvelopeViolation.UNKNOWN_KEY: [ROW_A, ROW_B]},
        last_30_days=3,
    )

    report = format_report([finding])

    assert "extraction_consensus_decisions: 7 (3 in the last 30 days)" in report
    assert f"unknown_key: 7  samples: {ROW_A}, {ROW_B}" in report
    assert "Total: 7 stored value(s) break the value envelope." in report

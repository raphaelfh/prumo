"""Classifying a narrow published baseline (B-9x).

`snapshot_is_narrow` answers a yes/no that three different eras can trigger
(`extraction_snapshot.py:145-174`), and the three need different remedies —
so an operator staring at "this template is narrow" cannot act on it. The
classifier below says WHICH era, and therefore what is actually blocked.

The distinction that matters most is EMPTY vs NARROW-WITH-CONTENT.
`snapshot_is_narrow` deliberately calls an empty list narrow so the run
view falls back to live rows, but an empty baseline is perfectly
restorable — the restore is a plain delete-all. Conflating the two would
report healthy templates as damaged.
"""

from __future__ import annotations

from app.services.narrow_snapshot_audit import NarrowEra, classify_baseline

WIDE_FIELD = {"id": "f1", "name": "n", "llm_description": None, "allow_other": False}


def _snapshot(entity_types: list[dict]) -> dict:
    return {"entity_types": entity_types}


def test_a_wide_baseline_is_healthy() -> None:
    snapshot = _snapshot([{"id": "e1", "role": "study_section", "fields": [WIDE_FIELD]}])
    assert classify_baseline(snapshot).era is NarrowEra.WIDE


def test_an_empty_baseline_is_healthy_not_narrow() -> None:
    """The load-bearing distinction.

    `snapshot_is_narrow([])` is True by design (the run view falls back to
    live rows), but `baseline_is_restorable` calls it restorable — the
    restore is a plain delete-all. An audit that reported this as damaged
    would send operators after healthy templates.
    """
    result = classify_baseline(_snapshot([]))
    assert result.era is NarrowEra.EMPTY
    assert result.restorable is True


def test_a_missing_role_is_the_pre_0017_era() -> None:
    snapshot = _snapshot([{"id": "e1", "fields": [WIDE_FIELD]}])
    result = classify_baseline(snapshot)
    assert result.era is NarrowEra.PRE_0017_NO_ROLE
    assert result.restorable is False


def test_narrow_fields_under_a_role_are_the_pre_0026_era() -> None:
    """The era migration 0026's backfill deliberately skipped.

    0026 keyed on the role probe, so these rows — role present, fields
    still narrow — were never widened. Restoring one would default
    llm_description/allow_other across the project.
    """
    snapshot = _snapshot([{"id": "e1", "role": "study_section", "fields": [{"id": "f1"}]}])
    result = classify_baseline(snapshot)
    assert result.era is NarrowEra.PRE_0026_NARROW_FIELDS
    assert result.restorable is False


def test_a_mixed_tree_reports_the_most_severe_era() -> None:
    """A heterogeneous mix is not a third remedy — it needs the worst one."""
    snapshot = _snapshot(
        [
            {"id": "e1", "role": "study_section", "fields": [WIDE_FIELD]},
            {"id": "e2", "fields": [WIDE_FIELD]},  # no role at all
        ]
    )
    assert classify_baseline(snapshot).era is NarrowEra.PRE_0017_NO_ROLE


def test_the_classifier_agrees_with_the_predicate_it_explains() -> None:
    """The audit must never contradict the gate the product enforces.

    If these ever disagree, the audit is telling operators something the
    running code does not believe.
    """
    from app.services.extraction_snapshot import baseline_is_restorable

    cases = [
        _snapshot([]),
        _snapshot([{"id": "e1", "role": "study_section", "fields": [WIDE_FIELD]}]),
        _snapshot([{"id": "e1", "fields": [WIDE_FIELD]}]),
        _snapshot([{"id": "e1", "role": "study_section", "fields": [{"id": "f1"}]}]),
        {},
    ]
    for snapshot in cases:
        assert classify_baseline(snapshot).restorable == baseline_is_restorable(snapshot)


def test_a_null_schema_is_treated_as_empty() -> None:
    """A version row with no payload must not crash the audit."""
    assert classify_baseline(None).era is NarrowEra.EMPTY


def test_every_era_carries_an_operator_remedy() -> None:
    """A classification nobody can act on is just a different error message."""
    for era in NarrowEra:
        assert era.remedy, f"{era} has no remedy text"

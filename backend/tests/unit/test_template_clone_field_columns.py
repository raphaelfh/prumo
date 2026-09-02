"""The clone's field-copy list must account for every ``ExtractionField`` column.

This guard exists because the hand-written copy list has silently swallowed a
new column twice, each time removing a behaviour from every cloned project
without turning a single test red:

* the ADR-0016 dispositions (``allows_not_applicable`` and siblings) — every
  cloned signaling question lost its "Not applicable" affordance;
* ``is_entity_key`` — every cloned CHARMS project's repeating sections
  declared no identity, so the first AI extraction into one raised
  ``MissingEntityKeyError``.

Both were found from the outside, long after shipping. A column added to the
model and to neither set now fails here, which forces the copy-or-not decision
to be made once, deliberately, by whoever adds it.
"""

from __future__ import annotations

from app.models.extraction import ExtractionField
from app.services.template_clone_service import (
    CLONED_FIELD_COLUMNS,
    UNCLONED_FIELD_COLUMNS,
)

_MODEL_COLUMNS = frozenset(c.name for c in ExtractionField.__table__.columns)


def test_every_column_is_either_cloned_or_deliberately_excluded() -> None:
    unaccounted = _MODEL_COLUMNS - CLONED_FIELD_COLUMNS - UNCLONED_FIELD_COLUMNS
    assert not unaccounted, (
        "ExtractionField gained column(s) the clone neither copies nor excludes: "
        f"{sorted(unaccounted)}. Add each to CLONED_FIELD_COLUMNS (it should "
        "travel with the project copy) or to UNCLONED_FIELD_COLUMNS (with the "
        "reason it must not)."
    )


def test_neither_set_names_a_column_that_does_not_exist() -> None:
    """A renamed or dropped column must not leave a stale name behind.

    Without this, a rename would leave the old name in the copy list and the
    new one unaccounted — and the check above would catch only half of it.
    """
    stale = (CLONED_FIELD_COLUMNS | UNCLONED_FIELD_COLUMNS) - _MODEL_COLUMNS
    assert not stale, f"names no longer on ExtractionField: {sorted(stale)}"


def test_the_two_sets_do_not_overlap() -> None:
    overlap = CLONED_FIELD_COLUMNS & UNCLONED_FIELD_COLUMNS
    assert not overlap, f"a column cannot be both copied and excluded: {sorted(overlap)}"


def test_identity_and_parent_link_are_never_copied() -> None:
    """Copying these would clone the row onto itself instead of onto the project."""
    assert {"id", "entity_type_id"} <= UNCLONED_FIELD_COLUMNS


def test_entity_key_travels_with_the_clone() -> None:
    """The regression this guard was written for."""
    assert "is_entity_key" in CLONED_FIELD_COLUMNS

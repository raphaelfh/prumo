"""The clone's copy set is derived, and its exclusions stay honest.

The copy list used to be hand-written, and it silently swallowed a new column
twice — each time removing a behaviour from every cloned project without
turning a test red:

* the ADR-0016 dispositions (``allows_not_applicable`` and siblings) — every
  cloned signaling question lost its "Not applicable" affordance;
* ``is_entity_key`` — every cloned CHARMS project's repeating sections
  declared no identity, so the first AI extraction into one raised
  ``MissingEntityKeyError``.

``CLONED_FIELD_COLUMNS`` is now derived from the model minus an explicit
exclusion set, which retires that class: a new column is copied by default.
What is left to guard is the exclusion set itself — that it names real
columns, that it still holds the ones a clone must never carry, and that the
two historically-dropped columns really do travel.
"""

from __future__ import annotations

from app.models.extraction import ExtractionField
from app.services.template_clone_service import (
    CLONED_FIELD_COLUMNS,
    UNCLONED_FIELD_COLUMNS,
)

_MODEL_COLUMNS = frozenset(c.name for c in ExtractionField.__table__.columns)


def test_exclusions_name_columns_that_exist() -> None:
    """A renamed or dropped column must not leave a stale exclusion behind.

    A stale name would silently widen the copy set — the exclusion would stop
    matching anything and the column it was meant to hold back would travel.
    """
    stale = UNCLONED_FIELD_COLUMNS - _MODEL_COLUMNS
    assert not stale, f"excluded names no longer on ExtractionField: {sorted(stale)}"


def test_identity_and_parent_link_are_never_copied() -> None:
    """Copying these would write the clone onto the global row, not the project."""
    assert {"id", "entity_type_id"} <= UNCLONED_FIELD_COLUMNS


def test_the_two_sets_partition_the_model() -> None:
    assert CLONED_FIELD_COLUMNS | UNCLONED_FIELD_COLUMNS == _MODEL_COLUMNS
    assert not (CLONED_FIELD_COLUMNS & UNCLONED_FIELD_COLUMNS)


def test_the_two_historically_dropped_columns_travel() -> None:
    """Both regressions this derivation exists to prevent, pinned by name."""
    assert "is_entity_key" in CLONED_FIELD_COLUMNS
    assert {
        "allows_not_applicable",
        "allows_not_evaluated",
        "allows_no_information",
    } <= CLONED_FIELD_COLUMNS

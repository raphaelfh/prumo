"""The clone's copy sets are derived from the models; only the exclusions are hand-kept.

A stale exclusion name fails at import (``_copied_columns``), so what is left
to guard is that the exclusions still hold the columns a clone must never
carry, and that the columns a hand-written list once dropped now travel.
"""

from __future__ import annotations

import pytest

from app.models.extraction import ExtractionField
from app.services.template_clone_service import (
    CLONED_ENTITY_TYPE_COLUMNS,
    CLONED_FIELD_COLUMNS,
    UNCLONED_ENTITY_TYPE_COLUMNS,
    UNCLONED_FIELD_COLUMNS,
    _copied_columns,
)


def test_identity_and_links_are_never_copied() -> None:
    """Copying these would write the clone onto the global rows, not the project."""
    assert {"id", "entity_type_id"} <= UNCLONED_FIELD_COLUMNS
    assert {
        "id",
        "template_id",
        "project_template_id",
        "parent_entity_type_id",
    } <= UNCLONED_ENTITY_TYPE_COLUMNS


def test_the_historically_dropped_columns_travel() -> None:
    """Both regressions the derivation exists to prevent, pinned by name."""
    assert "is_entity_key" in CLONED_FIELD_COLUMNS
    assert {
        "allows_not_applicable",
        "allows_not_evaluated",
        "allows_no_information",
    } <= CLONED_FIELD_COLUMNS
    assert {"entry_label", "role", "cardinality"} <= CLONED_ENTITY_TYPE_COLUMNS


def test_a_stale_exclusion_fails_loudly() -> None:
    """A renamed or dropped column must not silently widen the copy set."""
    with pytest.raises(ValueError, match="no columns \\['no_such_column'\\]"):
        _copied_columns(ExtractionField, frozenset({"id", "no_such_column"}))

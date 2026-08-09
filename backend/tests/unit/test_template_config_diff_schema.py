"""Wire-contract guards for the config-diff read model (slice B-9b2a)."""

from uuid import uuid4

from app.schemas.hitl_session import (
    TemplateChangeRowRead,
    TemplateConfigDiffBuckets,
    TemplateConfigDiffRead,
)
from app.services.template_diff import ChangeTier
from app.services.template_diff_read import TemplateChangeRow


def test_every_tier_has_a_bucket_named_after_its_wire_value() -> None:
    """A client buckets by ``row.tier``, so the bucket keys must BE the
    tier values. Renaming one field silently breaks that lookup."""
    assert set(TemplateConfigDiffBuckets.model_fields) == {tier.value for tier in ChangeTier}


def test_the_wire_row_mirrors_the_read_model_field_for_field() -> None:
    """``model_validate(row)`` copies by name: a field added to the
    dataclass and forgotten here would never reach the client."""
    assert set(TemplateChangeRowRead.model_fields) == set(TemplateChangeRow.__dataclass_fields__)


def test_an_unavailable_diff_ships_empty_buckets_by_default() -> None:
    """The default is the safe one: a shape that cannot diff must not be
    able to ship rows by omission."""
    read = TemplateConfigDiffRead(diff_available=False, project_template_id=uuid4())

    buckets = read.changes
    assert (buckets.additive, buckets.cosmetic, buckets.semantic, buckets.destructive) == (
        [],
        [],
        [],
        [],
    )

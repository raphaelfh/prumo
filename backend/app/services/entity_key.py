"""Instance identity for repeating groups.

``cardinality='many'`` has no identity mechanism in the schema — the
trigger that would enforce one bails out for it explicitly
(``enforce_extraction_instance_cardinality``, baseline_v1.sql:283). So an
AI re-run has nothing to match against and creates a second instance for
an entity it already extracted.

This module is that missing concept, in one place: which field declares
the identity (``is_entity_key``), what an instance's identity currently
is, and whether a new finding is one we already have.

**Identity lives on the instance, never in a field value.** The key is
materialized into ``extraction_instances.metadata_->>'entity_key'`` at
creation and matching reads only that. Deriving it from the key field's
*value* would force a choice between two failures, because during
``extract`` values are per-reviewer and blind: the only resolver,
``extraction_run_read_service.resolve_caller_current_values``, is
caller-scoped and documents itself as the 4th lockstep copy of migration
0025's blind predicate. Read it scoped and reviewer B cannot see the value
reviewer A entered, so the duplicate is created anyway; read it unscoped
and reviewer judgment leaks across the boundary ADR-0012 exists to hold.
The instance row is already shared (instance visibility is not
reviewer-scoped), so materializing there sidesteps both.

``label`` stays the human-facing, editable name; ``entity_key`` is the
identity and is not edited by hand.

**The declaration is versioned config.** ``is_entity_key`` rides the
published snapshot like every other field column: the publish diff shows a
key move, and Discard restores the key the baseline granted (see
``template_restore_service`` for the per-section slot it has to release
first). :func:`resolve_key_field` deliberately still reads the LIVE flag —
it is the re-run gate, not a prompt input, and a run in ``extract`` is
re-pinned to the new version on Publish anyway.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionEntityType, ExtractionField, ExtractionInstance

# JSONB key under ``extraction_instances.metadata``.
STORE_KEY = "entity_key"

# The seeded catalogue's key declarations, by ``(entity_type.name, field.name)``.
# ONE list, three consumers that must agree on it: the seed stamps it on a
# fresh database (``seed._apply_entity_keys``), migrations 0059/0066 carry a
# verbatim copy for every installation that already held the templates
# (``test_seed_entity_keys`` pins the two), and the publish diff treats a
# pre-0059 snapshot lacking the key at one of these coordinates as the same
# tree the backfill produced (``template_diff._normalize_field``) — otherwise
# every existing clone would report a phantom draft and Discard would clear
# the backfilled key. Matched by NAME, never id: a project clone carries fresh
# ids for every row.
ENTITY_KEY_FIELDS: frozenset[tuple[str, str]] = frozenset(
    {
        ("prediction_models", "model_name"),  # CHARMS (000c)
        ("prediction_models", "mdl_name"),  # CHARMS + Multimodal (000e)
        ("final_predictors", "predictor_name"),  # CHARMS (000c)
        ("numeric_performance", "pnum_validation_type"),  # CHARMS + Multimodal (000e)
    }
)


class MissingEntityKeyError(Exception):
    """A repeating group declares no ``is_entity_key`` field.

    Raised instead of duplicating in silence. The template inspector is
    where a manager satisfies it. The seed stamps the global catalogue, the
    clone copies the flag (``CLONED_FIELD_COLUMNS``) and migrations 0059 and
    0066 backfilled the rows that predate them, so the common path never
    reaches this.
    """

    def __init__(self, entity_type_id: UUID, entity_type_label: str | None = None) -> None:
        self.entity_type_id = entity_type_id
        self.entity_type_label = entity_type_label
        name = entity_type_label or str(entity_type_id)
        super().__init__(
            f"The repeating section {name!r} declares no identity field, so AI "
            "extraction cannot tell a new entry from one it already extracted. "
            "Mark one of its fields as the entry key in the template editor."
        )


def normalize_key(value: str) -> str:
    """Fold a key value to its comparison form.

    Whitespace runs collapse and case is ignored, so ``"  XGBoost "`` and
    ``"xgboost"`` are the same entity. Nothing else is normalized: a
    similarity metric here would be theater, since the pair this feature
    exists for ("XGBoost" vs "Gradient Boosting") is not string-similar at
    all. Aligning those two is the identification prompt's job.
    """
    return " ".join(value.split()).casefold()


def stamp(metadata: dict[str, Any] | None, key_value: str) -> dict[str, Any]:
    """Return ``metadata`` with the normalized identity materialized on it."""
    return {**(metadata or {}), STORE_KEY: normalize_key(key_value)}


def key_of(instance: ExtractionInstance) -> str | None:
    """The instance's materialized identity, or None for a pre-0059 row."""
    raw = (instance.metadata_ or {}).get(STORE_KEY)
    return raw if isinstance(raw, str) else None


async def resolve_key_field(db: AsyncSession, entity_type_id: UUID) -> ExtractionField:
    """The field declaring this entity type's identity.

    Raises ``MissingEntityKeyError`` when none is declared — the caller
    refuses rather than duplicating.
    """
    field = (
        await db.execute(
            select(ExtractionField).where(
                ExtractionField.entity_type_id == entity_type_id,
                ExtractionField.is_entity_key.is_(True),
            )
        )
    ).scalar_one_or_none()
    if field is None:
        # Name the section as the template editor shows it: a UUID does not
        # tell the manager which section to open.
        entity_type = await db.get(ExtractionEntityType, entity_type_id)
        label = (entity_type.label or entity_type.name) if entity_type is not None else None
        raise MissingEntityKeyError(entity_type_id, label)
    return field


async def existing_keys(
    db: AsyncSession,
    *,
    article_id: UUID,
    entity_type_id: UUID,
    parent_instance_id: UUID | None = None,
) -> dict[str, UUID]:
    """Normalized identity -> instance id, for one live coordinate.

    Reads instances only. Rows created before 0059 carry no key and are
    skipped: they cannot be matched, so a re-run creates alongside them
    rather than guessing which one it meant.
    """
    stmt = select(ExtractionInstance).where(
        ExtractionInstance.article_id == article_id,
        ExtractionInstance.entity_type_id == entity_type_id,
    )
    stmt = stmt.where(
        ExtractionInstance.parent_instance_id == parent_instance_id
        if parent_instance_id is not None
        else ExtractionInstance.parent_instance_id.is_(None)
    )
    found: dict[str, UUID] = {}
    for instance in (await db.execute(stmt)).scalars().all():
        key = key_of(instance)
        if key is not None:
            found.setdefault(key, instance.id)
    return found


async def match_or_none(
    db: AsyncSession,
    *,
    article_id: UUID,
    entity_type_id: UUID,
    key_value: str,
    parent_instance_id: UUID | None = None,
) -> UUID | None:
    """The instance already holding this identity, if any."""
    keys = await existing_keys(
        db,
        article_id=article_id,
        entity_type_id=entity_type_id,
        parent_instance_id=parent_instance_id,
    )
    return keys.get(normalize_key(key_value))

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
published snapshot like every other field column (0067 backfilled the
snapshots that predate that): the publish diff shows a key move, and
Discard restores the key the baseline granted (see
``template_restore_service`` for the per-section slot it parks first).
:func:`key_field_of` reads the declaration off the tree the run is PINNED
to (``entity_types_for_version``), never the live row: a key moved in an
unpublished draft gates nothing until Publish re-pins the run, exactly like
every other column of ``schema_``.

**Every repeating group is an entry group.** Identity never branches on
``role`` — a ``cardinality='many'`` section at any depth that declares a
key is resolved the same way the model container is; ``model_container``
keeps only its hierarchy UX, its export record stem and the
one-container-per-template rule.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionInstance

# JSONB keys under ``extraction_instances.metadata``.
STORE_KEY = "entity_key"
#: Append-only trail of reviewer re-keys: ``[{who, when, from, to}, ...]``.
HISTORY_KEY = "entity_key_history"


class MissingEntityKeyError(Exception):
    """A repeating group declares no ``is_entity_key`` field.

    Raised instead of duplicating in silence, before any write or LLM call.
    The template inspector is where a manager satisfies it. The seed stamps
    the global catalogue, the clone copies the flag (``CLONED_FIELD_COLUMNS``)
    and migrations 0059 and 0066 backfilled the rows that predate them, so
    the common path never reaches this.
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


def rekey_instance(
    instance: Any, *, key_value: str, actor_id: UUID, at: datetime | None = None
) -> bool:
    """Re-key by a reviewer (identity spec §7 keeps merge out; this is the
    one identity edit a human makes): rewrite the materialized key and
    append ``{who, when, from, to}`` to the history — append-only, never
    rewritten (constitution §IX). Returns False when the normalized key is
    unchanged, in which case nothing is written and no history row lands.

    The metadata object is REPLACED, not mutated: SQLAlchemy does not see
    in-place changes to a JSONB dict.
    """
    new_key = normalize_key(key_value)
    old_key = key_of(instance)
    if old_key == new_key:
        return False
    metadata = dict(instance.metadata_ or {})
    history = list(metadata.get(HISTORY_KEY) or [])
    history.append(
        {
            "who": str(actor_id),
            "when": (at or datetime.now(UTC)).isoformat(),
            "from": old_key,
            "to": new_key,
        }
    )
    instance.metadata_ = {**metadata, STORE_KEY: new_key, HISTORY_KEY: history}
    return True


class _KeyedField(Protocol):
    @property
    def id(self) -> UUID: ...
    @property
    def label(self) -> str: ...
    @property
    def is_entity_key(self) -> bool: ...


class _EntryGroup(Protocol):
    """What :func:`key_field_of` reads — the columns the pinned
    ``RunViewEntityType`` and the live ``ExtractionEntityType`` row share.
    Both AI services fall back to the live row when the pinned tree does not
    carry the section, so the reader is typed over the intersection (as
    read-only properties: a plain attribute would be invariant, and the two
    shapes type ``label`` differently)."""

    @property
    def id(self) -> UUID: ...
    @property
    def name(self) -> str: ...
    @property
    def label(self) -> str | None: ...
    @property
    def cardinality(self) -> str: ...
    @property
    def fields(self) -> list[Any]: ...


def key_field_of(entity_type: _EntryGroup) -> Any | None:
    """The field declaring this section's identity, read from the pinned tree.

    ``None`` for a section that does not repeat — a key declared there is
    inert, not an error, so toggling one/many never trips it (spec §6.1).
    Raises ``MissingEntityKeyError`` for a keyless repeating group: the
    caller refuses rather than duplicating, and the message names the
    section as the template editor shows it.
    """
    if entity_type.cardinality != "many":
        return None
    key: _KeyedField | None = next((f for f in entity_type.fields if f.is_entity_key), None)
    if key is None:
        raise MissingEntityKeyError(entity_type.id, entity_type.label or entity_type.name)
    return key


async def resolve_instance(
    db: AsyncSession,
    *,
    project_id: UUID,
    article_id: UUID,
    template_id: UUID,
    entity_type_id: UUID,
    parent_instance_id: UUID | None,
    key_value: str,
    sort_order: int,
    created_by: UUID,
    metadata: dict[str, Any] | None = None,
) -> tuple[ExtractionInstance, bool]:
    """Match before create (spec §5.1): the instance for ``key_value`` at the
    ``(article, entity_type, parent_instance)`` coordinate, and whether it
    was created by this call.

    A match returns the existing row untouched — its record of how it was
    produced belongs to the run that created it, and what happens to its
    values is the per-field guard's decision, not this function's. A miss
    creates the row with the identity materialized alongside ``metadata``
    and the trimmed key as its human-facing ``label``.
    """
    existing = await match_or_none(
        db,
        article_id=article_id,
        entity_type_id=entity_type_id,
        key_value=key_value,
        parent_instance_id=parent_instance_id,
    )
    if existing is not None:
        instance = await db.get(ExtractionInstance, existing)
        if instance is not None:
            return instance, False
    instance = ExtractionInstance(
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
        entity_type_id=entity_type_id,
        parent_instance_id=parent_instance_id,
        label=key_value.strip(),
        sort_order=sort_order,
        metadata_=stamp(metadata, key_value),
        created_by=created_by,
    )
    db.add(instance)
    await db.flush()
    return instance, True


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

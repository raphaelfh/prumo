"""Rename and re-key one extraction instance — the reviewer's identity edit.

``label`` is the human-facing name; ``metadata.entity_key`` is the identity
an AI re-run matches against (``entity_key``). A reviewer who sees that the
machine filed a finding under the wrong entry re-keys the row here, and the
next re-run lands on it. The write is append-only on the identity side
(``entity_key_history``) and guarded by the coordinate the client already
holds: :meth:`ExtractionInstanceRepository.get_in_coordinate` is the ONE
instance-in-coordinate predicate, so a foreign row is "not found", never
"forbidden" — existence does not leak.

A re-key onto an identity a sibling already holds is refused with the typed
409 ``EntryKeyDuplicateError`` before anything is mutated; the unique index
(``ENTITY_KEY_UNIQUE_INDEX``) is the backstop for a concurrent writer the
pre-check cannot see, and its violation maps to the same error.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.integrity import violates_constraint
from app.repositories import ExtractionInstanceRepository
from app.schemas.extraction_run import RunViewInstance
from app.services.entity_key import (
    ENTITY_KEY_UNIQUE_INDEX,
    key_of,
    match_or_none,
    normalize_key,
    rekey_instance,
)
from app.services.entry_hierarchy_service import EntryKeyDuplicateError


class InstanceNotFoundError(Exception):
    """404-class: the instance is missing OR off the caller's coordinate."""


async def update_instance_identity(
    db: AsyncSession,
    *,
    instance_id: UUID,
    project_id: UUID,
    article_id: UUID,
    template_id: UUID,
    actor_id: UUID,
    label: str | None,
    entity_key: str | None,
) -> RunViewInstance:
    """Apply a rename and/or a re-key; either may be omitted (``None``).

    A blank label is rejected here as well as at the schema (defence in
    depth: the column is NOT NULL and the form renders it). A key equal to
    the current one is a no-op that leaves no history row.
    """
    instance = await ExtractionInstanceRepository(db).get_in_coordinate(
        instance_id, project_id=project_id, article_id=article_id, template_id=template_id
    )
    if instance is None:
        raise InstanceNotFoundError(f"Instance {instance_id} not found")
    trimmed = label.strip() if label is not None else None
    if trimmed == "":
        raise ValueError("label cannot be blank")
    rekey = entity_key if entity_key is not None and entity_key.strip() else None
    if rekey is not None and normalize_key(rekey) != key_of(instance):
        holder = await match_or_none(
            db,
            article_id=article_id,  # get_in_coordinate bound the instance to it
            entity_type_id=instance.entity_type_id,
            key_value=rekey,
            parent_instance_id=instance.parent_instance_id,
            exclude_id=instance.id,
        )
        if holder is not None:
            raise EntryKeyDuplicateError(rekey)
    try:
        # The savepoint keeps the session usable when the index refuses the
        # write; the mutations sit inside it because ``begin_nested`` flushes
        # pending state before it opens.
        async with db.begin_nested():
            if trimmed is not None:
                instance.label = trimmed
            if rekey is not None:
                rekey_instance(instance, key_value=rekey, actor_id=actor_id)
            await db.flush()
    except IntegrityError as exc:
        if not violates_constraint(exc, ENTITY_KEY_UNIQUE_INDEX):
            raise
        raise EntryKeyDuplicateError(rekey or "") from exc
    # ``updated_at`` is server-generated and expired by the flush; load it
    # here rather than letting the validator trip a lazy load mid-await.
    await db.refresh(instance)
    return RunViewInstance.model_validate(instance)

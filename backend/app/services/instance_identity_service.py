"""Rename and re-key one extraction instance — the reviewer's identity edit.

``label`` is the human-facing name; ``metadata.entity_key`` is the identity
an AI re-run matches against (``entity_key``). A reviewer who sees that the
machine filed a finding under the wrong entry re-keys the row here, and the
next re-run lands on it. The write is append-only on the identity side
(``entity_key_history``) and guarded by the coordinate the client already
holds: :meth:`ExtractionInstanceRepository.get_in_coordinate` is the ONE
instance-in-coordinate predicate, so a foreign row is "not found", never
"forbidden" — existence does not leak.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import ExtractionInstanceRepository
from app.schemas.extraction_run import RunViewInstance
from app.services.entity_key import rekey_instance


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
    if label is not None:
        trimmed = label.strip()
        if not trimmed:
            raise ValueError("label cannot be blank")
        instance.label = trimmed
    if entity_key is not None and entity_key.strip():
        rekey_instance(instance, key_value=entity_key, actor_id=actor_id)
    await db.flush()
    # ``updated_at`` is server-generated and expired by the flush; load it
    # here rather than letting the validator trip a lazy load mid-await.
    await db.refresh(instance)
    return RunViewInstance.model_validate(instance)

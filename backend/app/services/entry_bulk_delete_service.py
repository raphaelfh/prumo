"""Delete several entries of a repeating section in ONE transaction.

The single delete is still a browser PostgREST call. This exists because a
BULK delete is not N of those: deleting an entry cascades to its child
instances, its values and its reviewer decisions, so a loop that removes six
of eight and then hits a refusal leaves audit-bearing tables in a state no
reviewer asked for and no undo restores. Validating the whole set first and
then issuing one statement makes the batch all-or-nothing.

Same reasoning as trees B2 moving entry CREATION server-side, and the same
gate: the caller must be a project reviewer, because what is destroyed here
is per-reviewer decision history.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionEntityType, ExtractionInstance
from app.repositories.extraction_repository import ExtractionInstanceRepository


class EntryNotFoundError(Exception):
    """One of the ids is missing, or sits outside the request coordinate.

    404-class, and deliberately ONE error for both cases: a distinct
    "exists but not yours" would make the endpoint an existence oracle for
    entries in projects the caller cannot see. The message names the id the
    caller already sent and nothing else about the row.
    """


class EntryNotRepeatingError(Exception):
    """One of the ids belongs to a section that does not repeat.

    422-class: a ``cardinality='one'`` instance is scaffolding the session
    seeds, not an entry a reviewer added. Deleting one through the entry
    control would empty a section the completion gate still counts, and no
    entry control offers it — so reaching here means a hand-made request.
    """


async def delete_entries(
    db: AsyncSession,
    *,
    instance_ids: list[UUID],
    project_id: UUID,
    article_id: UUID,
    template_id: UUID,
) -> int:
    """Delete every named entry, or none of them. Returns the count.

    Validation runs over the WHOLE set before the first row is touched, so a
    refusal is inert: the caller sees the same tree it saw before.
    """
    # The scoped read is the BOLA guard — `get_in_coordinate` holds the one
    # implementation of the instance-in-coordinate predicate, and it binds
    # the scope in the WHERE clause, so a foreign row is never loaded and
    # never locked.
    repo = ExtractionInstanceRepository(db)
    found: list[ExtractionInstance] = []
    for instance_id in instance_ids:
        instance = await repo.get_in_coordinate(
            instance_id,
            project_id=project_id,
            article_id=article_id,
            template_id=template_id,
        )
        if instance is None:
            raise EntryNotFoundError(f"Entry {instance_id} not found")
        found.append(instance)

    # One query for the whole set rather than one per entry: the sections
    # repeat by definition here, so the id list is short and distinct.
    repeating = set(
        (
            await db.execute(
                select(ExtractionEntityType.id).where(
                    ExtractionEntityType.id.in_({i.entity_type_id for i in found}),
                    ExtractionEntityType.cardinality == "many",
                )
            )
        )
        .scalars()
        .all()
    )
    for instance in found:
        if instance.entity_type_id not in repeating:
            raise EntryNotRepeatingError(
                f"Entry {instance.id} belongs to a section that does not repeat"
            )

    await db.execute(delete(ExtractionInstance).where(ExtractionInstance.id.in_(instance_ids)))
    await db.flush()
    return len(instance_ids)

"""Validate that client-supplied ids sit on the coordinate they claim.

Two shapes, one rule. :func:`assert_coords_coherent` checks a
(run, instance, field) triplet for the workflow writers.
:func:`assert_instance_in_coordinate` checks a lone instance id against an
explicit (project, article, template) — the kickoff surface, which has no run
yet on a first extraction.
"""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.extraction_repository import ExtractionInstanceRepository


class CoordinateMismatchError(Exception):
    """Raised when a client-supplied id does not sit on the coordinate.

    One error for "missing" and for "belongs to someone else" so a caller
    probing ids cannot tell them apart. HTTP translation in the router."""


async def assert_coords_coherent(
    db: AsyncSession,
    *,
    run_id: UUID,
    instance_id: UUID,
    field_id: UUID,
) -> None:
    """Raise CoordinateMismatchError if triplet is incoherent.

    Coherent means:
    - The run exists.
    - instance_id belongs to the run's template.
    - instance_id belongs to the run's article. Runs are per-article and so
      are instances, so a template-coherent instance from a *different*
      article must still be rejected; otherwise a proposal/decision/consensus
      row could be written against the wrong article's run (#79).
    - field_id belongs to instance_id's entity_type.
    """
    result = await db.execute(
        text(
            """
            SELECT 1
            FROM public.extraction_runs r
            JOIN public.extraction_instances i
              ON i.id = :instance_id
             AND i.template_id = r.template_id
             AND i.article_id = r.article_id
            JOIN public.extraction_entity_types et
              ON et.id = i.entity_type_id
            JOIN public.extraction_fields f
              ON f.id = :field_id AND f.entity_type_id = et.id
            WHERE r.id = :run_id
            """
        ),
        {"run_id": run_id, "instance_id": instance_id, "field_id": field_id},
    )
    if result.scalar() is None:
        raise CoordinateMismatchError(
            f"Coordinate mismatch: run={run_id} instance={instance_id} field={field_id}"
        )


async def assert_instance_in_coordinate(
    db: AsyncSession,
    *,
    instance_id: UUID,
    project_id: UUID,
    article_id: UUID,
    template_id: UUID,
) -> None:
    """Raise CoordinateMismatchError unless the instance sits on the coordinate.

    The BOLA guard for a client-supplied ``parent_instance_id``. The api layer
    may not reach a repository, so the scoped lookup is exposed here;
    :meth:`ExtractionInstanceRepository.get_in_coordinate` holds the predicate
    this and the extraction service share.
    """
    found = await ExtractionInstanceRepository(db).get_in_coordinate(
        instance_id,
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )
    if found is None:
        raise CoordinateMismatchError(f"Instance {instance_id} not found")

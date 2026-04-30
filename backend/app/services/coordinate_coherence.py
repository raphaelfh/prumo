"""Validate (run, instance, field) coordinate triplet coherence."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class CoordinateMismatchError(Exception):
    """Raised when (instance_id, field_id) don't match run's template/entity_type."""


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
    - field_id belongs to instance_id's entity_type.
    """
    result = await db.execute(
        text(
            """
            SELECT 1
            FROM public.extraction_runs r
            JOIN public.extraction_instances i
              ON i.id = :instance_id AND i.template_id = r.template_id
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

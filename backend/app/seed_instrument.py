"""Converge the stable ``instrument`` code onto seeded globals and their clones.

Lives outside ``app.seed`` because that module sits at its file-size cap.
``app.seed.main`` imports it function-locally (this module imports
``app.seed``'s template ids, so a top-level import there would be circular).
PROBAST+AI sets its own code in ``app.seed_probast_ai``'s converge.

Idempotent and boot-safe: both statements write only rows whose code differs.
The draft-marker triggers (0048) live on entity types and fields, so updating
the template row never opens a draft on a clone.
"""

from uuid import UUID

from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionTemplateGlobal
from app.seed import (
    _CHARMS_TEMPLATE_ID,
    _MM_TEMPLATE_ID,
    _PROBAST_TEMPLATE_ID,
    _QUADAS2_TEMPLATE_ID,
)

GLOBAL_INSTRUMENTS: dict[UUID, str] = {
    _CHARMS_TEMPLATE_ID: "charms",
    _MM_TEMPLATE_ID: "charms_mm",
    _PROBAST_TEMPLATE_ID: "probast",
    _QUADAS2_TEMPLATE_ID: "quadas2",
}

_COPY_TO_CLONES = text(
    "UPDATE public.project_extraction_templates t SET instrument = g.instrument "
    "FROM public.extraction_templates_global g "
    "WHERE t.global_template_id = g.id AND t.instrument IS DISTINCT FROM g.instrument"
)


async def converge_instrument_codes(session: AsyncSession) -> None:
    """Set each listed global's code, then copy every global's code to its clones."""
    for template_id, code in GLOBAL_INSTRUMENTS.items():
        await session.execute(
            update(ExtractionTemplateGlobal)
            .where(
                ExtractionTemplateGlobal.id == template_id,
                ExtractionTemplateGlobal.instrument != code,
            )
            .values(instrument=code)
        )
    await session.execute(_COPY_TO_CLONES)

"""Finalize backstop: a published judgment that overrides its derived default
must carry a rationale (design 2026-08-26 §5).

This is the authoritative half of a requirement the client also renders. Both
read ONE computation: ``build_derived_judgments_payload`` stamps
``rationale_required`` on every entry, the QA screen shows it, and this module
refuses the finalize on it — over the PUBLISHED states, the canonical set at
that point. A client that decided it independently is how a screen comes to
show no requirement for a divergence the server then refuses.

The client cannot be the enforcement on its own: it reads the caller's own
values while this reads the published set, and the consensus panel can publish
a divergence no reviewer's form ever saw. So the client explains and the server
enforces — which is what makes the trace guarantee real (constitution §IX).

Data-driven and kind-neutral: the rule is the template's own
``derived_judgments`` spec, and a template without one exits on the first
query, so extraction runs need no ``kind ==`` branch here.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.extraction import ExtractionInstance, ProjectExtractionTemplate
from app.models.extraction_workflow import ExtractionPublishedState
from app.services.derived_judgment_payload import (
    build_derived_judgments_payload,
)
from app.services.derived_judgment_service import derived_spec
from app.services.extraction_snapshot import entity_types_for_version


def divergences_without_rationale(
    *,
    template_schema: Any,
    entity_types: Sequence[Any],
    instances: Sequence[Any],
    published: Sequence[Any],
) -> list[str]:
    """Labels of the recommendations whose published judgment overrides the
    derived default with nothing written to justify it.

    The rule itself lives in ``build_derived_judgments_payload``, which stamps
    ``rationale_required`` on every entry — so the refusal here and the
    requirement the QA screen renders are the same computation over different
    value sets, and cannot drift. The payload also brings the §2a scope filter:
    an excluded section's default is None, so a leftover published value in an
    inapplicable part can never strand a finalize.
    """
    return [
        entry.label
        for entry in build_derived_judgments_payload(
            template_schema=template_schema,
            entity_types=entity_types,
            instances=instances,
            values=published,
        )
        if entry.rationale_required
    ]


async def divergence_rationale_failure(db: AsyncSession, run: Any) -> str | None:
    """The message that must block *run*'s finalize, or None to let it through.

    Reads the live ``schema_`` (like every other scope/derivation consumer)
    against the run's FROZEN entity-types tree, and exits after one cheap
    lookup for a template that declares no derived judgments.
    """
    template = await db.get(ProjectExtractionTemplate, run.template_id)
    schema = getattr(template, "schema_", None)
    if not derived_spec(schema):
        return None

    entity_types = await entity_types_for_version(
        db, version_id=run.version_id, template_id=run.template_id
    )
    instances = (
        (
            await db.execute(
                select(ExtractionInstance)
                .where(
                    ExtractionInstance.article_id == run.article_id,
                    ExtractionInstance.template_id == run.template_id,
                )
                .order_by(ExtractionInstance.entity_type_id, ExtractionInstance.sort_order)
            )
        )
        .scalars()
        .all()
    )
    published = (
        (
            await db.execute(
                select(ExtractionPublishedState).where(ExtractionPublishedState.run_id == run.id)
            )
        )
        .scalars()
        .all()
    )

    blocked = divergences_without_rationale(
        template_schema=schema,
        entity_types=entity_types,
        instances=instances,
        published=published,
    )
    if not blocked:
        return None
    # Name the COORDINATES and the surface that fixes them: a refusal at the
    # last action of a long assessment is a dead end if it only says "no".
    return (
        f"Cannot finalize run {run.id}: {len(blocked)} judgment(s) differ from the "
        f"derived default with no rationale recorded ({', '.join(blocked)}). "
        "Record a rationale for each in Resolve divergence before finalizing."
    )

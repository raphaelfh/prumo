"""Finalize backstop: a published judgment that overrides its derived default
must carry a rationale (design 2026-08-26 §5).

The client holds a diverging pick until the reviewer writes one
(``QASectionAccordion.handleJudgmentChange``), but that gate is local UI state
on ONE surface: the consensus compare table publishes straight through, and a
divergence hydrated from an earlier session is only annotated, never blocked.
So the guarantee that every AI-derived default a human overrode is explained
(constitution §IX) is only real if the authoritative side checks it too. This
is that check, run over the PUBLISHED states — the canonical set at finalize.

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
    first_instance_by_entity_type,
)
from app.services.derived_judgment_service import derived_spec, judgment_of
from app.services.extraction_snapshot import entity_types_for_version
from app.services.value_semantics import unwrap_value_envelope


def _rationale_is_empty(raw: Any) -> bool:
    """Mirror of the client's ``rationaleIsEmpty`` — NOT ``is_value_filled``.

    Two deliberate departures from the shared emptiness predicate, both so the
    backstop can never be stricter than the form that fed it: whitespace is
    empty here (``is_value_filled`` calls ``"  "`` filled), and a disposition
    marker peels to None and counts as empty (``is_value_filled`` calls any
    marker filled). A missing published row is empty for the same reason the
    client reads an absent key as empty.
    """
    value = unwrap_value_envelope(raw)
    return value is None or (isinstance(value, str) and value.strip() == "")


def divergences_without_rationale(
    *,
    template_schema: Any,
    entity_types: Sequence[Any],
    instances: Sequence[Any],
    published: Sequence[Any],
) -> list[str]:
    """Labels of the recommendations whose published judgment overrides the
    derived default with nothing written to justify it.

    Reuses ``build_derived_judgments_payload`` rather than re-deriving — the
    module's own iron rule — which also brings the §2a scope filter along: an
    excluded section's default comes back None, so a leftover published value
    in an inapplicable part can never strand a finalize.
    """
    payload = build_derived_judgments_payload(
        template_schema=template_schema,
        entity_types=entity_types,
        instances=instances,
        values=published,
    )
    # The SAME resolution the payload used, not a copy of it: the payload names
    # the target's ENTITY TYPE and a published value is keyed by instance, so a
    # second implementation could silently check a different row.
    instance_by_entity_type = first_instance_by_entity_type(instances)
    # The payload keeps the target's entity type but drops the rationale's, so
    # the rationale is located through the tree rather than assumed to sit in
    # the target's section. Every seeded pair is co-located today; assuming it
    # would read a split pair as "no rationale written" and strand the run.
    entity_type_by_field = {f.id: et.id for et in entity_types for f in et.fields}
    value_by_ids = {(v.instance_id, v.field_id): v.value for v in published}

    blocked: list[str] = []
    for entry in payload:
        # Entries carrying a target are the RECOMMENDATIONS; a computed overall
        # owns no stored judgment, and a None default has nothing to diverge
        # from. A dangling target/rationale pointer already warned upstream.
        if entry.value is None or entry.target_field_id is None:
            continue
        if entry.rationale_field_id is None:
            continue
        instance_id = instance_by_entity_type.get(entry.target_entity_type_id)
        if instance_id is None:
            continue
        # "no information" IS a judgment on a domain (methodology.md §4b), so
        # overriding a default with it owes a rationale like any other pick;
        # N/A and N/E resolve to None and drop out, as does a blank.
        judgment = judgment_of(
            value_by_ids.get((instance_id, entry.target_field_id)),
            no_information_as_unclear=True,
        )
        if judgment is None or judgment == entry.value:
            continue
        rationale_instance = instance_by_entity_type.get(
            entity_type_by_field.get(entry.rationale_field_id)
        )
        if rationale_instance is None:
            continue
        if _rationale_is_empty(value_by_ids.get((rationale_instance, entry.rationale_field_id))):
            blocked.append(entry.label)
    return blocked


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

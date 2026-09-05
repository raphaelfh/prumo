"""The chain of entries an instance sits under, for the three prompts.

A section at any depth is extracted against ONE instance, and the prompt
has to say which entries that instance belongs to — "model XGBoost ›
validation external" — or a nested singleton is extracted from a prompt
that never names its model (the gap the trees spec §1 records). The chain
is walked over instances (``parent_instance_id``) through the run-scoped
getter, so a stranger's instance is refused before any LLM call; the noun
per level is the group's ``entry_label`` as the run is pinned to it (the
template-scoped live row for a type outside the pin, ``DEFAULT_ENTRY_LABEL``
when unset). Results are memoized on the service per ``(run, instance)``:
the per-entry batch extracts every child section under the same parent,
and only the first walks.

Lives beside ``SectionExtractionService`` (which sits on its file-size
ceiling) and takes the service for its repositories and its pinned-tree
provider, like ``entry_group_extraction`` does.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from app.llm.prompts import Ancestor
from app.models.extraction import DEFAULT_ENTRY_LABEL

if TYPE_CHECKING:
    from app.models.extraction import ExtractionRun
    from app.services.section_extraction_service import SectionExtractionService


async def ancestry_of(
    service: SectionExtractionService, run: ExtractionRun, instance_id: UUID | None
) -> tuple[Ancestor, ...]:
    """The entries enclosing ``instance_id`` (itself included), outermost
    first; ``()`` for a root section's call (no parent instance).

    Raises ``ValueError`` when any instance on the chain is not on the run's
    coordinate — the refusal the parent re-verification made before this
    walk existed, now ahead of the LLM call on every path.
    """
    if instance_id is None:
        return ()
    key = (run.id, instance_id)
    chain = service._ancestry.get(key)
    if chain is None:
        instance = await service._instances.get_on_run(instance_id, run)
        if instance is None:
            raise ValueError(f"Parent instance not found: {instance_id}")
        above = await ancestry_of(service, run, instance.parent_instance_id)
        noun = await _noun_of(service, run, instance.entity_type_id)
        chain = (*above, Ancestor(noun=noun, label=instance.label))
        service._ancestry[key] = chain
    return chain


async def _noun_of(
    service: SectionExtractionService, run: ExtractionRun, entity_type_id: UUID
) -> str:
    """The group's noun as the run is pinned to it. A type outside the pin
    (re-pin race) reads its live row through the same template-scoped getter
    the single-section path uses, so a foreign type refuses rather than
    lending a noun; ``DEFAULT_ENTRY_LABEL`` when neither carries one."""
    pinned = await service._pinned_entity_types(run)
    entity_type: Any = next((et for et in pinned if et.id == entity_type_id), None)
    if entity_type is None:
        entity_type = await service._get_entity_type(
            entity_type_id, project_template_id=run.template_id
        )
    noun: str | None = entity_type.entry_label
    return noun or DEFAULT_ENTRY_LABEL

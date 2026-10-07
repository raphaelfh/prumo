"""The chain of entries an instance sits under, for the prompts.

A section at any depth is extracted against ONE instance, and the prompt has
to say which entries that instance belongs to — "model XGBoost › validation
external" — or a nested singleton is extracted from a prompt that never names
its model. The chain is walked over instances (``parent_instance_id``)
through the run-scoped getter, so a stranger's instance is refused before
any model call, and a cycle in the parent graph (nothing in the schema
forbids one) is refused the same way instead of walked forever. The noun per
level is the group's ``entry_label`` as the run is pinned to it. Chains are
memoized per ``(run, instance)``: the per-entry batch extracts every child
section under the same parent, and only the first walks.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.llm.prompts import Ancestor
from app.models.extraction import DEFAULT_ENTRY_LABEL, ExtractionRun
from app.services.ai_extraction._pipeline import Pipeline


def noun_of(entity_type: Any) -> str:
    """The noun a group's entries read as; ``DEFAULT_ENTRY_LABEL`` when the
    pinned or live row carries none."""
    noun: str | None = entity_type.entry_label
    return noun or DEFAULT_ENTRY_LABEL


async def ancestry_of(
    p: Pipeline,
    run: ExtractionRun,
    instance_id: UUID | None,
    *,
    _seen: frozenset[UUID] = frozenset(),
) -> tuple[Ancestor, ...]:
    """The entries enclosing ``instance_id`` (itself included), outermost
    first; ``()`` for a root section's call (no parent instance).

    Raises ``ValueError`` when any instance on the chain is not on the run's
    coordinate, or repeats — one 404-class refusal, ahead of the model call
    on every path (the instance write re-verifies the parent once more).
    """
    if instance_id is None:
        return ()
    if instance_id in _seen:
        raise ValueError(f"Parent instance not found: {instance_id}")
    key = (run.id, instance_id)
    chain = p.ancestry.get(key)
    if chain is None:
        instance = await p.instances.get_on_run(instance_id, run)
        if instance is None:
            raise ValueError(f"Parent instance not found: {instance_id}")
        above = await ancestry_of(p, run, instance.parent_instance_id, _seen=_seen | {instance_id})
        entity_type, _from_pin = await p.entity_type_on_run(run, instance.entity_type_id)
        chain = (*above, Ancestor(noun=noun_of(entity_type), label=instance.label))
        p.ancestry[key] = chain
    return chain

"""The chain of entries an instance sits under, outermost first.

Every prompt that scopes to an entry names the WHOLE chain ("model
XGBoost › validation external"), not one parent label: a singleton at depth
three would otherwise be extracted from a prompt that never names the model
it belongs to. The walk is over instances (``parent_instance_id``), the noun
per level comes from the run-pinned tree, and the result is memoized per
``(run, instance)`` so a per-entry batch does not re-walk for every section.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.llm.prompts import Ancestor
from app.services.entry_ancestry import ancestry_of

TEMPLATE_ID = uuid4()
RUN = SimpleNamespace(id=uuid4(), template_id=TEMPLATE_ID)
MODEL_TYPE, VALIDATION_TYPE, SECTION_TYPE = uuid4(), uuid4(), uuid4()
PINNED = [
    SimpleNamespace(id=MODEL_TYPE, entry_label="model"),
    SimpleNamespace(id=VALIDATION_TYPE, entry_label="validation"),
    SimpleNamespace(id=SECTION_TYPE, entry_label=None),
]


def _instance(entity_type_id: UUID, label: str, parent: UUID | None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(), entity_type_id=entity_type_id, label=label, parent_instance_id=parent
    )


class _Instances:
    """The run-scoped getter, counting calls so the memo can be proven."""

    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = {row.id: row for row in rows}
        self.calls = 0

    async def get_on_run(self, instance_id: UUID, _run: Any) -> SimpleNamespace | None:
        self.calls += 1
        return self.rows.get(instance_id)


def _service(
    rows: list[SimpleNamespace],
    *,
    pinned: list[SimpleNamespace] | None = None,
    live: dict[UUID, SimpleNamespace] | None = None,
) -> SimpleNamespace:
    """The three seams the resolver uses, faked: the run-scoped instance
    getter, the pinned-tree provider and the template-scoped live read."""
    pinned_rows = pinned if pinned is not None else []
    live_rows = live or {}
    live_calls = {"n": 0}

    async def _pinned_entity_types(_run: Any) -> list[SimpleNamespace]:
        return pinned_rows

    async def _get_entity_type(entity_type_id: UUID, *, project_template_id: UUID) -> Any:
        live_calls["n"] += 1
        assert project_template_id == TEMPLATE_ID, "the live read is scoped to the run's template"
        row = live_rows.get(entity_type_id)
        if row is None:
            raise ValueError(f"Entity type not found: {entity_type_id}")
        return row

    return SimpleNamespace(
        _instances=_Instances(rows),
        _pinned_entity_types=_pinned_entity_types,
        _get_entity_type=_get_entity_type,
        _ancestry={},
        live_calls=live_calls,
    )


@pytest.mark.asyncio
async def test_no_parent_means_no_ancestors() -> None:
    service = _service([])
    assert await ancestry_of(service, RUN, None) == ()
    assert service._instances.calls == 0


@pytest.mark.asyncio
async def test_a_depth_three_chain_reads_outermost_first() -> None:
    model = _instance(MODEL_TYPE, "XGBoost", None)
    validation = _instance(VALIDATION_TYPE, "external", model.id)
    section = _instance(SECTION_TYPE, "Calibration", validation.id)
    service = _service([model, validation, section], pinned=PINNED)

    chain = await ancestry_of(service, RUN, section.id)

    assert chain == (
        Ancestor(noun="model", label="XGBoost"),
        Ancestor(noun="validation", label="external"),
        Ancestor(noun="entry", label="Calibration"),
    )


@pytest.mark.asyncio
async def test_the_noun_falls_back_from_the_pin_to_the_live_row_to_the_default() -> None:
    """The pinned noun wins; a type outside the pin reads its live row through
    the template-scoped getter; a live row with no noun reads
    ``DEFAULT_ENTRY_LABEL``; a type that is not the run's template's refuses."""
    live_only, nowhere, foreign = uuid4(), uuid4(), uuid4()
    a = _instance(MODEL_TYPE, "A", None)
    b = _instance(live_only, "B", a.id)
    c = _instance(nowhere, "C", b.id)
    service = _service(
        [a, b, c],
        pinned=[SimpleNamespace(id=MODEL_TYPE, entry_label="model")],
        live={
            live_only: SimpleNamespace(id=live_only, entry_label="arm"),
            nowhere: SimpleNamespace(id=nowhere, entry_label=None),
        },
    )

    chain = await ancestry_of(service, RUN, c.id)

    assert [x.noun for x in chain] == ["model", "arm", "entry"]
    assert service.live_calls["n"] == 2, "only the two types outside the pin are read live"

    stranger = _instance(foreign, "D", c.id)
    service._instances.rows[stranger.id] = stranger
    with pytest.raises(ValueError, match=f"Entity type not found: {foreign}"):
        await ancestry_of(service, RUN, stranger.id)


@pytest.mark.asyncio
async def test_the_walk_is_memoized_per_run_and_instance() -> None:
    model = _instance(MODEL_TYPE, "XGBoost", None)
    validation = _instance(VALIDATION_TYPE, "external", model.id)
    section = _instance(SECTION_TYPE, "Calibration", validation.id)
    service = _service([model, validation, section], pinned=PINNED)

    first = await ancestry_of(service, RUN, validation.id)
    after_first = service._instances.calls
    assert first == await ancestry_of(service, RUN, validation.id)
    assert service._instances.calls == after_first, "a second walk reads nothing"
    # The parent's own chain was memoized on the way up.
    assert await ancestry_of(service, RUN, model.id) == (Ancestor("model", "XGBoost"),)
    assert service._instances.calls == after_first
    # A deeper instance whose parent is memoized reads only its own row.
    assert await ancestry_of(service, RUN, section.id) == (
        Ancestor("model", "XGBoost"),
        Ancestor("validation", "external"),
        Ancestor("entry", "Calibration"),
    )
    assert service._instances.calls == after_first + 1
    assert set(service._ancestry) == {(RUN.id, i.id) for i in (model, validation, section)}


@pytest.mark.asyncio
async def test_a_stranger_or_missing_instance_is_refused_before_any_prompt() -> None:
    service = _service([], pinned=PINNED)
    missing = uuid4()
    with pytest.raises(ValueError, match=f"Parent instance not found: {missing}"):
        await ancestry_of(service, RUN, missing)

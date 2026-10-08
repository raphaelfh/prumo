"""``Pipeline`` reads the run's pinned tree once per (run, pin).

The ancestry walk asks ``entity_type_on_run`` once per instance on a chain,
and extract-all walks every root entry: each lookup re-validating the whole
snapshot was pure repeat work.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.ai_extraction import _pipeline
from app.services.ai_extraction._pipeline import Pipeline

pytestmark = pytest.mark.asyncio


def _pipeline_on(db: Any) -> Pipeline:
    return Pipeline(
        db,
        user_id=str(uuid4()),
        storage=MagicMock(),
        trace_id="memo",
        credentials=None,
        key_provider=None,
        repin=False,
        attempt_id=None,
        owns_transactions=False,
        llm=MagicMock(),
    )


async def test_the_pinned_tree_is_read_once_per_run_and_pin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    section, child = SimpleNamespace(id=uuid4()), SimpleNamespace(id=uuid4())
    reads: list[Any] = []

    async def tree(_db: Any, *, version_id: Any, **_: Any) -> list[Any]:
        reads.append(version_id)
        return [section, child]

    monkeypatch.setattr(_pipeline, "entity_types_for_version", tree)
    p = _pipeline_on(MagicMock())
    run = SimpleNamespace(id=uuid4(), version_id=uuid4(), template_id=uuid4())

    assert await p.entity_type_on_run(run, section.id) == (section, True)  # type: ignore[arg-type]
    assert await p.entity_type_on_run(run, child.id) == (child, True)  # type: ignore[arg-type]
    assert await p.pinned_entity_types(run) == [section, child]  # type: ignore[arg-type]
    assert reads == [run.version_id]

    run.version_id = uuid4()  # a re-pin is a different tree
    await p.pinned_entity_types(run)  # type: ignore[arg-type]
    assert reads == [reads[0], run.version_id]

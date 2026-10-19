"""``Pipeline.adopt_frozen_engine`` fails an agent batch's keyless request up
front, and leaves human runs' lazy model build untouched.

With no key at all, a human run (``allow_global_key=True``) adopts its engine
without building a model — the section loops build it later, as before. An
agent batch (``allow_global_key=False``) builds eagerly so the refused
deployment key raises ``MissingLLMKeyError`` for the whole request.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.llm import provider
from app.llm.provider import MissingLLMKeyError
from app.schemas.llm_target import LlmTarget
from app.services.ai_extraction import _pipeline
from app.services.ai_extraction._pipeline import Pipeline
from tests.fakes.usage_sink import RecordingUsageSink

pytestmark = pytest.mark.asyncio

_ENGINE = LlmTarget(provider="openai", model="gpt-x")


def _make(*, allow_global_key: bool) -> Pipeline:
    return Pipeline(
        MagicMock(),
        user_id=str(uuid4()),
        storage=MagicMock(),
        trace_id="key-refusal",
        credentials=None,
        key_provider="openai",
        repin=False,
        attempt_id=None,
        owns_transactions=False,
        llm=MagicMock(),
        usage_sink=RecordingUsageSink(),
        allow_global_key=allow_global_key,
    )


@pytest.fixture
def keyless(monkeypatch: pytest.MonkeyPatch) -> None:
    async def freeze(*_: Any, **__: Any) -> LlmTarget:
        return _ENGINE

    async def no_rekey(*_: Any, **__: Any) -> None:
        return None

    monkeypatch.setattr(_pipeline, "freeze_run_engine", freeze)
    monkeypatch.setattr(_pipeline, "rekey_for_adopted_engine", no_rekey)
    monkeypatch.setattr(provider, "global_key_for", lambda _p: None)


@pytest.mark.usefixtures("keyless")
async def test_human_run_adopts_without_building_the_model() -> None:
    assert (
        await _make(allow_global_key=True).adopt_frozen_engine(uuid4(), _ENGINE, uuid4()) == "gpt-x"
    )


@pytest.mark.usefixtures("keyless")
async def test_agent_batch_without_a_key_fails_at_adoption() -> None:
    with pytest.raises(MissingLLMKeyError, match="deployment's key"):
        await _make(allow_global_key=False).adopt_frozen_engine(uuid4(), _ENGINE, uuid4())

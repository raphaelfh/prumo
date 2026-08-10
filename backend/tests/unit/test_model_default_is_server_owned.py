"""The server owns the extraction engine — the client cannot choose it (C1a).

C1 removed the frontend's own `'gpt-4o-mini'` from three request builders,
but the *schema* still accepted a `model` string and `run_from_request` /
`extract_models` preferred it over `settings.LLM_DEFAULT_MODEL`. That left
the real hole open: the frontend is not the only client, and any browser
could POST `{"model": "<anything>"}` and have that string reach
`build_model()` with no allow-list in between.

C1a deleted the field. These tests pin both halves of the new contract:

1. A client-supplied `model` key never reaches `build_model()`, by one of
   two mechanisms:

   - `ModelExtractionRequest` sets `extra='forbid'` and REJECTS it with a
     422. That request is validated exactly once, in the request cycle, so
     failing loudly beats dropping the caller's choice in silence.
   - `SectionExtractionRequest` / `ExtractionOptions` keep pydantic's
     `extra='ignore'` default, so the key is DROPPED: it never becomes an
     attribute and never survives `model_dump()`, which also closes the
     Celery path, where the endpoint round-trips the payload through
     `model_dump(mode='json')` and rebuilds the request in the worker.
     `forbid` is deliberately deferred there to a LATER deploy — a payload
     enqueued by a pre-C1a web process still carries `model`, and under
     `forbid` the worker-side rebuild would raise a ValidationError that
     `is_transient_llm_error` treats as non-transient, killing the job with
     no retry.
2. The engine every dispatch branch actually uses is
   `settings.LLM_DEFAULT_MODEL`. If that stops being the resolved value,
   extraction silently changes model, so it is asserted here rather than
   left to the caller.
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.extraction import (
    ExtractionOptions,
    ModelExtractionRequest,
    SectionExtractionRequest,
)
from app.services.section_extraction_service import SectionExtractionService

_IDS = {
    "projectId": "ffffffff-9999-0001-0000-000000000001",
    "articleId": "ffffffff-9999-0002-0000-0000000009c1",
    "templateId": "ffffffff-9999-0003-0000-000000000001",
}


def test_the_section_request_has_no_model_field() -> None:
    assert "model" not in SectionExtractionRequest.model_fields


def test_the_model_extraction_request_has_no_model_field() -> None:
    assert "model" not in ModelExtractionRequest.model_fields


def test_extraction_options_have_no_model_field() -> None:
    assert "model" not in ExtractionOptions.model_fields


def test_a_client_supplied_model_is_ignored_on_the_section_request() -> None:
    # extra='ignore' (the pydantic v2 default, unchanged here) => the key is
    # accepted by the parser but dropped, so nothing downstream can read it.
    payload = SectionExtractionRequest(
        **_IDS,
        entityTypeId="ffffffff-9999-0004-0000-000000000001",
        model="gpt-5",  # type: ignore[call-arg]
    )
    assert not hasattr(payload, "model")
    assert payload.model_extra is None
    # The endpoint hands `model_dump(mode='json')` to Celery and the worker
    # rebuilds the request from it — the smuggled key must not survive.
    assert "model" not in payload.model_dump(mode="json", by_alias=True)


def test_a_client_supplied_model_is_rejected_on_the_model_extraction_request() -> None:
    # extra='forbid' here (and ONLY here): this request is validated once, in
    # the request cycle, so rejecting loudly costs nothing and beats dropping
    # the caller's choice in silence.
    with pytest.raises(ValidationError) as exc:
        ModelExtractionRequest(**_IDS, model="gpt-5")  # type: ignore[call-arg]

    assert exc.value.errors()[0]["type"] == "extra_forbidden"


def test_a_client_supplied_model_is_ignored_in_extraction_options() -> None:
    opts = ExtractionOptions(model="gpt-5")  # type: ignore[call-arg]
    assert not hasattr(opts, "model")
    assert "model" not in opts.model_dump()


@pytest.mark.asyncio
async def test_run_from_request_resolves_the_server_default() -> None:
    """Even when the caller tried to pick a model, the dispatch forwards
    ``settings.LLM_DEFAULT_MODEL`` to the extraction method."""
    service = SectionExtractionService.__new__(SectionExtractionService)
    service.extract_section = AsyncMock(return_value=object())  # type: ignore[method-assign]

    entity_type_id = uuid4()
    payload = SectionExtractionRequest(
        **_IDS,
        entityTypeId=str(entity_type_id),
        model="gpt-5",  # type: ignore[call-arg]
    )
    await service.run_from_request(payload)

    kwargs = service.extract_section.await_args.kwargs
    assert kwargs["model"] == settings.LLM_DEFAULT_MODEL

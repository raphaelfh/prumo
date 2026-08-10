"""The server owns the extraction engine — the client cannot choose it (C1a).

C1 removed the frontend's own `'gpt-4o-mini'` from three request builders,
but the *schema* still accepted a `model` string and `run_from_request` /
`extract_models` preferred it over `settings.LLM_DEFAULT_MODEL`. That left
the real hole open: the frontend is not the only client, and any browser
could POST `{"model": "<anything>"}` and have that string reach
`build_model()` with no allow-list in between.

C1a deleted the field. These tests pin that a client-supplied `model` can no
longer reach `build_model()`, by either of two mechanisms
(`app/schemas/extraction.py` records why the two schemas differ):

- `ModelExtractionRequest` sets `extra='forbid'` and REJECTS the key with a
  422, rather than dropping the caller's choice in silence.
- `SectionExtractionRequest` / `ExtractionOptions` keep pydantic's
  `extra='ignore'` default, so the key is DROPPED: it never becomes an
  attribute and never survives the `model_dump(mode='json')` round-trip that
  carries the payload to the Celery worker.

The engine actually resolved in its place — `settings.LLM_DEFAULT_MODEL`, on
every dispatch branch — is pinned in `test_run_from_request.py`.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.extraction import (
    ExtractionOptions,
    ModelExtractionRequest,
    SectionExtractionRequest,
)

_IDS = {
    "projectId": "ffffffff-9999-0001-0000-000000000001",
    "articleId": "ffffffff-9999-0002-0000-0000000009c1",
    "templateId": "ffffffff-9999-0003-0000-000000000001",
}


def test_the_section_request_ignores_a_client_supplied_model() -> None:
    assert "model" not in SectionExtractionRequest.model_fields

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


def test_the_model_extraction_request_rejects_a_client_supplied_model() -> None:
    assert "model" not in ModelExtractionRequest.model_fields

    with pytest.raises(ValidationError) as exc:
        ModelExtractionRequest(**_IDS, model="gpt-5")  # type: ignore[call-arg]

    assert exc.value.errors()[0]["type"] == "extra_forbidden"


def test_extraction_options_ignore_a_client_supplied_model() -> None:
    assert "model" not in ExtractionOptions.model_fields

    opts = ExtractionOptions(model="gpt-5")  # type: ignore[call-arg]

    assert not hasattr(opts, "model")
    assert "model" not in opts.model_dump()

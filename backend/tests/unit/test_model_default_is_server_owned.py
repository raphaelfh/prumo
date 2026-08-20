"""The server owns the extraction engine — the client cannot choose it (C1a).

C1 removed the frontend's own `'gpt-4o-mini'` from three request builders,
but the *schema* still accepted a `model` string and `run_from_request` /
`extract_models` preferred it over `settings.LLM_DEFAULT_MODEL`. That left
the real hole open: the frontend is not the only client, and any browser
could POST `{"model": "<anything>"}` and have that string reach
`build_model()` with no allow-list in between.

C1a deleted the field; all three schemas now set `extra='forbid'` and REJECT
an unknown key with a loud 422 rather than dropping the caller's choice in
silence. `SectionExtractionRequest` / `ExtractionOptions` arrived one release
later than `ModelExtractionRequest`, on purpose: they round-trip through
Celery, and a job queued by a pre-C1a web process still carried the dropped
key — under `forbid` that rebuild dies terminally, with no retry. The pre-C1a
era reached prod on 2026-08-11 and the queue drains in minutes, so by
2026-08-16 the straddle window was provably empty
(`app/schemas/extraction.py` records the full sequencing).

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


def test_the_section_request_rejects_a_client_supplied_model() -> None:
    assert "model" not in SectionExtractionRequest.model_fields

    with pytest.raises(ValidationError) as exc:
        SectionExtractionRequest(
            **_IDS,
            entityTypeId="ffffffff-9999-0004-0000-000000000001",
            model="gpt-5",  # type: ignore[call-arg]
        )

    assert exc.value.errors()[0]["type"] == "extra_forbidden"


def test_the_worker_rebuild_of_a_current_payload_still_validates() -> None:
    """The other half of the forbid trade: `forbid` must reject smuggled keys
    WITHOUT breaking the Celery round-trip for payloads the current web
    process actually enqueues. This is the replay the deferral protected."""
    payload = SectionExtractionRequest(
        **_IDS,
        entityTypeId="ffffffff-9999-0004-0000-000000000001",
    )
    rebuilt = SectionExtractionRequest(**payload.model_dump(mode="json"))
    assert rebuilt == payload


def test_the_model_extraction_request_rejects_a_client_supplied_model() -> None:
    assert "model" not in ModelExtractionRequest.model_fields

    with pytest.raises(ValidationError) as exc:
        ModelExtractionRequest(**_IDS, model="gpt-5")  # type: ignore[call-arg]

    assert exc.value.errors()[0]["type"] == "extra_forbidden"


def test_extraction_options_reject_a_client_supplied_model() -> None:
    assert "model" not in ExtractionOptions.model_fields

    with pytest.raises(ValidationError) as exc:
        ExtractionOptions(model="gpt-5")  # type: ignore[call-arg]

    assert exc.value.errors()[0]["type"] == "extra_forbidden"

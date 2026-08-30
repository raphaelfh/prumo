"""One-live-run (0045) integrity-error → HTTP status mapping.

Two create-run surfaces can trip the ``uq_one_live_extraction_run_per_coord``
partial unique index as a DB-level backstop (writers normally serialize on the
(article, template) advisory lock and reuse the live run):

* the raw create endpoint ``extraction_runs.create_run`` — must return 409, not
  mislabel a *hypothetical* FK violation as "run already in progress";
* the AI-extraction endpoint ``model_extraction.extract_models`` — must return
  409, not the blanket 422 "referenced row does not exist".

The shared classifier ``is_one_live_run_conflict`` is unit-tested against both
the asyncpg ``constraint_name`` attribute and the message-text fallback. The
endpoint coroutines are called directly (not via httpx): the ASGI transport's
handler lines do not register on coverage — the diff-cover blind spot — so the
integration suite cannot exercise these ``except`` branches.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints._integrity import (
    ONE_LIVE_RUN_CONFLICT_DETAIL,
    ONE_LIVE_RUN_CONSTRAINT,
    is_one_live_run_conflict,
)
from app.services.engine_credentials import EngineCredentials


class _AsyncpgLikeError(Exception):
    """Stand-in for an asyncpg PostgresError: carries ``constraint_name`` and a
    message string, mirroring what SQLAlchemy wraps in ``IntegrityError.orig``.
    """

    def __init__(self, message: str, constraint_name: str | None = None) -> None:
        super().__init__(message)
        if constraint_name is not None:
            self.constraint_name = constraint_name


def _integrity_error(message: str, constraint_name: str | None = None) -> IntegrityError:
    orig = _AsyncpgLikeError(message, constraint_name)
    return IntegrityError("INSERT INTO public.extraction_runs ...", {}, orig)


# --- classifier ---------------------------------------------------------------


def test_matches_via_constraint_name_attribute() -> None:
    exc = _integrity_error(
        f'duplicate key value violates unique constraint "{ONE_LIVE_RUN_CONSTRAINT}"',
        constraint_name=ONE_LIVE_RUN_CONSTRAINT,
    )
    assert is_one_live_run_conflict(exc) is True


def test_matches_via_message_when_constraint_name_absent() -> None:
    # Defensive redundancy: on the current stack (asyncpg + PG 17.6) the raw
    # UniqueViolationError populates constraint_name (see
    # test_matches_via_cause_chain), but the classifier must not depend on that
    # holding across every driver/server version — the index name is always in
    # the message text, so the fallback catches it when the attribute is absent.
    exc = _integrity_error(
        f'duplicate key value violates unique constraint "{ONE_LIVE_RUN_CONSTRAINT}"',
        constraint_name=None,
    )
    assert is_one_live_run_conflict(exc) is True


def test_does_not_match_foreign_key_violation() -> None:
    exc = _integrity_error(
        'insert or update on table "extraction_runs" violates foreign key '
        'constraint "fk_extraction_runs_created_by"',
        constraint_name="fk_extraction_runs_created_by",
    )
    assert is_one_live_run_conflict(exc) is False


def test_does_not_match_via_cause_chain_for_other_constraint() -> None:
    # __cause__ wrapping (SQLAlchemy's dbapi adapter) must be inspected too, but
    # only a matching name counts.
    inner = _AsyncpgLikeError("boom", constraint_name="some_other_uq")
    outer = _AsyncpgLikeError("wrapper")
    outer.__cause__ = inner
    exc = IntegrityError("INSERT ...", {}, outer)
    assert is_one_live_run_conflict(exc) is False


def test_matches_via_cause_chain() -> None:
    inner = _AsyncpgLikeError("boom", constraint_name=ONE_LIVE_RUN_CONSTRAINT)
    outer = _AsyncpgLikeError("wrapper")  # no constraint_name, no name in text
    outer.__cause__ = inner
    exc = IntegrityError("INSERT ...", {}, outer)
    assert is_one_live_run_conflict(exc) is True


# --- extraction_runs.create_run: 409 for one-live-run, 500 (re-raise) else ----

_RUNS_EP = "app.api.v1.endpoints.extraction_runs"


def _create_run_body(project_id, article_id, template_id):
    from app.schemas.extraction_run import CreateRunRequest

    return CreateRunRequest(
        project_id=project_id,
        article_id=article_id,
        project_template_id=template_id,
    )


@pytest.mark.asyncio
async def test_create_run_maps_one_live_run_to_409() -> None:
    from app.api.v1.endpoints.extraction_runs import create_run

    project_id, article_id, template_id, caller = uuid4(), uuid4(), uuid4(), uuid4()
    service = MagicMock()
    service.create_run = AsyncMock(
        side_effect=_integrity_error(
            f'duplicate key value violates unique constraint "{ONE_LIVE_RUN_CONSTRAINT}"',
            constraint_name=ONE_LIVE_RUN_CONSTRAINT,
        )
    )

    with (
        patch(f"{_RUNS_EP}.ensure_project_member", AsyncMock()),
        patch(f"{_RUNS_EP}.ensure_project_reviewer", AsyncMock()),
        patch(f"{_RUNS_EP}.RunLifecycleService", return_value=service),
        patch(f"{_RUNS_EP}._trace", return_value=None),
        pytest.raises(HTTPException) as exc_info,
    ):
        await create_run(
            body=_create_run_body(project_id, article_id, template_id),
            request=MagicMock(),
            db=AsyncMock(),
            current_user_sub=caller,
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == ONE_LIVE_RUN_CONFLICT_DETAIL


@pytest.mark.asyncio
async def test_create_run_reraises_other_integrity_error() -> None:
    """A non-one-live-run integrity error is NOT "run already in progress" — it
    propagates (→ app-wide 500), never a misleading 409."""
    from app.api.v1.endpoints.extraction_runs import create_run

    project_id, article_id, template_id, caller = uuid4(), uuid4(), uuid4(), uuid4()
    service = MagicMock()
    service.create_run = AsyncMock(
        side_effect=_integrity_error(
            'violates foreign key constraint "fk_extraction_runs_version_id"',
            constraint_name="fk_extraction_runs_version_id",
        )
    )

    with (
        patch(f"{_RUNS_EP}.ensure_project_member", AsyncMock()),
        patch(f"{_RUNS_EP}.ensure_project_reviewer", AsyncMock()),
        patch(f"{_RUNS_EP}.RunLifecycleService", return_value=service),
        patch(f"{_RUNS_EP}._trace", return_value=None),
        pytest.raises(IntegrityError),
    ):
        await create_run(
            body=_create_run_body(project_id, article_id, template_id),
            request=MagicMock(),
            db=AsyncMock(),
            current_user_sub=caller,
        )


# --- model_extraction.extract_models: 409 for one-live-run, 422 else ----------

_MODEL_EP = "app.api.v1.endpoints.model_extraction"


def _model_extraction_payload(project_id, article_id, template_id):
    from app.schemas.extraction import ModelExtractionRequest

    return ModelExtractionRequest(
        project_id=project_id,
        article_id=article_id,
        template_id=template_id,
    )


async def _call_extract_models(payload, service, caller, credentials_error=None):
    from app.api.v1.endpoints.model_extraction import extract_models

    # extract_models is @limiter.limit(...)-decorated (slowapi); its wrapper
    # rejects a non-Request ``request``. Call the pristine coroutine underneath
    # (functools.wraps exposes it) so the unit test exercises the handler body,
    # not the rate limiter.
    raw = getattr(extract_models, "__wrapped__", extract_models)

    from app.schemas.llm_target import LlmTarget

    request = MagicMock()
    request.state.trace_id = None
    with (
        patch(f"{_MODEL_EP}.ensure_project_member", AsyncMock()),
        # Pin the C1b/F4 resolver explicitly: left unpatched on a MagicMock db
        # it happens to fall back to the env default today, but an
        # EngineRetired raise here would 409 and make the one-live-run 409
        # test pass FOR THE WRONG REASON.
        patch(
            f"{_MODEL_EP}.resolve_project_engine",
            AsyncMock(return_value=LlmTarget(provider="openai", model="m-x")),
        ),
        patch(f"{_MODEL_EP}.create_storage_adapter", return_value=MagicMock()),
        # B9: one resolver for key + endpoint host, patched where the route
        # imports it (the endpoint no longer builds an APIKeyService itself).
        patch(
            f"{_MODEL_EP}.resolve_engine_credentials",
            AsyncMock(
                return_value=EngineCredentials(None, None, None, None),
                side_effect=credentials_error,
            ),
        ),
        patch(f"{_MODEL_EP}.ModelExtractionService", return_value=service),
    ):
        db = AsyncMock()
        await raw(
            request=request,
            payload=payload,
            db=db,
            user=SimpleNamespace(sub=str(caller)),
            supabase=MagicMock(),
            current_user_sub=caller,
        )


@pytest.mark.asyncio
async def test_extract_models_maps_one_live_run_to_409() -> None:
    project_id, article_id, template_id, caller = uuid4(), uuid4(), uuid4(), uuid4()
    service = MagicMock()
    service.extract = AsyncMock(
        side_effect=_integrity_error(
            f'duplicate key value violates unique constraint "{ONE_LIVE_RUN_CONSTRAINT}"',
            constraint_name=ONE_LIVE_RUN_CONSTRAINT,
        )
    )

    with pytest.raises(HTTPException) as exc_info:
        await _call_extract_models(
            _model_extraction_payload(project_id, article_id, template_id), service, caller
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == ONE_LIVE_RUN_CONFLICT_DETAIL


@pytest.mark.asyncio
async def test_extract_models_maps_other_integrity_error_to_422() -> None:
    project_id, article_id, template_id, caller = uuid4(), uuid4(), uuid4(), uuid4()
    service = MagicMock()
    service.extract = AsyncMock(
        side_effect=_integrity_error(
            'violates foreign key constraint "fk_extraction_instances_template_id"',
            constraint_name="fk_extraction_instances_template_id",
        )
    )

    with pytest.raises(HTTPException) as exc_info:
        await _call_extract_models(
            _model_extraction_payload(project_id, article_id, template_id), service, caller
        )

    assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_extract_models_lets_the_typed_endpoint_error_through() -> None:
    """``EndpointUnavailableError`` is an ``AppError``, not a ``ValueError``:
    inside the route's broad ``except Exception`` it would become a generic
    500 ("Model extraction failed: ...") instead of the registered typed 409
    that tells the manager to re-verify or re-choose the endpoint.

    Same hazard ``resolve_project_engine`` was hoisted above the try for —
    the credentials resolver raises it too, so it belongs on the same side.
    """
    from app.services.llm_endpoint_service import EndpointUnavailableError

    project_id, article_id, template_id, caller = uuid4(), uuid4(), uuid4(), uuid4()
    service = MagicMock()
    service.extract = AsyncMock(side_effect=AssertionError("must not reach the service"))

    with pytest.raises(EndpointUnavailableError):
        await _call_extract_models(
            _model_extraction_payload(project_id, article_id, template_id),
            service,
            caller,
            credentials_error=EndpointUnavailableError("endpoint is gone"),
        )


@pytest.mark.asyncio
async def test_reopen_run_maps_one_live_run_to_409() -> None:
    """Reopening onto an occupied coordinate is a conflict, not a crash.

    `reopen_run`'s idempotency guard only recognises children OF THIS
    PARENT, but `resolve_or_create_extract_run` (the "Run AI" path) can
    create an UNPARENTED live run over a finalized coordinate — its lookup
    filters on NON_TERMINAL_STAGES, so a finalized run is invisible to it.
    The reopen then inserts, trips
    uq_one_live_extraction_run_per_coord (0045), and — before this — the
    endpoint caught only CannotReopenRunError and ValueError, so the
    IntegrityError escaped as a 500 where the sibling create_run returns a
    truthful 409.
    """
    from app.api.v1.endpoints.extraction_runs import reopen_run

    service = MagicMock()
    service.reopen_run = AsyncMock(
        side_effect=_integrity_error(
            f'duplicate key value violates unique constraint "{ONE_LIVE_RUN_CONSTRAINT}"',
            constraint_name=ONE_LIVE_RUN_CONSTRAINT,
        )
    )
    source_run = MagicMock()
    source_run.project_id = uuid4()

    with (
        patch(f"{_RUNS_EP}.load_run_for_member", AsyncMock(return_value=source_run)),
        patch(f"{_RUNS_EP}.ensure_project_reviewer", AsyncMock()),
        patch(f"{_RUNS_EP}.RunLifecycleService", return_value=service),
        patch(f"{_RUNS_EP}._trace", return_value=None),
        pytest.raises(HTTPException) as exc_info,
    ):
        await reopen_run(
            run_id=uuid4(),
            response=MagicMock(),
            request=MagicMock(),
            db=AsyncMock(),
            current_user_sub=uuid4(),
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == ONE_LIVE_RUN_CONFLICT_DETAIL


@pytest.mark.asyncio
async def test_reopen_run_reraises_other_integrity_error() -> None:
    """Only the one-live-run collision is a 409; anything else propagates."""
    from app.api.v1.endpoints.extraction_runs import reopen_run

    service = MagicMock()
    service.reopen_run = AsyncMock(
        side_effect=_integrity_error(
            'insert or update violates foreign key constraint "some_fk"',
            constraint_name="some_fk",
        )
    )
    source_run = MagicMock()
    source_run.project_id = uuid4()

    with (
        patch(f"{_RUNS_EP}.load_run_for_member", AsyncMock(return_value=source_run)),
        patch(f"{_RUNS_EP}.ensure_project_reviewer", AsyncMock()),
        patch(f"{_RUNS_EP}.RunLifecycleService", return_value=service),
        patch(f"{_RUNS_EP}._trace", return_value=None),
        pytest.raises(IntegrityError),
    ):
        await reopen_run(
            run_id=uuid4(),
            response=MagicMock(),
            request=MagicMock(),
            db=AsyncMock(),
            current_user_sub=uuid4(),
        )

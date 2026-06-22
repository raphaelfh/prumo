"""Unit tests for the new HITL Phase 2 run endpoints + lifecycle guards.

These call the endpoint coroutines directly (with mocked collaborators) so
every branch — including the role gates, the kind-aware consensus gate, and
the approve-finalize error mappings — is covered. The integration tests in
``test_extraction_runs_ready_api.py`` exercise real behaviour through the ASGI
transport, but httpx's in-process transport does not register line coverage on
the handler bodies (same reason ``test_article_files_unit.py`` exists), so the
branch coverage has to come from direct calls.
"""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.deps.security import ensure_project_arbitrator
from app.api.v1.endpoints.extraction_runs import (
    approve_and_finalize_run,
    create_consensus,
    get_run,
    get_run_view,
    mark_run_ready,
)
from app.models.extraction_workflow import ExtractionReviewerReady
from app.schemas.extraction_run import CreateConsensusRequest, MarkReadyRequest
from app.services.coordinate_coherence import CoordinateMismatchError
from app.services.extraction_consensus_service import (
    InvalidConsensusError,
    OptimisticConcurrencyError,
)
from app.services.run_lifecycle_service import (
    InvalidStageTransitionError,
    RunLifecycleService,
)

_EP = "app.api.v1.endpoints.extraction_runs"


def _request() -> MagicMock:
    req = MagicMock()
    req.state.trace_id = "trace"
    return req


def _run_summary(*, kind: str = "extraction") -> MagicMock:
    """A stand-in for the RunSummaryResponse returned by the membership loader."""
    run = MagicMock()
    run.project_id = uuid4()
    run.kind = kind
    run.hitl_config_snapshot = {}
    return run


def _fake_run(*, kind: str = "extraction", stage: str = "finalized") -> SimpleNamespace:
    """A from_attributes-compatible object for RunSummaryResponse.model_validate."""
    now = datetime(2026, 1, 1, tzinfo=UTC)
    return SimpleNamespace(
        id=uuid4(),
        project_id=uuid4(),
        article_id=uuid4(),
        template_id=uuid4(),
        kind=kind,
        version_id=uuid4(),
        stage=stage,
        status="completed",
        hitl_config_snapshot={},
        parameters={},
        results={},
        created_at=now,
        created_by=uuid4(),
    )


# --------------------------------------------------------------------------
# POST /runs/{id}/ready — mark_run_ready
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mark_ready_endpoint_returns_hint() -> None:
    summary = {"ready_count": 2, "reviewer_count": 3, "reviewers_ready": [uuid4()]}
    db = AsyncMock()
    with (
        patch(f"{_EP}._load_run_and_check_member", AsyncMock(return_value=_run_summary())),
        patch(f"{_EP}.ensure_project_reviewer", AsyncMock()) as gate,
        patch(f"{_EP}.ExtractionReviewerReadyService") as svc,
    ):
        svc.return_value.mark_ready = AsyncMock()
        svc.return_value.ready_summary_from = AsyncMock(return_value=summary)
        resp = await mark_run_ready(
            run_id=uuid4(),
            body=MarkReadyRequest(ready=True),
            request=_request(),
            db=db,
            current_user_sub=uuid4(),
        )
    assert resp.ok is True
    assert resp.data.ready_count == 2
    assert resp.data.reviewer_count == 3
    gate.assert_awaited_once()
    svc.return_value.mark_ready.assert_awaited_once()
    db.commit.assert_awaited_once()


# --------------------------------------------------------------------------
# POST /runs/{id}/approve-finalize — approve_and_finalize_run
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_approve_finalize_endpoint_success_returns_count() -> None:
    db = AsyncMock()
    with (
        patch(f"{_EP}._load_run_and_check_member", AsyncMock(return_value=_run_summary())),
        patch(f"{_EP}.ensure_project_arbitrator", AsyncMock()) as gate,
        patch(f"{_EP}.RunLifecycleService") as svc,
    ):
        svc.return_value.approve_and_finalize = AsyncMock(return_value=(_fake_run(), 4))
        resp = await approve_and_finalize_run(
            run_id=uuid4(), request=_request(), db=db, current_user_sub=uuid4()
        )
    assert resp.ok is True
    assert resp.data.published_count == 4
    assert resp.data.run.stage == "finalized"
    gate.assert_awaited_once()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("exc", "expected_status"),
    [
        (CoordinateMismatchError("x"), 422),
        (InvalidConsensusError("x"), 400),
        (OptimisticConcurrencyError("x"), 409),
        (InvalidStageTransitionError("x"), 400),
        (ValueError("missing"), 404),
    ],
)
async def test_approve_finalize_endpoint_maps_errors(exc: Exception, expected_status: int) -> None:
    with (
        patch(f"{_EP}._load_run_and_check_member", AsyncMock(return_value=_run_summary())),
        patch(f"{_EP}.ensure_project_arbitrator", AsyncMock()),
        patch(f"{_EP}.RunLifecycleService") as svc,
    ):
        svc.return_value.approve_and_finalize = AsyncMock(side_effect=exc)
        with pytest.raises(HTTPException) as raised:
            await approve_and_finalize_run(
                run_id=uuid4(), request=_request(), db=AsyncMock(), current_user_sub=uuid4()
            )
    assert raised.value.status_code == expected_status


# --------------------------------------------------------------------------
# POST /runs/{id}/consensus — kind-aware gate
# --------------------------------------------------------------------------


def _consensus_body() -> CreateConsensusRequest:
    return CreateConsensusRequest(
        instance_id=uuid4(),
        field_id=uuid4(),
        mode="select_existing",
        selected_decision_id=uuid4(),
    )


@pytest.mark.asyncio
async def test_consensus_extraction_requires_arbitrator() -> None:
    """extraction runs gate the consensus publish behind the arbitrator role."""
    with (
        patch(
            f"{_EP}._load_run_and_check_member",
            AsyncMock(return_value=_run_summary(kind="extraction")),
        ),
        patch(f"{_EP}.ensure_project_arbitrator", AsyncMock()) as arb,
        patch(f"{_EP}.ensure_project_reviewer", AsyncMock()) as rev,
        patch(f"{_EP}.ExtractionConsensusService") as svc,
    ):
        svc.return_value.record_consensus = AsyncMock(side_effect=InvalidConsensusError("stop"))
        with pytest.raises(HTTPException) as raised:
            await create_consensus(
                run_id=uuid4(),
                body=_consensus_body(),
                request=_request(),
                db=AsyncMock(),
                current_user_sub=uuid4(),
            )
    assert raised.value.status_code == 400
    arb.assert_awaited_once()
    rev.assert_not_called()


@pytest.mark.asyncio
async def test_consensus_quality_assessment_requires_reviewer() -> None:
    """QA "publish assessment" stays at reviewer level (single-reviewer self-publish)."""
    with (
        patch(
            f"{_EP}._load_run_and_check_member",
            AsyncMock(return_value=_run_summary(kind="quality_assessment")),
        ),
        patch(f"{_EP}.ensure_project_arbitrator", AsyncMock()) as arb,
        patch(f"{_EP}.ensure_project_reviewer", AsyncMock()) as rev,
        patch(f"{_EP}.ExtractionConsensusService") as svc,
    ):
        svc.return_value.record_consensus = AsyncMock(side_effect=InvalidConsensusError("stop"))
        with pytest.raises(HTTPException) as raised:
            await create_consensus(
                run_id=uuid4(),
                body=_consensus_body(),
                request=_request(),
                db=AsyncMock(),
                current_user_sub=uuid4(),
            )
    assert raised.value.status_code == 400
    rev.assert_awaited_once()
    arb.assert_not_called()


# --------------------------------------------------------------------------
# GET /runs/{id} and /runs/{id}/view — arbitrator-aware read paths
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_run_resolves_arbitrator_flag() -> None:
    detail = MagicMock()
    with (
        patch(f"{_EP}._load_run_and_check_member", AsyncMock(return_value=_run_summary())),
        patch(f"{_EP}.caller_can_see_peers", AsyncMock(return_value=False)),
        patch(f"{_EP}.is_run_arbitrator", AsyncMock(return_value=True)) as is_arb,
        patch(f"{_EP}.get_run_with_workflow_history", AsyncMock(return_value=detail)) as history,
    ):
        resp = await get_run(
            run_id=uuid4(), request=_request(), db=AsyncMock(), current_user_sub=uuid4()
        )
    assert resp.ok is True
    is_arb.assert_awaited_once()
    assert history.await_args.kwargs["caller_is_arbitrator"] is True


@pytest.mark.asyncio
async def test_get_run_view_resolves_arbitrator_flag() -> None:
    view = MagicMock()
    with (
        patch(f"{_EP}._load_run_and_check_member", AsyncMock(return_value=_run_summary())),
        patch(f"{_EP}.caller_can_see_peers", AsyncMock(return_value=True)),
        patch(f"{_EP}.is_run_arbitrator", AsyncMock(return_value=False)) as is_arb,
        patch(f"{_EP}.build_run_view", AsyncMock(return_value=view)) as build,
    ):
        resp = await get_run_view(
            run_id=uuid4(), request=_request(), db=AsyncMock(), current_user_sub=uuid4()
        )
    assert resp.ok is True
    is_arb.assert_awaited_once()
    assert build.await_args.kwargs["caller_is_arbitrator"] is False


# --------------------------------------------------------------------------
# RunLifecycleService.approve_and_finalize — pre-flight guards
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_approve_finalize_service_raises_when_run_missing() -> None:
    svc = RunLifecycleService(AsyncMock())
    with (
        patch(
            "app.services.run_lifecycle_service.load_run_for_update", AsyncMock(return_value=None)
        ),
        pytest.raises(ValueError, match="not found"),
    ):
        await svc.approve_and_finalize(run_id=uuid4(), user_id=uuid4())


@pytest.mark.asyncio
async def test_approve_finalize_service_rejects_non_extraction_run() -> None:
    svc = RunLifecycleService(AsyncMock())
    qa_run = MagicMock(kind="quality_assessment")
    with (
        patch(
            "app.services.run_lifecycle_service.load_run_for_update",
            AsyncMock(return_value=qa_run),
        ),
        pytest.raises(InvalidStageTransitionError, match="extraction runs only"),
    ):
        await svc.approve_and_finalize(run_id=uuid4(), user_id=uuid4())


# --------------------------------------------------------------------------
# Model repr
# --------------------------------------------------------------------------


def test_reviewer_ready_repr() -> None:
    row = ExtractionReviewerReady(run_id=uuid4(), reviewer_id=uuid4(), is_ready=True)
    text = repr(row)
    assert "ExtractionReviewerReady" in text
    assert "ready=True" in text


# --------------------------------------------------------------------------
# Role gate — 403 reject branch (shared _ensure_project_role)
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_project_role_gate_403_when_not_allowed() -> None:
    """The service-role session bypasses RLS, so the gate must 403 itself when the
    ``is_project_*`` boolean comes back false."""
    db = AsyncMock()
    db.execute.return_value = MagicMock(scalar_one=MagicMock(return_value=False))
    with pytest.raises(HTTPException) as raised:
        await ensure_project_arbitrator(db, uuid4(), uuid4())
    assert raised.value.status_code == 403


@pytest.mark.asyncio
async def test_project_role_gate_passes_when_allowed() -> None:
    db = AsyncMock()
    db.execute.return_value = MagicMock(scalar_one=MagicMock(return_value=True))
    await ensure_project_arbitrator(db, uuid4(), uuid4())  # no raise

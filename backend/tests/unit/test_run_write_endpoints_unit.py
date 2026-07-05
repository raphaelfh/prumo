"""Direct endpoint-coroutine unit tests for the run write endpoints' reviewer
role gate (PR1 of the 2026-07-04 consensus-AI-trace spec).

The integration coverage (test_decision_link_guard) exercises these through
the ASGI transport, whose handler lines do not register on coverage (the 80%
diff-cover gate's blind spot). These call the coroutines directly so the
``ensure_project_reviewer`` gate lines are covered — mirrors
test_form_runs_endpoint_unit.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints.extraction_runs import create_decision, create_proposal
from app.schemas.extraction_run import CreateDecisionRequest, CreateProposalRequest

_EP = "app.api.v1.endpoints.extraction_runs"


def _run(project_id):
    return SimpleNamespace(project_id=project_id)


@pytest.mark.asyncio
async def test_create_decision_awaits_reviewer_role_gate() -> None:
    run_id, project_id, caller = uuid4(), uuid4(), uuid4()
    record = SimpleNamespace(
        id=uuid4(),
        run_id=run_id,
        instance_id=uuid4(),
        field_id=uuid4(),
        reviewer_id=caller,
        decision="edit",
        proposal_record_id=None,
        value={"value": "x"},
        rationale=None,
        created_at="2026-07-05T00:00:00Z",
    )
    body = CreateDecisionRequest(
        instance_id=record.instance_id,
        field_id=record.field_id,
        decision="edit",
        value={"value": "x"},
    )
    service = MagicMock()
    service.record_decision = AsyncMock(return_value=record)

    with (
        patch(f"{_EP}._load_run_and_check_member", AsyncMock(return_value=_run(project_id))),
        patch(f"{_EP}.ensure_project_reviewer", AsyncMock()) as gate,
        patch(f"{_EP}.ExtractionReviewService", return_value=service),
        patch(f"{_EP}._trace", return_value=None),
    ):
        db = AsyncMock()
        resp = await create_decision(
            run_id=run_id, body=body, request=MagicMock(), db=db, current_user_sub=caller
        )

    gate.assert_awaited_once_with(db, project_id, caller)
    assert resp.ok is True


@pytest.mark.asyncio
async def test_create_proposal_awaits_reviewer_role_gate() -> None:
    run_id, project_id, caller = uuid4(), uuid4(), uuid4()
    record = SimpleNamespace(
        id=uuid4(),
        run_id=run_id,
        instance_id=uuid4(),
        field_id=uuid4(),
        source="human",
        source_user_id=caller,
        proposed_value={"value": "x"},
        confidence_score=None,
        rationale=None,
        created_at="2026-07-05T00:00:00Z",
    )
    body = CreateProposalRequest(
        instance_id=record.instance_id,
        field_id=record.field_id,
        source="human",
        proposed_value={"value": "x"},
    )
    service = MagicMock()
    service.record_proposal = AsyncMock(return_value=record)

    with (
        patch(f"{_EP}._load_run_and_check_member", AsyncMock(return_value=_run(project_id))),
        patch(f"{_EP}.ensure_project_reviewer", AsyncMock()) as gate,
        patch(f"{_EP}.ExtractionProposalService", return_value=service),
        patch(f"{_EP}._trace", return_value=None),
    ):
        db = AsyncMock()
        resp = await create_proposal(
            run_id=run_id, body=body, request=MagicMock(), db=db, current_user_sub=caller
        )

    gate.assert_awaited_once_with(db, project_id, caller)
    assert resp.ok is True


@pytest.mark.asyncio
async def test_create_proposal_rejects_forged_human_source_user_id() -> None:
    """D8-c guard: a human proposal whose body.source_user_id differs from the
    authenticated caller 400s BEFORE the service runs (materialization turns
    that column into decision attribution)."""
    from fastapi import HTTPException

    run_id, project_id, caller = uuid4(), uuid4(), uuid4()
    body = CreateProposalRequest(
        instance_id=uuid4(),
        field_id=uuid4(),
        source="human",
        source_user_id=uuid4(),  # != caller
        proposed_value={"value": "forged"},
    )
    service = MagicMock()
    service.record_proposal = AsyncMock()

    with (
        patch(f"{_EP}._load_run_and_check_member", AsyncMock(return_value=_run(project_id))),
        patch(f"{_EP}.ensure_project_reviewer", AsyncMock()),
        patch(f"{_EP}.ExtractionProposalService", return_value=service),
        patch(f"{_EP}._trace", return_value=None),
        pytest.raises(HTTPException) as exc,
    ):
        await create_proposal(
            run_id=run_id,
            body=body,
            request=MagicMock(),
            db=AsyncMock(),
            current_user_sub=caller,
        )

    assert exc.value.status_code == 400
    service.record_proposal.assert_not_awaited()


@pytest.mark.asyncio
async def test_advance_run_awaits_reviewer_role_gate() -> None:
    """/advance is reviewer-role-gated (viewers 403) — D8-c materialization
    writes decision rows on QA advances, so membership alone is not enough."""
    from types import SimpleNamespace as NS

    from app.api.v1.endpoints.extraction_runs import advance_run
    from app.schemas.extraction_run import AdvanceStageRequest

    run_id, project_id, caller = uuid4(), uuid4(), uuid4()
    advanced = NS(
        id=run_id,
        project_id=project_id,
        article_id=uuid4(),
        template_id=uuid4(),
        kind="quality_assessment",
        version_id=uuid4(),
        stage="consensus",
        status="running",
        hitl_config_snapshot={},
        parameters={},
        results={},
        created_at="2026-07-05T00:00:00Z",
        created_by=caller,
    )
    service = MagicMock()
    service.advance_stage = AsyncMock(return_value=advanced)

    with (
        patch(f"{_EP}._load_run_and_check_member", AsyncMock(return_value=_run(project_id))),
        patch(f"{_EP}.ensure_project_reviewer", AsyncMock()) as gate,
        patch(f"{_EP}.RunLifecycleService", return_value=service),
        patch(f"{_EP}._trace", return_value=None),
    ):
        db = AsyncMock()
        request = MagicMock()
        request.state.trace_id = None  # advance_run reads request.state directly
        resp = await advance_run(
            run_id=run_id,
            body=AdvanceStageRequest(target_stage="consensus"),
            request=request,
            db=db,
            current_user_sub=caller,
        )

    gate.assert_awaited_once_with(db, project_id, caller)
    assert resp.ok is True

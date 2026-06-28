"""Unit tests for the async section extraction endpoint.

Locks in:
- POST /extraction/sections returns 202 + job_id and calls .delay with
  the right arguments (payload.model_dump(mode="json"), user.sub, trace_id).
- Queue unavailable → 503.
- GET /extraction/sections/status/{job_id} maps every Celery state to the
  correct status string and result/error shape.
- BOLA: a non-owner cannot read another user's job status.

Uses httpx ASGITransport — same pattern as test_extraction_export_endpoint.py.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import section_extraction as se
from app.core.deps import get_db, get_supabase
from app.core.security import TokenPayload, get_current_user
from app.main import app
from app.schemas.extraction import SectionExtractionRequest

CALLER_USER_ID = str(uuid4())
OTHER_USER_ID = str(uuid4())

_PROJECT_ID = str(uuid4())
_ARTICLE_ID = str(uuid4())
_TEMPLATE_ID = str(uuid4())
_ENTITY_TYPE_ID = str(uuid4())

_DISPATCH_URL = "/api/v1/extraction/sections"


def _status_url(job_id: str) -> str:
    return f"/api/v1/extraction/sections/status/{job_id}"


# ---------------------------------------------------------------------------
# Shared fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        mock_session = AsyncMock(spec=AsyncSession)
        yield mock_session

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=CALLER_USER_ID,
            email="caller@example.com",
            role="authenticated",
            aal="aal1",
        )

    def override_get_supabase() -> MagicMock:
        return MagicMock()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_supabase] = override_get_supabase

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Minimal valid single-section payload
# ---------------------------------------------------------------------------

_SINGLE_PAYLOAD = {
    "projectId": _PROJECT_ID,
    "articleId": _ARTICLE_ID,
    "templateId": _TEMPLATE_ID,
    "entityTypeId": _ENTITY_TYPE_ID,
}


# ======================================================================
# POST /extraction/sections — dispatch tests
# ======================================================================


class TestExtractSectionDispatch:
    @pytest.mark.asyncio
    async def test_returns_202_and_job_id(self, client: AsyncClient) -> None:
        """Happy path: queue available, membership passes → 202 + job_id."""
        job_id = str(uuid4())
        mock_task = MagicMock()
        mock_task.id = job_id

        with (
            patch(
                "app.api.v1.endpoints.section_extraction._is_queue_available",
                return_value=True,
            ),
            patch(
                "app.api.v1.endpoints.section_extraction._check_request_scope",
                new=AsyncMock(),
            ),
            patch(
                "app.api.v1.endpoints.section_extraction.run_section_extraction_task.delay",
                return_value=mock_task,
            ) as mock_delay,
            patch(
                "app.api.v1.endpoints.section_extraction._remember_job_owner",
            ),
        ):
            res = await client.post(_DISPATCH_URL, json=_SINGLE_PAYLOAD)

        assert res.status_code == 202, res.text
        body = res.json()
        assert body["ok"] is True
        # POST response goes through JSONResponse(model_dump()) — no by_alias, so snake_case
        assert body["data"]["job_id"] == job_id

        # Verify .delay was called with the correct positional args
        args = mock_delay.call_args[0]
        payload_arg, user_id_arg = args[0], args[1]
        assert user_id_arg == CALLER_USER_ID
        # model_dump(mode="json") produces snake_case keys from field names
        assert payload_arg["project_id"] == _PROJECT_ID
        assert payload_arg["article_id"] == _ARTICLE_ID
        assert payload_arg["template_id"] == _TEMPLATE_ID
        assert payload_arg["entity_type_id"] == _ENTITY_TYPE_ID

    @pytest.mark.asyncio
    async def test_delay_called_with_snake_case_keys(self, client: AsyncClient) -> None:
        """model_dump(mode='json') must produce snake_case keys (not camelCase aliases),
        because the B1 task calls SectionExtractionRequest(**payload_json) which
        accepts both via populate_by_name=True but snake_case is the field name."""
        job_id = str(uuid4())
        mock_task = MagicMock()
        mock_task.id = job_id

        captured: list[dict] = []

        def capture_delay(payload_dict, user_id, trace_id):  # noqa: ANN001, ARG001
            captured.append(payload_dict)
            return mock_task

        with (
            patch(
                "app.api.v1.endpoints.section_extraction._is_queue_available",
                return_value=True,
            ),
            patch(
                "app.api.v1.endpoints.section_extraction._check_request_scope",
                new=AsyncMock(),
            ),
            patch(
                "app.api.v1.endpoints.section_extraction.run_section_extraction_task.delay",
                side_effect=capture_delay,
            ),
            patch("app.api.v1.endpoints.section_extraction._remember_job_owner"),
        ):
            await client.post(_DISPATCH_URL, json=_SINGLE_PAYLOAD)

        assert len(captured) == 1
        dumped = captured[0]
        # snake_case keys, not camelCase
        assert "project_id" in dumped
        assert "projectId" not in dumped
        assert "entity_type_id" in dumped
        assert "entityTypeId" not in dumped

    @pytest.mark.asyncio
    async def test_queue_unavailable_returns_503(self, client: AsyncClient) -> None:
        """Redis ping fails → 503 before dispatching."""
        with (
            patch(
                "app.api.v1.endpoints.section_extraction._is_queue_available",
                return_value=False,
            ),
            patch(
                "app.api.v1.endpoints.section_extraction._check_request_scope",
                new=AsyncMock(),
            ),
        ):
            res = await client.post(_DISPATCH_URL, json=_SINGLE_PAYLOAD)

        assert res.status_code == 503, res.text
        body = res.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "SERVICE_UNAVAILABLE"

    @pytest.mark.asyncio
    async def test_owner_is_stored_in_redis(self, client: AsyncClient) -> None:
        """After dispatch, the job owner must be persisted to Redis."""
        job_id = str(uuid4())
        mock_task = MagicMock()
        mock_task.id = job_id
        remembered: list[tuple[str, str]] = []

        with (
            patch(
                "app.api.v1.endpoints.section_extraction._is_queue_available",
                return_value=True,
            ),
            patch(
                "app.api.v1.endpoints.section_extraction._check_request_scope",
                new=AsyncMock(),
            ),
            patch(
                "app.api.v1.endpoints.section_extraction.run_section_extraction_task.delay",
                return_value=mock_task,
            ),
            patch(
                "app.api.v1.endpoints.section_extraction._remember_job_owner",
                side_effect=lambda jid, uid: remembered.append((jid, uid)),
            ),
        ):
            await client.post(_DISPATCH_URL, json=_SINGLE_PAYLOAD)

        assert remembered == [(job_id, CALLER_USER_ID)]


# ======================================================================
# GET /extraction/sections/status/{job_id} — state mapping tests
# ======================================================================


class TestGetSectionExtractionStatus:
    @pytest.mark.asyncio
    async def test_unknown_job_returns_not_found(self, client: AsyncClient) -> None:
        """No Redis owner, no Celery result → NOT_FOUND envelope."""
        mock_result = MagicMock()
        mock_result.state = "PENDING"
        mock_result.result = None

        with (
            patch("celery.result.AsyncResult", return_value=mock_result),
            patch(
                "app.api.v1.endpoints.section_extraction._lookup_job_owner",
                return_value=None,
            ),
        ):
            res = await client.get(_status_url(str(uuid4())))

        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "NOT_FOUND"

    @pytest.mark.asyncio
    async def test_other_users_job_returns_forbidden(self, client: AsyncClient) -> None:
        """BOLA: another user's job must not leak state to the caller."""
        mock_result = MagicMock()
        mock_result.state = "PENDING"
        mock_result.result = None

        with (
            patch("celery.result.AsyncResult", return_value=mock_result),
            patch(
                "app.api.v1.endpoints.section_extraction._lookup_job_owner",
                return_value=OTHER_USER_ID,
            ),
        ):
            res = await client.get(_status_url(str(uuid4())))

        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "FORBIDDEN"

    @pytest.mark.asyncio
    async def test_failed_job_does_not_leak_error_to_other_user(self, client: AsyncClient) -> None:
        """BOLA regression: FAILURE leaks exc repr — gate must fire first."""
        mock_result = MagicMock()
        mock_result.state = "FAILURE"
        mock_result.result = RuntimeError("internal/path/should/not/leak: db row 99")

        with (
            patch("celery.result.AsyncResult", return_value=mock_result),
            patch(
                "app.api.v1.endpoints.section_extraction._lookup_job_owner",
                return_value=OTHER_USER_ID,
            ),
        ):
            res = await client.get(_status_url(str(uuid4())))

        body = res.json()
        assert body["ok"] is False
        assert body["error"]["code"] == "FORBIDDEN"
        assert "internal/path/should/not/leak" not in res.text

    @pytest.mark.asyncio
    async def test_own_pending_job_returns_pending(self, client: AsyncClient) -> None:
        mock_result = MagicMock()
        mock_result.state = "PENDING"
        mock_result.result = None

        with (
            patch("celery.result.AsyncResult", return_value=mock_result),
            patch(
                "app.api.v1.endpoints.section_extraction._lookup_job_owner",
                return_value=CALLER_USER_ID,
            ),
        ):
            res = await client.get(_status_url(str(uuid4())))

        assert res.status_code == 200, res.text
        body = res.json()
        assert body["ok"] is True
        assert body["data"]["status"] == "pending"

    @pytest.mark.asyncio
    async def test_started_state_returns_running(self, client: AsyncClient) -> None:
        mock_result = MagicMock()
        mock_result.state = "STARTED"
        mock_result.result = None

        with (
            patch("celery.result.AsyncResult", return_value=mock_result),
            patch(
                "app.api.v1.endpoints.section_extraction._lookup_job_owner",
                return_value=CALLER_USER_ID,
            ),
        ):
            res = await client.get(_status_url(str(uuid4())))

        body = res.json()
        assert body["ok"] is True
        assert body["data"]["status"] == "running"

    @pytest.mark.asyncio
    async def test_retry_state_returns_running(self, client: AsyncClient) -> None:
        mock_result = MagicMock()
        mock_result.state = "RETRY"
        mock_result.result = None

        with (
            patch("celery.result.AsyncResult", return_value=mock_result),
            patch(
                "app.api.v1.endpoints.section_extraction._lookup_job_owner",
                return_value=CALLER_USER_ID,
            ),
        ):
            res = await client.get(_status_url(str(uuid4())))

        body = res.json()
        assert body["ok"] is True
        assert body["data"]["status"] == "running"

    @pytest.mark.asyncio
    async def test_revoked_state_returns_cancelled(self, client: AsyncClient) -> None:
        mock_result = MagicMock()
        mock_result.state = "REVOKED"
        mock_result.result = None

        with (
            patch("celery.result.AsyncResult", return_value=mock_result),
            patch(
                "app.api.v1.endpoints.section_extraction._lookup_job_owner",
                return_value=CALLER_USER_ID,
            ),
        ):
            res = await client.get(_status_url(str(uuid4())))

        body = res.json()
        assert body["ok"] is True
        assert body["data"]["status"] == "cancelled"

    @pytest.mark.asyncio
    async def test_failure_state_returns_failed_with_error(self, client: AsyncClient) -> None:
        mock_result = MagicMock()
        mock_result.state = "FAILURE"
        mock_result.result = RuntimeError("llm timed out")

        with (
            patch("celery.result.AsyncResult", return_value=mock_result),
            patch(
                "app.api.v1.endpoints.section_extraction._lookup_job_owner",
                return_value=CALLER_USER_ID,
            ),
        ):
            res = await client.get(_status_url(str(uuid4())))

        body = res.json()
        assert body["ok"] is True
        assert body["data"]["status"] == "failed"
        assert "llm timed out" in body["data"]["error"]

    @pytest.mark.asyncio
    async def test_success_single_result_parsed(self, client: AsyncClient) -> None:
        """SUCCESS branch: single-mode dict → ExtractionJobResult with suggestionsCreated."""
        run_id = str(uuid4())
        entity_type_id = str(uuid4())
        mock_result = MagicMock()
        mock_result.state = "SUCCESS"
        mock_result.result = {
            "mode": "single",
            "extraction_run_id": run_id,
            "suggestions_created": 7,
            "entity_type_id": entity_type_id,
        }

        with (
            patch("celery.result.AsyncResult", return_value=mock_result),
            patch(
                "app.api.v1.endpoints.section_extraction._lookup_job_owner",
                return_value=CALLER_USER_ID,
            ),
        ):
            res = await client.get(_status_url(str(uuid4())))

        body = res.json()
        assert body["ok"] is True
        data = body["data"]
        assert data["status"] == "completed"
        result = data["result"]
        assert result["mode"] == "single"
        assert result["extractionRunId"] == run_id
        assert result["suggestionsCreated"] == 7
        assert result["entityTypeId"] == entity_type_id
        assert result["totalSections"] is None
        assert result["sections"] is None

    @pytest.mark.asyncio
    async def test_success_batch_result_parsed(self, client: AsyncClient) -> None:
        """SUCCESS branch: batch-mode dict → ExtractionJobResult with batch fields."""
        run_id = str(uuid4())
        mock_result = MagicMock()
        mock_result.state = "SUCCESS"
        mock_result.result = {
            "mode": "batch",
            "extraction_run_id": run_id,
            "total_sections": 4,
            "successful_sections": 3,
            "failed_sections": 1,
            "total_suggestions_created": 12,
        }

        with (
            patch("celery.result.AsyncResult", return_value=mock_result),
            patch(
                "app.api.v1.endpoints.section_extraction._lookup_job_owner",
                return_value=CALLER_USER_ID,
            ),
        ):
            res = await client.get(_status_url(str(uuid4())))

        body = res.json()
        assert body["ok"] is True
        data = body["data"]
        assert data["status"] == "completed"
        result = data["result"]
        assert result["mode"] == "batch"
        assert result["extractionRunId"] == run_id
        assert result["totalSections"] == 4
        assert result["successfulSections"] == 3
        assert result["failedSections"] == 1
        assert result["totalSuggestionsCreated"] == 12
        assert result["suggestionsCreated"] is None
        assert result["entityTypeId"] is None

    @pytest.mark.asyncio
    async def test_success_batch_with_sections_round_trips(self, client: AsyncClient) -> None:
        """SUCCESS batch: per-section outcomes in the task dict → sections in result."""
        run_id = str(uuid4())
        entity_type_id_a = str(uuid4())
        entity_type_id_b = str(uuid4())
        mock_result = MagicMock()
        mock_result.state = "SUCCESS"
        mock_result.result = {
            "mode": "batch",
            "extraction_run_id": run_id,
            "total_sections": 2,
            "successful_sections": 1,
            "failed_sections": 1,
            "total_suggestions_created": 3,
            "sections": [
                {
                    "entity_type_id": entity_type_id_a,
                    "entity_type_name": "Outcome",
                    "success": True,
                    "suggestions_created": 3,
                    "tokens_used": 150,
                    "skipped": False,
                    "error": None,
                },
                {
                    "entity_type_id": entity_type_id_b,
                    "entity_type_name": "Population",
                    "success": False,
                    "suggestions_created": 0,
                    "tokens_used": 0,
                    "skipped": False,
                    "error": "llm_timeout",
                },
            ],
        }

        with (
            patch("celery.result.AsyncResult", return_value=mock_result),
            patch(
                "app.api.v1.endpoints.section_extraction._lookup_job_owner",
                return_value=CALLER_USER_ID,
            ),
        ):
            res = await client.get(_status_url(str(uuid4())))

        body = res.json()
        assert body["ok"] is True
        result = body["data"]["result"]
        assert result["mode"] == "batch"
        sections = result["sections"]
        assert sections is not None
        assert len(sections) == 2
        assert sections[0]["entity_type_id"] == entity_type_id_a
        assert sections[0]["success"] is True
        assert sections[0]["suggestions_created"] == 3
        assert sections[1]["entity_type_id"] == entity_type_id_b
        assert sections[1]["success"] is False
        assert sections[1]["error"] == "llm_timeout"

    @pytest.mark.asyncio
    async def test_success_ttl_expired_fallback_via_user_id_in_result(
        self, client: AsyncClient
    ) -> None:
        """When Redis TTL has expired but result is still cached, user_id in
        the result dict is used as the fallback owner check."""
        run_id = str(uuid4())
        mock_result = MagicMock()
        mock_result.state = "SUCCESS"
        mock_result.result = {
            "mode": "single",
            "extraction_run_id": run_id,
            "suggestions_created": 3,
            "user_id": CALLER_USER_ID,  # fallback field
        }

        with (
            patch("celery.result.AsyncResult", return_value=mock_result),
            patch(
                "app.api.v1.endpoints.section_extraction._lookup_job_owner",
                return_value=None,  # Redis TTL expired
            ),
        ):
            res = await client.get(_status_url(str(uuid4())))

        body = res.json()
        assert body["ok"] is True
        assert body["data"]["status"] == "completed"


# ======================================================================
# Module helpers — direct unit coverage (Redis helpers + BOLA scope).
# All endpoint tests patch these out, so cover their bodies directly.
# ======================================================================


class TestQueueAndOwnerHelpers:
    def test_is_queue_available_true_when_ping_ok(self) -> None:
        with patch("app.api.v1.endpoints.section_extraction.Redis") as redis_cls:
            redis_cls.from_url.return_value.ping.return_value = True
            assert se._is_queue_available() is True

    def test_is_queue_available_false_when_ping_raises(self) -> None:
        with patch("app.api.v1.endpoints.section_extraction.Redis") as redis_cls:
            redis_cls.from_url.return_value.ping.side_effect = Exception("down")
            assert se._is_queue_available() is False

    def test_remember_job_owner_sets_key_with_ttl(self) -> None:
        with patch("app.api.v1.endpoints.section_extraction.Redis") as redis_cls:
            client = redis_cls.from_url.return_value
            se._remember_job_owner("job-1", "user-1")
            client.set.assert_called_once()
            args, kwargs = client.set.call_args
            assert "job-1" in args[0] and args[1] == "user-1"
            assert kwargs["ex"] == se._SECTION_JOB_OWNER_TTL_SECONDS

    def test_remember_job_owner_swallows_redis_error(self) -> None:
        with patch("app.api.v1.endpoints.section_extraction.Redis") as redis_cls:
            redis_cls.from_url.side_effect = Exception("down")
            se._remember_job_owner("job-1", "user-1")  # must not raise

    def test_lookup_job_owner_decodes_bytes(self) -> None:
        with patch("app.api.v1.endpoints.section_extraction.Redis") as redis_cls:
            redis_cls.from_url.return_value.get.return_value = b"user-1"
            assert se._lookup_job_owner("job-1") == "user-1"

    def test_lookup_job_owner_returns_none_when_absent(self) -> None:
        with patch("app.api.v1.endpoints.section_extraction.Redis") as redis_cls:
            redis_cls.from_url.return_value.get.return_value = None
            assert se._lookup_job_owner("job-1") is None

    def test_lookup_job_owner_returns_none_on_redis_error(self) -> None:
        with patch("app.api.v1.endpoints.section_extraction.Redis") as redis_cls:
            redis_cls.from_url.side_effect = Exception("down")
            assert se._lookup_job_owner("job-1") is None


class TestCheckRequestScope:
    def _payload(self, **over: object) -> SectionExtractionRequest:
        base = {
            "projectId": str(uuid4()),
            "articleId": str(uuid4()),
            "templateId": str(uuid4()),
            "entityTypeId": str(uuid4()),
        }
        base.update(over)  # type: ignore[arg-type]
        return SectionExtractionRequest(**base)  # type: ignore[arg-type]

    @pytest.mark.asyncio
    async def test_no_run_id_checks_project_membership(self) -> None:
        payload = self._payload()
        with patch(
            "app.api.v1.endpoints.section_extraction.ensure_project_member",
            new=AsyncMock(),
        ) as guard:
            await se._check_request_scope(MagicMock(), payload, uuid4())
        guard.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_run_not_found_raises_404(self) -> None:
        from app.services.extraction_run_read_service import RunNotFoundError

        payload = self._payload(runId=str(uuid4()), entityTypeId=None)
        with (
            patch(
                "app.api.v1.endpoints.section_extraction.get_run_or_raise",
                new=AsyncMock(side_effect=RunNotFoundError("nope")),
            ),
            pytest.raises(HTTPException) as exc,
        ):
            await se._check_request_scope(MagicMock(), payload, uuid4())
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_run_mismatch_raises_400(self) -> None:
        payload = self._payload(runId=str(uuid4()), entityTypeId=None)
        run = SimpleNamespace(project_id=uuid4(), article_id=uuid4(), template_id=uuid4())
        with (
            patch(
                "app.api.v1.endpoints.section_extraction.get_run_or_raise",
                new=AsyncMock(return_value=run),
            ),
            patch(
                "app.api.v1.endpoints.section_extraction.ensure_project_member",
                new=AsyncMock(),
            ),
            pytest.raises(HTTPException) as exc,
        ):
            await se._check_request_scope(MagicMock(), payload, uuid4())
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_run_match_passes(self) -> None:
        pid, aid, tid = uuid4(), uuid4(), uuid4()
        payload = self._payload(
            projectId=str(pid),
            articleId=str(aid),
            templateId=str(tid),
            runId=str(uuid4()),
            entityTypeId=None,
        )
        run = SimpleNamespace(project_id=pid, article_id=aid, template_id=tid)
        with (
            patch(
                "app.api.v1.endpoints.section_extraction.get_run_or_raise",
                new=AsyncMock(return_value=run),
            ),
            patch(
                "app.api.v1.endpoints.section_extraction.ensure_project_member",
                new=AsyncMock(),
            ) as guard,
        ):
            await se._check_request_scope(MagicMock(), payload, uuid4())
        guard.assert_awaited_once()

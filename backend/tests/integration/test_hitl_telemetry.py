"""Telemetry contract for the HITL endpoints.

Each endpoint logs a structured event with `run_id` + `trace_id`
context. SRE greps for the event names listed below — do not rename
without updating dashboards / alerts.

Tests assert two things only:
  1. The "happy path" event fires when state actually transitions.
  2. The error path event fires (with the correct level + key fields)
     when the service raises a known business-rule exception.
"""

from collections.abc import AsyncGenerator
from uuid import UUID

import pytest
import pytest_asyncio
import structlog
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from structlog.testing import LogCapture

from app.core.security import TokenPayload, get_current_user
from app.main import app


@pytest_asyncio.fixture
async def auth_as_profile(
    db_session: AsyncSession,
) -> AsyncGenerator[UUID, None]:
    raw = (await db_session.execute(text("SELECT id FROM public.profiles LIMIT 1"))).scalar()
    if raw is None:
        pytest.skip("No profile rows available")
    profile_id = UUID(str(raw))

    async def override_get_current_user() -> TokenPayload:
        return TokenPayload(
            sub=str(profile_id),
            email="test@example.com",
            role="authenticated",
            aal="aal1",
        )

    app.dependency_overrides[get_current_user] = override_get_current_user
    yield profile_id


@pytest_asyncio.fixture
async def captured_logs() -> AsyncGenerator[LogCapture, None]:
    """Install a structlog LogCapture and yield it for assertion.

    Lives at fixture scope so each test has an empty capture buffer.
    """
    capture = LogCapture()
    structlog.configure(processors=[capture])
    yield capture
    structlog.reset_defaults()


async def _pick_template(db: AsyncSession) -> tuple[UUID, UUID, UUID] | None:
    row = (
        await db.execute(
            text(
                "SELECT p.id, a.id, t.id "
                "FROM public.projects p "
                "JOIN public.articles a ON a.project_id = p.id "
                "JOIN public.project_extraction_templates t ON t.project_id = p.id "
                "LIMIT 1"
            )
        )
    ).first()
    if row is None:
        return None
    return UUID(str(row[0])), UUID(str(row[1])), UUID(str(row[2]))


@pytest.mark.asyncio
async def test_create_run_logs_state_transition(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
    captured_logs: LogCapture,
) -> None:
    fx = await _pick_template(db_session)
    if fx is None:
        pytest.skip("Need projects + articles + project_template fixtures")
    project_id, article_id, template_id = fx

    res = await db_client.post(
        "/api/v1/runs",
        json={
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(template_id),
        },
    )
    assert res.status_code == 201, res.text

    events = [e["event"] for e in captured_logs.entries]
    assert "hitl_run_created" in events, events

    run_log = next(e for e in captured_logs.entries if e["event"] == "hitl_run_created")
    # Required context for SRE: the run we just made + its kind/stage.
    assert run_log["run_id"] == res.json()["data"]["id"]
    assert run_log["stage"] == "pending"


@pytest.mark.asyncio
async def test_invalid_stage_transition_logs_warning(
    db_client: AsyncClient,
    db_session: AsyncSession,
    auth_as_profile: UUID,  # noqa: ARG001
    captured_logs: LogCapture,
) -> None:
    fx = await _pick_template(db_session)
    if fx is None:
        pytest.skip("Need projects + articles + project_template fixtures")
    project_id, article_id, template_id = fx

    create = await db_client.post(
        "/api/v1/runs",
        json={
            "project_id": str(project_id),
            "article_id": str(article_id),
            "project_template_id": str(template_id),
        },
    )
    assert create.status_code == 201
    run_id = create.json()["data"]["id"]

    # Skipping a stage is rejected: pending → review without going through proposal.
    bad = await db_client.post(
        f"/api/v1/runs/{run_id}/advance",
        json={"target_stage": "review"},
    )
    assert bad.status_code == 400

    events = [e["event"] for e in captured_logs.entries]
    assert "hitl_stage_transition_rejected" in events, events
    rejected = next(
        e for e in captured_logs.entries if e["event"] == "hitl_stage_transition_rejected"
    )
    assert rejected["run_id"] == run_id
    assert rejected["target_stage"] == "review"
    # Warning level for client errors (operations folks filter on this).
    assert rejected["log_level"] == "warning"

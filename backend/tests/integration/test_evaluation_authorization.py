"""Integration tests for unauthorized access to evaluation endpoints."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_unauthorized_read_and_write_attempts_are_blocked() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        read_response = await client.get("/api/v1/review-queue")
        write_response = await client.post("/api/v1/reviewer-decisions", json={})

    assert read_response.status_code in (401, 403)
    assert write_response.status_code in (401, 403)

"""
Tests for health check and basic endpoints.
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient) -> None:
    """Test health check endpoint returns healthy status."""
    response = await client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data


@pytest.mark.asyncio
async def test_health_reports_the_deployed_commit(client: AsyncClient) -> None:
    """/health carries the commit the running build was deployed from.

    The post-deploy smoke asserts this against the promoted SHA — it is the
    only signal that catches the documented failure class where Railway
    sticks on an older commit while CI is green (a reachability probe alone
    cannot tell a stale build from a fresh one). Falls back to "unknown"
    outside Railway, which the smoke degrades to a warning.
    """
    response = await client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert "commit" in data
    assert isinstance(data["commit"], str)
    assert data["commit"]


@pytest.mark.asyncio
async def test_root_endpoint(client: AsyncClient) -> None:
    """Test root endpoint returns API info."""
    response = await client.get("/")

    assert response.status_code == 200
    data = response.json()
    assert "name" in data
    assert "version" in data
    assert "docs" in data


@pytest.mark.asyncio
async def test_openapi_schema_available(client: AsyncClient) -> None:
    """Test OpenAPI schema is accessible."""
    response = await client.get("/api/v1/openapi.json")

    assert response.status_code == 200
    data = response.json()
    assert "openapi" in data
    assert "paths" in data


@pytest.mark.asyncio
async def test_trace_id_header_present(client: AsyncClient) -> None:
    """Test that X-Trace-Id header is present in responses."""
    response = await client.get("/health")

    assert response.status_code == 200
    assert "x-trace-id" in response.headers


@pytest.mark.asyncio
async def test_response_time_header_present(client: AsyncClient) -> None:
    """Test that X-Response-Time header is present in responses."""
    response = await client.get("/health")

    assert response.status_code == 200
    assert "x-response-time" in response.headers

    # Deve ser um valor com "ms"
    time_str = response.headers["x-response-time"]
    assert "ms" in time_str

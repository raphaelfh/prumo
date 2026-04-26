"""Backend E2E smoke against a live FastAPI stack.

Skips when the configured ``E2E_API_URL`` is unreachable so the marker remains
runnable in environments without an external server while still exercising a
real network round-trip when one is available.
"""

import os

import httpx
import pytest


@pytest.mark.e2e
def test_health_endpoint_e2e_live_stack() -> None:
    api_url = os.environ.get("E2E_API_URL", "http://127.0.0.1:8000").rstrip("/")
    health_url = f"{api_url}/health"

    try:
        response = httpx.get(health_url, timeout=5.0)
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        pytest.skip(f"Live API not reachable at {health_url}: {exc}")

    assert response.status_code == 200, response.text

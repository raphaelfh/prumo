"""Minimal backend E2E marker smoke test."""

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.mark.e2e
def test_health_endpoint_e2e_marker() -> None:
    """Ensure pytest -m e2e always has at least one live test."""
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200

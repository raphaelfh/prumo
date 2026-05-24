"""Integration tests for extraction-export endpoints.

Foundation-phase coverage (T013):
    * The three routes are registered in the OpenAPI schema.

T033 / T052 / T063 add the per-mode behavioural cases.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


def test_extraction_export_routes_are_registered(client: TestClient) -> None:
    """Confirm the three contract paths appear in the live OpenAPI schema.

    Mirrors the contract file
    `specs/009-extraction-excel-export/contracts/extraction-export.openapi.yaml`.
    """
    resp = client.get("/api/v1/openapi.json")
    assert resp.status_code == 200
    paths = resp.json().get("paths", {})

    base = "/api/v1/projects/{project_id}/extraction-export"
    assert base in paths, f"missing endpoint: {base}"
    assert f"{base}/status/{{job_id}}" in paths, "missing status endpoint"
    assert f"{base}/status/{{job_id}}/cancel" in paths, "missing cancel endpoint"

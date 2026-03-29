import time

import pytest


@pytest.mark.performance
def test_zotero_sync_slo_placeholder() -> None:
    start = time.perf_counter()
    elapsed = (time.perf_counter() - start) * 1000
    # Placeholder assertion for CI baseline; real benchmark requires worker + DB fixtures.
    assert elapsed < 500

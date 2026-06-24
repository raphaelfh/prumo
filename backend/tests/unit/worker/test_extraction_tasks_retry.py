from app.worker.tasks.extraction_tasks import _retry_countdown


def test_retry_countdown_is_exponential_and_capped():
    assert _retry_countdown(0) >= 60
    assert _retry_countdown(0) < _retry_countdown(1) < _retry_countdown(2)
    # Cap applies to the final value (base + jitter), never exceeding the max.
    assert _retry_countdown(10) <= 600

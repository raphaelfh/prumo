"""Guards for the worker's resident-memory footprint.

Railway bills RAM held, not RAM used: every prefork child imports the whole
app, so idle children are paid for around the clock. Keep the pool small and
recycle a child that grew during a heavy (PDF/LLM) task.
"""

from __future__ import annotations

from app.worker.celery_app import celery_app


def test_worker_pool_stays_small() -> None:
    assert celery_app.conf.worker_concurrency <= 2


def test_worker_children_are_recycled_after_memory_growth() -> None:
    # Celery reads this in KiB; checked after each task completes.
    assert celery_app.conf.worker_max_memory_per_child is not None

"""Drift guard between task routes and the deployed worker's queue list.

``celery_app.conf.task_routes`` decides which queue each task lands in.
The Coolify ``prumo-worker`` boots with ``--queues=<csv>`` (set as its
custom ``--entrypoint`` docker option; mirrored in
``docs/reference/deployment.md`` § Services). If the two diverge, tasks
are enqueued to queues nobody consumes — silent failure.

This test parses the worker start command out of that doc and asserts
every queue named in ``task_routes`` is in the list. The Coolify
configuration remains the runtime source of truth; this test guards
against drift between it and the in-repo documentation, both of which
must be updated together.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.worker.celery_app import celery_app

# ``__file__`` -> backend/tests/unit/test_celery_routes_drift.py
# parents[0] = unit/, [1] = tests/, [2] = backend/, [3] = repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE_FILE = REPO_ROOT / "docs" / "reference" / "deployment.md"

#: Pattern matching ``--queues=a,b,c`` in the worker start command.
#: Allows letters, digits and underscores in queue names.
#:
#: NOTE: ``[\w,]+`` is intentionally strict — the captured group stops
#: at the first character outside ``[A-Za-z0-9_,]``. The queue list in
#: the doc MUST be a contiguous CSV with no whitespace and no line
#: continuations: ``--queues=a,b,c`` works, ``--queues=a, b, c`` does NOT
#: (the regex captures only ``a``).
QUEUES_PATTERN = re.compile(r"--queues=([\w,]+)")


def _deployed_worker_queues() -> set[str]:
    """Parse the worker ``--queues=<csv>`` flag from the deployment doc."""
    text = SOURCE_FILE.read_text(encoding="utf-8")
    lists = set(QUEUES_PATTERN.findall(text))
    if len(lists) != 1:
        raise AssertionError(
            f"Expected exactly one '--queues=...' list in {SOURCE_FILE}, "
            f"found {sorted(lists)}. The drift test relies on the worker "
            f"start command being documented there once."
        )
    return set(lists.pop().split(","))


def test_every_routed_queue_is_consumed_by_the_deployed_worker() -> None:
    """Every queue routed in code MUST be consumed by the worker.

    If this fails, either:
      - add the missing queue to the worker ``--queues`` list in
        ``docs/reference/deployment.md`` AND in the Coolify
        ``prumo-worker`` entrypoint, or
      - drop the route in ``app/worker/celery_app.py``.
    """
    routed = {entry["queue"] for entry in celery_app.conf.task_routes.values()}
    consumed = _deployed_worker_queues()
    missing = routed - consumed
    assert not missing, (
        f"Queues routed in celery_app.conf.task_routes but NOT in the "
        f"deployed worker --queues list: {sorted(missing)}. Either add "
        f"them to the worker start command in docs/reference/deployment.md "
        f"(and the Coolify prumo-worker entrypoint) or drop the route in "
        f"celery_app.py."
    )

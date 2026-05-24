"""Drift guard between task routes and the deployed worker's queue list.

``celery_app.conf.task_routes`` decides which queue each task lands in.
The Railway worker boots with ``--queues=<csv>`` (set in the Railway
dashboard; mirrored in ``railway.toml`` for documentation). If the two
diverge, tasks are enqueued to queues nobody consumes — silent failure.

This test parses the worker start command out of the canonical source
(``railway.toml`` at the repo root — see the inventory comment block
in that file) and asserts every queue named in ``task_routes`` is in
that list.

If the queue list ever moves out of ``railway.toml`` (e.g. into a
GitHub Actions workflow), update ``SOURCE_FILE`` and ``QUEUES_PATTERN``
accordingly. The Railway dashboard remains the runtime source of truth;
this test guards against drift between the dashboard and the in-repo
documentation, both of which must be updated together.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.worker.celery_app import celery_app

# ``__file__`` -> backend/tests/unit/test_celery_routes_drift.py
# parents[0] = unit/, [1] = tests/, [2] = backend/, [3] = repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE_FILE = REPO_ROOT / "railway.toml"

#: Pattern matching ``--queues=a,b,c`` in the Railway worker start
#: command. Allows letters, digits and underscores in queue names.
QUEUES_PATTERN = re.compile(r"--queues=([\w,]+)")


def _railway_worker_queues() -> set[str]:
    """Parse the worker ``--queues=<csv>`` flag from the canonical file."""
    text = SOURCE_FILE.read_text(encoding="utf-8")
    match = QUEUES_PATTERN.search(text)
    if not match:
        raise AssertionError(
            f"Could not find '--queues=...' in {SOURCE_FILE}. "
            f"The drift test relies on the worker start command being "
            f"present there. If you moved the canonical location, "
            f"update SOURCE_FILE in this test."
        )
    return set(match.group(1).split(","))


def test_every_routed_queue_is_consumed_by_the_railway_worker() -> None:
    """Every queue routed in code MUST be consumed by the worker.

    If this fails, either:
      - add the missing queue to the worker ``--queues`` list in
        ``railway.toml`` AND in the Railway dashboard, or
      - drop the route in ``app/worker/celery_app.py``.
    """
    routed = {entry["queue"] for entry in celery_app.conf.task_routes.values()}
    consumed = _railway_worker_queues()
    missing = routed - consumed
    assert not missing, (
        f"Queues routed in celery_app.conf.task_routes but NOT in the "
        f"Railway worker --queues list: {sorted(missing)}. Either add "
        f"them to the worker start command in railway.toml (and update "
        f"the Railway dashboard) or drop the route in celery_app.py."
    )

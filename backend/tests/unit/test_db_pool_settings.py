"""The web engine's pool comes from settings, and the defaults fit the pooler.

Production connects through the Supabase pooler in session mode with a
15-client cap: the web pool (size + overflow) plus the worker's connections
must leave headroom under it for migrations and admin sessions.
"""

import pytest
from pydantic import ValidationError

from app.core import deps
from app.core.config import Settings, settings
from app.worker.celery_app import celery_app

POOLER_CLIENT_CAP = 15
ADMIN_HEADROOM = 2
# ASSUMPTION, not derived: no setting caps it. The worst task today
# (extraction_tasks) holds its ownership session while run() opens a domain
# session, both NullPool connections. A task holding a third concurrent
# session breaks the budget below; raise this and re-check.
WORKER_SESSIONS_PER_TASK = 2


def _default(name: str) -> object:
    return Settings.model_fields[name].default


def test_pool_defaults() -> None:
    assert (_default("DB_POOL_SIZE"), _default("DB_MAX_OVERFLOW"), _default("DB_POOL_TIMEOUT")) == (
        5,
        3,
        10.0,
    )


def test_default_web_pool_plus_worker_fits_the_pooler_cap() -> None:
    web = _default("DB_POOL_SIZE") + _default("DB_MAX_OVERFLOW")  # type: ignore[operator]
    worker = celery_app.conf.worker_concurrency * WORKER_SESSIONS_PER_TASK
    assert web + worker <= POOLER_CLIENT_CAP - ADMIN_HEADROOM


def test_engine_reads_the_pool_settings() -> None:
    pool = deps.engine.pool
    assert pool.size() == settings.DB_POOL_SIZE  # type: ignore[attr-defined]
    assert pool._max_overflow == settings.DB_MAX_OVERFLOW  # type: ignore[attr-defined]
    assert pool._timeout == settings.DB_POOL_TIMEOUT  # type: ignore[attr-defined]


def test_inflight_cap_default_is_half_the_web_pool() -> None:
    web = _default("DB_POOL_SIZE") + _default("DB_MAX_OVERFLOW")  # type: ignore[operator]
    assert _default("MCP_MAX_INFLIGHT_PER_TOKEN") == 4
    assert _default("MCP_MAX_INFLIGHT_PER_TOKEN") * 2 <= web


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("DB_POOL_SIZE", 0),
        ("DB_MAX_OVERFLOW", -1),
        ("DB_POOL_TIMEOUT", 0),
        ("MCP_MAX_INFLIGHT_PER_TOKEN", 0),
    ],
    ids=["pool-size", "overflow", "timeout", "inflight"],
)
def test_pool_and_cap_settings_reject_out_of_range(name: str, value: float) -> None:
    with pytest.raises(ValidationError, match=name):
        Settings(
            _env_file=None,  # type: ignore[call-arg]
            DATABASE_URL="postgresql://u:p@localhost:5432/db",  # type: ignore[arg-type]
            SUPABASE_URL="http://localhost:54321",
            SUPABASE_SERVICE_ROLE_KEY="stub",
            **{name: value},
        )

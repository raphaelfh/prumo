"""The web engine's pool comes from settings, and the defaults fit the pooler.

Production connects through the Supabase pooler in session mode with a
15-client cap: the web pool (size + overflow) plus the worker's connections
must leave headroom under it for migrations and admin sessions.
"""

from app.core import deps
from app.core.config import Settings, settings
from app.worker.celery_app import celery_app

POOLER_CLIENT_CAP = 15
ADMIN_HEADROOM = 2
WORKER_SESSIONS_PER_TASK = 2  # an extraction task holds its ownership + domain sessions


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

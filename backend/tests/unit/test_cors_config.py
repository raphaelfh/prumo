"""CORS allow-list regression tests.

Guards the 2026-05-31 production outage: the live frontend origin
``https://prumoai.vercel.app`` was missing from the backend CORS
allow-list, so every browser -> backend preflight (e.g.
``POST /api/v1/hitl/sessions``) was rejected with "Disallowed CORS
origin". Reads that went straight to Supabase (global templates) kept
working, which made the failure look selective. The production frontend
origin must always be allowed, even when ``CORS_ORIGINS`` env is stale.
"""

from app.core.config import Settings, settings

PROD_FRONTEND_ORIGIN = "https://prumoai.vercel.app"


def test_prod_frontend_origin_always_allowed_even_when_env_omits_it() -> None:
    """The canonical prod origin lives in the hardcoded defaults, so a
    stale ``CORS_ORIGINS`` env value can never lock the frontend out."""
    stale = Settings.model_construct(CORS_ORIGINS="https://unrelated.example")
    origins = stale.cors_origins_list
    assert PROD_FRONTEND_ORIGIN in origins
    # configured values are still honoured (merge, not replace)
    assert "https://unrelated.example" in origins


def test_cors_origins_list_dedupes() -> None:
    """A configured origin that also appears in the defaults is not
    duplicated."""
    dup = Settings.model_construct(CORS_ORIGINS=PROD_FRONTEND_ORIGIN)
    origins = dup.cors_origins_list
    assert origins.count(PROD_FRONTEND_ORIGIN) == 1


def test_singleton_includes_prod_origin() -> None:
    assert PROD_FRONTEND_ORIGIN in settings.cors_origins_list

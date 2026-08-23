"""CORS allow-list regression tests.

Guards the 2026-05-31 production outage: the live frontend origin
``https://prumoai.vercel.app`` was missing from the backend CORS
allow-list, so every browser -> backend preflight (e.g.
``POST /api/v1/hitl/sessions``) was rejected with "Disallowed CORS
origin". Reads that went straight to Supabase (global templates) kept
working, which made the failure look selective. The production frontend
origin must always be allowed, even when ``CORS_ORIGINS`` env is stale.
"""

import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import Response

from app.core.config import Settings, settings
from app.main import create_app

PROD_FRONTEND_ORIGIN = "https://prumoai.vercel.app"
# Retired 2026-08-09: this host is not under the project's Vercel account
# and serves an unrelated application. It must never be able to make
# credentialed cross-origin calls to the API.
RETIRED_ORIGIN = "https://prumo.vercel.app"


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


def test_retired_origin_is_not_in_the_defaults() -> None:
    """A retired origin must not survive in the hardcoded defaults, where
    no env change can remove it."""
    empty_env = Settings.model_construct(CORS_ORIGINS="")
    assert RETIRED_ORIGIN not in empty_env.cors_origins_list


# --- DEBUG-only localhost regex -------------------------------------------
# Guards the 2026-08-23 worktree friction: the main checkout owns port 8080,
# so concurrent worktree sessions must run Vite elsewhere (e.g. 8090) and
# every API preflight was then rejected. The symptom is not a visible CORS
# error but a page that never reaches ready -- Playwright reports a spec
# skipped for a misleading reason. Two sessions "fixed" it only in their
# untracked backend/.env, so the next session hit it again.

WORKTREE_ORIGIN = "http://127.0.0.1:8090"


def _preflight(app: FastAPI, origin: str) -> Response:
    """Send a CORS preflight. CORSMiddleware short-circuits OPTIONS before
    routing, so the path is never resolved and no DB is touched. TestClient
    is used without a ``with`` block so the lifespan never runs."""
    return TestClient(app).options(
        "/api/v1/hitl/sessions",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
    )


def test_localhost_regex_is_debug_only() -> None:
    """The regex is a development affordance. Production keeps the explicit
    allow-list (constitution IV: no wildcard origins in production)."""
    assert Settings.model_construct(DEBUG=True).cors_origin_regex is not None
    assert Settings.model_construct(DEBUG=False).cors_origin_regex is None


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:8090",
        "http://127.0.0.1:8090",
        "http://localhost:5174",
        "http://127.0.0.1:3001",
    ],
)
def test_debug_regex_matches_any_localhost_port(origin: str) -> None:
    pattern = Settings.model_construct(DEBUG=True).cors_origin_regex
    assert pattern is not None
    assert re.fullmatch(pattern, origin), origin


@pytest.mark.parametrize(
    "origin",
    [
        "https://localhost:8090",  # scheme is pinned to http
        "http://localhost.evil.example:8090",  # suffix on the host
        "http://evil-localhost:8090",  # prefix on the host
        "http://127.0.0.1:8090.evil.example",  # suffix after the port
        "http://127.0.0.1:8090/",  # trailing path
        "http://localhost",  # no port at all
        "https://unrelated.example",
    ],
)
def test_debug_regex_rejects_lookalike_origins(origin: str) -> None:
    """Anchors matter: Starlette matched with ``re.match`` historically and
    ``re.fullmatch`` today, so an unanchored pattern would let
    ``http://localhost:1.evil.example`` through on older versions."""
    pattern = Settings.model_construct(DEBUG=True).cors_origin_regex
    assert pattern is not None
    assert re.fullmatch(pattern, origin) is None, origin


def test_debug_app_allows_arbitrary_localhost_port_preflight(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A DEBUG app answers the preflight from a worktree's Vite port."""
    monkeypatch.setattr(settings, "DEBUG", True)
    response = _preflight(create_app(), WORKTREE_ORIGIN)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == WORKTREE_ORIGIN


def test_debug_app_allows_arbitrary_localhost_port_actual_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Passing the preflight is not enough -- the browser also drops the
    actual response unless it carries Access-Control-Allow-Origin. Covers
    the simple-response branch of CORSMiddleware, not just preflight."""
    monkeypatch.setattr(settings, "DEBUG", True)
    response = TestClient(create_app()).get("/health", headers={"Origin": WORKTREE_ORIGIN})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == WORKTREE_ORIGIN
    # allow_credentials=True must echo the exact origin, never "*".
    assert response.headers["access-control-allow-credentials"] == "true"


def test_non_debug_app_rejects_unlisted_localhost_port_preflight(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Without DEBUG the explicit allow-list still governs: an unlisted port
    is refused ("Disallowed CORS origin", 400)."""
    monkeypatch.setattr(settings, "DEBUG", False)
    response = _preflight(create_app(), WORKTREE_ORIGIN)

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_non_debug_app_still_allows_the_explicit_allow_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The regex is additive -- removing it must not narrow production."""
    monkeypatch.setattr(settings, "DEBUG", False)
    response = _preflight(create_app(), PROD_FRONTEND_ORIGIN)

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == PROD_FRONTEND_ORIGIN

"""The connection model's CHECK literals derive from the registry (§2)."""

from __future__ import annotations

import pytest

from app.llm import registry
from app.llm.registry import REGISTRY
from app.models.llm_connection import (
    LlmConnection,
    UserProjectEngine,
    base_url_check_literal,
    provider_check_literal,
    scopes_check_literal,
)


def _check(short: str) -> str:
    # The "ck" naming convention (models/base.py) expands the SHORT name the
    # model declares to ck_<table>_<short> at attach time — the same name the
    # migration's op.create_table emits and pg_constraint carries.
    name = f"ck_llm_connections_{short}"
    checks = [c for c in LlmConnection.__table__.constraints if getattr(c, "name", None) == name]
    assert len(checks) == 1, name
    return str(checks[0].sqltext)


def test_provider_check_literal_equals_the_registry() -> None:
    assert _check("provider_check") == provider_check_literal()
    assert provider_check_literal() == (
        "provider IN ('openai', 'anthropic', 'google', 'ollama', 'openai_compatible', 'llama_cloud')"
    )


def test_scopes_check_literal_lists_the_project_scope_providers() -> None:
    assert _check("scopes_check") == scopes_check_literal()
    assert scopes_check_literal() == (
        "scope = 'user' OR provider IN ('openai', 'anthropic', 'google', 'ollama', 'llama_cloud')"
    )


def test_base_url_check_names_the_host_bearing_providers() -> None:
    assert _check("base_url_check") == base_url_check_literal()
    assert "('openai_compatible')" in base_url_check_literal()


def test_removing_a_provider_breaks_the_drift_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mutation test: the baked CHECK must diverge from a freshly computed
    literal once the registry loses a provider — the guard is not vacuous."""
    baked = _check("provider_check")
    trimmed = tuple(spec for spec in REGISTRY if spec.id != "anthropic")
    monkeypatch.setattr(registry, "REGISTRY", trimmed)
    assert baked != provider_check_literal()
    assert _check("scopes_check") != scopes_check_literal()


def test_user_project_engines_pk_is_user_and_project() -> None:
    assert [c.name for c in UserProjectEngine.__table__.primary_key.columns] == [
        "user_id",
        "project_id",
    ]

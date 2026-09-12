"""The provider registry (§1) — the only file that names a provider.

Drift tests: anything that lists providers elsewhere must equal this.
"""

from __future__ import annotations

import pytest

from app.core.config import Settings, settings
from app.llm import registry
from app.llm.registry import (
    REGISTRY,
    ProviderSpec,
    get_provider,
    global_key_for,
    is_byok_only,
    provider_ids,
    storable_providers,
)


def test_registry_ids_are_exactly_the_registered_providers() -> None:
    assert provider_ids() == ("openai", "anthropic", "google", "openai_compatible", "llama_cloud")


def test_llm_providers_exclude_parsing_providers() -> None:
    assert [s.id for s in REGISTRY if s.serves == "llm"] == [
        "openai",
        "anthropic",
        "google",
        "openai_compatible",
    ]


def test_ids_are_unique() -> None:
    ids = [spec.id for spec in REGISTRY]
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize("spec", REGISTRY, ids=lambda s: s.id)
def test_every_provider_has_label_and_description(spec: ProviderSpec) -> None:
    assert spec.label.strip()
    assert spec.description.strip()


@pytest.mark.parametrize("spec", REGISTRY, ids=lambda s: s.id)
def test_hosted_providers_name_a_real_settings_field(spec: ProviderSpec) -> None:
    """Every hosted provider has a global key setting; only a host-bearing
    provider has none (a host is a per-connection fact)."""
    if spec.needs_host:
        assert spec.global_key_setting is None
        assert spec.docs_url is None
    else:
        assert spec.global_key_setting is not None
        assert spec.global_key_setting in Settings.model_fields
        assert spec.docs_url is not None and spec.docs_url.startswith("https://")


def test_get_provider_misses_unknown_id() -> None:
    assert get_provider("grok") is None
    assert get_provider("gemini") is None


def test_global_key_for_reads_the_named_settings_field(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    assert global_key_for("anthropic") == "sk-ant-global"
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    assert global_key_for("anthropic") is None


def test_global_key_for_host_bearing_provider_is_none() -> None:
    assert global_key_for("openai_compatible") is None


def test_global_key_for_unknown_provider_is_none() -> None:
    assert global_key_for("grok") is None


def test_byok_only_is_computed_from_the_deployment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    assert is_byok_only("anthropic") is True
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-global")
    assert is_byok_only("anthropic") is False


def test_host_bearing_provider_is_never_byok_only() -> None:
    assert is_byok_only("openai_compatible") is False


def test_user_api_keys_check_literal_equals_the_registry() -> None:
    from app.models.user_api_key import UserAPIKey, provider_check_literal

    # SQLAlchemy's "ck" naming convention (app/models/base.py) rewrites the
    # given name to "ck_<table>_<given name>", so match by substring rather
    # than exact equality against the raw name we passed to CheckConstraint.
    checks = [
        c
        for c in UserAPIKey.__table__.constraints
        if "user_api_keys_provider_check" in (getattr(c, "name", None) or "")
    ]
    assert len(checks) == 1
    assert str(checks[0].sqltext) == provider_check_literal()
    assert provider_check_literal() == (
        "provider IN ('openai', 'anthropic', 'google', 'openai_compatible', 'llama_cloud')"
    )


def test_removing_a_provider_breaks_the_drift_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mutation test: the drift check in the model must FAIL when the
    registry loses a provider — proves the guard is not vacuous.

    The CHECK constraint is baked into ``UserAPIKey.__table__`` once, at
    model-import time, from the full registry. After the registry loses a
    provider, a freshly computed ``provider_check_literal()`` must diverge
    from that baked value — otherwise the drift test above would stay green
    no matter what the registry says, i.e. it would be vacuous.
    """
    from app.models.user_api_key import UserAPIKey, provider_check_literal

    checks = [
        c
        for c in UserAPIKey.__table__.constraints
        if "user_api_keys_provider_check" in (getattr(c, "name", None) or "")
    ]
    baked = str(checks[0].sqltext)

    trimmed = tuple(spec for spec in REGISTRY if spec.id != "anthropic")
    monkeypatch.setattr(registry, "REGISTRY", trimmed)
    assert baked != provider_check_literal()


def test_storable_providers_are_the_hosted_ones() -> None:
    """Host-bearing providers wait for slice 2's connections."""
    assert [s.id for s in storable_providers()] == ["openai", "anthropic", "google", "llama_cloud"]

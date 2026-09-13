"""The provider registry (§1) — the only file that names a provider.

Drift tests: anything that lists providers elsewhere must equal this.
"""

from __future__ import annotations

import pytest

from app.core.config import Settings, settings
from app.llm.registry import (
    REGISTRY,
    ProviderSpec,
    get_provider,
    global_key_for,
    llm_provider_ids,
    provider_ids,
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


def test_llm_provider_ids_are_exactly_the_llm_serving_providers_in_order() -> None:
    """§ orchestrator ruling: llm_provider_ids() excludes the parsing
    provider (llama_cloud) and is registry-order, not sorted."""
    assert llm_provider_ids() == ("openai", "anthropic", "google", "openai_compatible")
    assert "llama_cloud" not in llm_provider_ids()


def test_scopes_are_per_the_spec_table() -> None:
    """§1: hosted providers are storable at both scopes; a host-bearing
    provider is user-only (a host lives on one person's machine)."""
    assert get_provider("openai").scopes == frozenset({"user", "project"})
    assert get_provider("anthropic").scopes == frozenset({"user", "project"})
    assert get_provider("google").scopes == frozenset({"user", "project"})
    assert get_provider("llama_cloud").scopes == frozenset({"user", "project"})
    assert get_provider("openai_compatible").scopes == frozenset({"user"})


@pytest.mark.parametrize("spec", REGISTRY, ids=lambda s: s.id)
def test_scopes_are_a_nonempty_subset_of_user_project(spec: ProviderSpec) -> None:
    assert spec.scopes and spec.scopes <= {"user", "project"}


def test_key_optional_is_exactly_the_host_bearing_rule() -> None:
    """§1: keyless is legal only where a host is (a local Ollama)."""
    for spec in REGISTRY:
        assert spec.key_optional == spec.needs_host, spec.id

"""The provider registry (§1) — the only file that names a provider.

Drift tests: anything that lists providers elsewhere must equal this. The
row carries the provider's behaviour too (``build``, ``probe``,
``output_mode``); the invariants below are what lets ``build_model`` and
``probe_hosted_key`` dispatch without naming anyone.
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
    needs_host,
    provider_ids,
)


def test_registry_ids_are_exactly_the_registered_providers() -> None:
    assert provider_ids() == (
        "openai",
        "anthropic",
        "google",
        "ollama",
        "openai_compatible",
        "llama_cloud",
    )


def test_llm_providers_exclude_parsing_providers() -> None:
    assert [s.id for s in REGISTRY if s.llm is not None] == [
        "openai",
        "anthropic",
        "google",
        "ollama",
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
    assert llm_provider_ids() == ("openai", "anthropic", "google", "ollama", "openai_compatible")
    assert "llama_cloud" not in llm_provider_ids()


def test_scopes_are_per_the_spec_table() -> None:
    """§1: hosted providers are storable at both scopes; a host-bearing
    provider is user-only (a host lives on one person's machine)."""
    assert get_provider("openai").scopes == frozenset({"user", "project"})
    assert get_provider("anthropic").scopes == frozenset({"user", "project"})
    assert get_provider("google").scopes == frozenset({"user", "project"})
    assert get_provider("ollama").scopes == frozenset({"user", "project"})
    assert get_provider("llama_cloud").scopes == frozenset({"user", "project"})
    assert get_provider("openai_compatible").scopes == frozenset({"user"})


@pytest.mark.parametrize("spec", REGISTRY, ids=lambda s: s.id)
def test_scopes_are_a_nonempty_subset_of_user_project(spec: ProviderSpec) -> None:
    assert spec.scopes and spec.scopes <= {"user", "project"}


def test_key_optional_is_exactly_the_host_bearing_rule() -> None:
    """§1: keyless is legal only where a host is (a local Ollama)."""
    for spec in REGISTRY:
        assert spec.key_optional == spec.needs_host, spec.id


@pytest.mark.parametrize("spec", REGISTRY, ids=lambda s: s.id)
def test_only_hosted_rows_carry_a_key_probe(spec: ProviderSpec) -> None:
    """A hosted row carries its key probe; a host-bearing row leaves probing
    to the endpoint ladder."""
    assert (spec.probe is not None) == (not spec.needs_host), spec.id


def test_needs_host_reads_the_row_and_rejects_unknown_ids() -> None:
    assert [s.id for s in REGISTRY if needs_host(s.id)] == ["openai_compatible"]
    assert needs_host("no-such-provider") is False


def test_output_modes_are_per_the_spec_table() -> None:
    """OpenAI and Gemini enforce a json_schema response_format; Anthropic has
    none and Ollama Cloud accepts one without enforcing it, so both use
    tool-calling. A custom host's row default is overridden by its probe."""
    assert {spec.id: spec.llm and spec.llm.output_mode for spec in REGISTRY} == {
        "openai": "native",
        "anthropic": "tool",
        "google": "native",
        "ollama": "tool",
        "openai_compatible": "native",
        "llama_cloud": None,
    }

"""Credentials → pydantic-ai models: one table-driven pass over the registry
rows through ``build_model``, plus a fake row proving the dispatch is the
row's — ``build_model`` names no provider."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic_ai.models.openai import OpenAIChatModel

import app.llm.registry as registry
from app.core.config import settings
from app.llm.provider import MissingLLMKeyError, build_model
from app.llm.registry import REGISTRY, ProviderSpec

LLM_SPECS = [spec for spec in REGISTRY if spec.serves == "llm"]
HOSTED_SPECS = [spec for spec in LLM_SPECS if not spec.needs_host]
_HOST = "https://llm.lab.example/v1"

#: The adapter class each row yields — the spec, not a tautology.
_MODEL_CLASS = {
    "openai": "OpenAIChatModel",
    "anthropic": "AnthropicModel",
    "google": "GoogleModel",
    "ollama": "OllamaModel",
    "openai_compatible": "OpenAIChatModel",
}


def _build(spec: ProviderSpec, **kw: Any) -> Any:
    kw.setdefault("api_key", "sk-row")
    if spec.needs_host:
        kw.setdefault("base_url", _HOST)
    return build_model(spec.id, "any-model", **kw)


@pytest.mark.parametrize("spec", LLM_SPECS, ids=lambda s: s.id)
def test_every_llm_row_builds_its_adapter_on_its_own_output_mode(spec: ProviderSpec) -> None:
    model = _build(spec)
    assert type(model).__name__ == _MODEL_CLASS[spec.id]
    assert model.model_name == "any-model"
    assert model.profile.default_structured_output_mode == spec.output_mode


@pytest.mark.parametrize("spec", HOSTED_SPECS, ids=lambda s: s.id)
def test_hosted_row_falls_back_to_its_global_key(
    monkeypatch: pytest.MonkeyPatch, spec: ProviderSpec
) -> None:
    assert spec.global_key_setting is not None
    monkeypatch.setattr(settings, spec.global_key_setting, "global-key")
    assert type(_build(spec, api_key=None)).__name__ == _MODEL_CLASS[spec.id]


@pytest.mark.parametrize("spec", HOSTED_SPECS, ids=lambda s: s.id)
def test_hosted_row_without_any_key_raises_naming_its_setting(
    monkeypatch: pytest.MonkeyPatch, spec: ProviderSpec
) -> None:
    assert spec.global_key_setting is not None
    monkeypatch.setattr(settings, spec.global_key_setting, None)
    monkeypatch.delenv(spec.global_key_setting, raising=False)
    with pytest.raises(MissingLLMKeyError, match=spec.global_key_setting):
        _build(spec, api_key=None)


@pytest.mark.parametrize(
    ("provider", "host"),
    [("openai", "api.openai.com"), ("anthropic", "api.anthropic.com"), ("ollama", "ollama.com")],
)
def test_hosted_row_ignores_base_url(provider: str, host: str) -> None:
    model = build_model(provider, "any-model", api_key="sk-row", base_url=_HOST)
    assert host in str(model.client.base_url) and "llm.lab.example" not in str(
        model.client.base_url
    )


def test_openai_key_reaches_the_client() -> None:
    model = build_model("openai", "gpt-4o-mini", api_key="sk-user-key")
    assert isinstance(model, OpenAIChatModel) and model.client.api_key == "sk-user-key"


def test_ollama_cloud_key_reaches_the_client() -> None:
    model = build_model("ollama", "gpt-oss:120b", api_key="ollama-user-key")
    assert model.client.api_key == "ollama-user-key"


# --- the host-bearing row -----------------------------------------------------


def test_custom_host_points_the_client_at_the_base_url() -> None:
    model = build_model("openai_compatible", "llama3", api_key="sk-endpoint", base_url=_HOST)
    assert isinstance(model, OpenAIChatModel)
    assert str(model.client.base_url) == _HOST + "/"
    assert model.client.api_key == "sk-endpoint"


def test_custom_host_without_base_url_raises() -> None:
    with pytest.raises(ValueError, match="base_url"):
        build_model("openai_compatible", "llama3", api_key="sk-endpoint")


def test_custom_host_keyless_gets_placeholder_key() -> None:
    model = build_model("openai_compatible", "llama3", base_url=_HOST)
    assert model.client.api_key == "no-key-required"


@pytest.mark.parametrize("probed", ["tool", "native", "prompted"])
def test_custom_host_runs_on_its_probed_output_mode(probed: str) -> None:
    """The endpoint probe's verdict, stored on the connection, overrides the
    row default at the wire."""
    model = build_model("openai_compatible", "llama3", base_url=_HOST, output_mode=probed)  # type: ignore[arg-type]
    assert model.profile.default_structured_output_mode == probed


def test_custom_host_without_a_probed_mode_takes_the_row_default() -> None:
    model = build_model("openai_compatible", "llama3", base_url=_HOST)
    assert model.profile.default_structured_output_mode == "native"


@pytest.mark.parametrize(
    ("model_name", "base_url"),
    [
        ("gpt-oss:120b", "https://ollama.com/v1"),
        ("gpt-oss:120b", "https://api.ollama.com/v1"),
        ("gpt-oss:120b-cloud", "http://localhost:11434/v1"),
    ],
)
def test_host_name_never_decides_the_output_mode(model_name: str, base_url: str) -> None:
    """Ollama Cloud shapes used to be sniffed from the URL and the ``-cloud``
    suffix. The probe measured this connection; its verdict is the only
    authority, whatever the host is called."""
    model = build_model("openai_compatible", model_name, base_url=base_url, output_mode="native")
    assert type(model) is OpenAIChatModel
    assert model.profile.default_structured_output_mode == "native"


# --- guards -------------------------------------------------------------------


def test_unknown_provider_raises() -> None:
    with pytest.raises(ValueError, match="Unsupported LLM provider"):
        build_model("grok", "grok-2", api_key="x")


def test_rejects_blank_model_name() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        build_model("openai", "   ", api_key="sk-user-key")


def test_parsing_provider_is_not_buildable() -> None:
    with pytest.raises(ValueError, match="Unsupported LLM provider"):
        build_model("llama_cloud", "anything", api_key="x")


# --- a fake row: the dispatch is the row's ------------------------------------


def _fake_row(
    monkeypatch: pytest.MonkeyPatch, *, needs_host: bool
) -> list[tuple[str, str, str | None, str]]:
    seen: list[tuple[str, str, str | None, str]] = []

    def build(model_name: str, api_key: str, base_url: str | None, output_mode: str) -> Any:
        seen.append((model_name, api_key, base_url, output_mode))
        return object()

    fake = ProviderSpec(
        id="fake",
        label="Fake",
        description="a row under test",
        serves="llm",
        needs_host=needs_host,
        key_optional=needs_host,
        global_key_setting=None if needs_host else "OPENAI_API_KEY",
        docs_url=None,
        scopes=frozenset({"user"}),
        build=build,  # type: ignore[arg-type]
        probe=None,
        output_mode="prompted",
    )
    monkeypatch.setattr(registry, "REGISTRY", (*REGISTRY, fake))
    return seen


def test_host_row_dispatches_resolved_credentials_to_its_builder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = _fake_row(monkeypatch, needs_host=True)
    build_model("fake", "m", base_url="https://h.example/v1")
    build_model("fake", "m", api_key="k", base_url="https://h.example/v1", output_mode="tool")
    assert seen == [
        ("m", "no-key-required", "https://h.example/v1", "prompted"),
        ("m", "k", "https://h.example/v1", "tool"),
    ]


def test_hosted_row_dispatches_the_ladders_key_to_its_builder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = _fake_row(monkeypatch, needs_host=False)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "global-key")
    build_model("fake", "m", base_url="https://ignored.example/v1")
    assert seen == [("m", "global-key", None, "prompted")]

"""BYOK key resolution → pydantic-ai model instances."""

import pytest
from pydantic_ai.models.openai import OpenAIChatModel

from app.core.config import settings
from app.llm.provider import MissingLLMKeyError, build_model


def test_openai_branch_builds_openai_model():
    model = build_model("openai", "gpt-4o-mini", api_key="sk-user-key")
    assert isinstance(model, OpenAIChatModel)
    assert model.model_name == "gpt-4o-mini"


def test_openai_falls_back_to_global_key(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-global")
    model = build_model("openai", "gpt-4o-mini", api_key=None)
    assert isinstance(model, OpenAIChatModel)


def test_openai_raises_clear_error_when_no_key_anywhere(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", None)
    with pytest.raises(MissingLLMKeyError, match="OPENAI_API_KEY"):
        build_model("openai", "gpt-4o-mini", api_key=None)


def test_anthropic_branch_builds_anthropic_model():
    model = build_model("anthropic", "claude-3-5-sonnet-latest", api_key="sk-ant-test")
    assert type(model).__name__ == "AnthropicModel"


def test_anthropic_without_key_raises_missing_key():
    with pytest.raises(MissingLLMKeyError):
        build_model("anthropic", "claude-3-5-sonnet-latest", api_key=None)


def test_openai_compatible_builds_model_pointed_at_base_url():
    model = build_model(
        "openai_compatible",
        "llama3",
        api_key="sk-endpoint",
        base_url="https://llm.lab.example/v1",
    )
    assert isinstance(model, OpenAIChatModel)
    assert model.model_name == "llama3"
    assert str(model.client.base_url) == "https://llm.lab.example/v1/"
    assert model.client.api_key == "sk-endpoint"


def test_openai_compatible_without_base_url_raises():
    with pytest.raises(ValueError, match="base_url"):
        build_model("openai_compatible", "llama3", api_key="sk-endpoint")


def test_openai_compatible_keyless_gets_placeholder_key():
    model = build_model("openai_compatible", "llama3", base_url="https://llm.lab.example/v1")
    assert isinstance(model, OpenAIChatModel)
    assert model.client.api_key == "no-key-required"


def test_openai_branch_ignores_base_url():
    model = build_model(
        "openai", "gpt-4o-mini", api_key="sk-user-key", base_url="https://llm.lab.example/v1"
    )
    assert isinstance(model, OpenAIChatModel)
    assert str(model.client.base_url) == "https://api.openai.com/v1/"


def test_anthropic_branch_ignores_base_url():
    model = build_model(
        "anthropic",
        "claude-3-5-sonnet-latest",
        api_key="sk-ant-test",
        base_url="https://llm.lab.example/v1",
    )
    assert type(model).__name__ == "AnthropicModel"
    assert "llm.lab.example" not in str(model.client.base_url)


def test_unknown_provider_raises():
    with pytest.raises(ValueError, match="Unsupported LLM provider"):
        build_model("grok", "grok-2", api_key="x")


def test_rejects_blank_model_name():
    with pytest.raises(ValueError, match="non-empty"):
        build_model("openai", "   ", api_key="sk-user-key")

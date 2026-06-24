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


def test_unknown_provider_raises():
    with pytest.raises(ValueError, match="Unsupported LLM provider"):
        build_model("grok", "grok-2", api_key="x")


def test_rejects_blank_model_name():
    with pytest.raises(ValueError, match="non-empty"):
        build_model("openai", "   ", api_key="sk-user-key")

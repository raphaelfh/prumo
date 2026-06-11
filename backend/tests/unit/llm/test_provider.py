"""BYOK key resolution → pydantic-ai model instances."""

import pytest

from app.core.config import settings
from app.llm.provider import MissingLLMKeyError, build_model


def test_byok_key_builds_openai_model():
    model = build_model("gpt-4o-mini", api_key="sk-user-key")
    assert model.model_name == "gpt-4o-mini"


def test_falls_back_to_global_key(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-global")
    model = build_model("gpt-4o-mini", api_key=None)
    assert model.model_name == "gpt-4o-mini"


def test_raises_clear_error_when_no_key_anywhere(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", None)
    with pytest.raises(MissingLLMKeyError, match="OPENAI_API_KEY"):
        build_model("gpt-4o-mini", api_key=None)


def test_rejects_blank_model_name():
    with pytest.raises(ValueError, match="non-empty"):
        build_model("   ", api_key="sk-user-key")

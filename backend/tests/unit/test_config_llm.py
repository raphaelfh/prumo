from app.core.config import settings


def test_llm_defaults_preserve_current_behavior():
    assert settings.LLM_PROVIDER == "openai"
    assert settings.LLM_DEFAULT_MODEL == "gpt-4o-mini"
    assert settings.LLM_TIMEOUT_SECONDS == 120.0


def test_dead_openai_default_model_removed():
    # OPENAI_DEFAULT_MODEL was never read at runtime; collapsed into LLM_DEFAULT_MODEL.
    assert not hasattr(settings, "OPENAI_DEFAULT_MODEL")

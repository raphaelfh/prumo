from app.core.config import Settings


def test_llm_defaults_preserve_current_behavior():
    # Assert the DECLARED defaults, not a resolved Settings instance. The
    # singleton loads backend/.env -- gitignored and per-developer -- so a
    # local engine override made this test fail on the developer's machine
    # while CI stayed green, turning the prod preflight gate red for a
    # reason that had nothing to do with the code being shipped.
    fields = Settings.model_fields
    assert fields["LLM_PROVIDER"].default == "openai"
    assert fields["LLM_DEFAULT_MODEL"].default == "gpt-5.6-luna"
    assert fields["LLM_TIMEOUT_SECONDS"].default == 120.0


def test_dead_openai_default_model_removed():
    # OPENAI_DEFAULT_MODEL was never read at runtime; collapsed into LLM_DEFAULT_MODEL.
    assert "OPENAI_DEFAULT_MODEL" not in Settings.model_fields

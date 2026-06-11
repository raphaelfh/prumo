"""Observability bootstrap must be a safe no-op without LOGFIRE_TOKEN."""

from app.llm.observability import configure_observability


def test_configure_is_inert_without_token(monkeypatch):
    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    # Must not raise and must be safe to call more than once.
    configure_observability(service_name="test-api")
    configure_observability(service_name="test-api")

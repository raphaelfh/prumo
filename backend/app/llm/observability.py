"""Logfire bootstrap — the single place that wires LLM observability.

Inert without LOGFIRE_TOKEN: ``send_to_logfire="if-token-present"`` makes
every span a local no-op in dev, CI, and tests. The SDK emits pure OTel
(GenAI semconv); switching backends later means pointing
OTEL_EXPORTER_OTLP_ENDPOINT elsewhere, with no code change."""

import logfire


def configure_observability(*, service_name: str) -> None:
    logfire.configure(
        service_name=service_name,
        send_to_logfire="if-token-present",
        console=False,
    )
    logfire.instrument_pydantic_ai()
    # Producer AND worker side: both processes call this so enqueue → task
    # execution stitches into one distributed trace.
    logfire.instrument_celery()

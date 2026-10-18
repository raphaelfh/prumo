"""What an AI extraction request returns (the worker serializes these)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.llm.extractor import LlmUsage


def tokens_of(usage: LlmUsage) -> dict[str, int]:
    """The one ``tokens`` shape run results and per-section outcomes carry —
    the sum of the ``ok`` usage-ledger rows behind them."""
    return {
        "prompt": usage.prompt_tokens,
        "completion": usage.completion_tokens,
        "total": usage.total_tokens,
    }


@dataclass
class SectionExtractionResult:
    """Single-section extraction result."""

    extraction_run_id: str
    entity_type_id: str
    suggestions_created: int
    duration_ms: float


@dataclass
class BatchExtractionResult:
    """Multi-section extraction result."""

    extraction_run_id: str
    total_sections: int
    successful_sections: int
    failed_sections: int
    total_suggestions_created: int
    sections: list[dict[str, Any]]


class BatchAllSectionsFailed(Exception):
    """Every section in a batch extraction failed — the run is failed (not
    reported as a success). Permanent by default: app/llm/errors.py classifies
    unknown exception types as non-retryable."""

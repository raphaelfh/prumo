"""Transient vs permanent classification for LLM-call failures.

The Celery extraction tasks use ``is_transient_llm_error`` to decide whether
to retry with backoff (transient) or fail fast (permanent). Unknown exception
types default to permanent so a real bug does not consume the whole retry
budget on useless retries.
"""

from __future__ import annotations

import asyncio

import httpx
from pydantic_ai.exceptions import ModelHTTPError, UsageLimitExceeded

# 408 request timeout, 425 too early, 429 rate limit, 5xx upstream — retryable.
_TRANSIENT_HTTP_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})


class LLMError(Exception):
    """Base for LLM-call failures with a known retry disposition."""


class TransientLLMError(LLMError):
    """Retryable failure (timeout, rate limit, upstream 5xx)."""


class PermanentLLMError(LLMError):
    """Non-retryable failure (missing key, missing input, bad template)."""


def is_transient_llm_error(exc: BaseException) -> bool:
    """Return True when ``exc`` should be retried with backoff."""
    if isinstance(exc, TransientLLMError):
        return True
    if isinstance(exc, PermanentLLMError):
        return False
    if isinstance(exc, UsageLimitExceeded):
        return False
    if isinstance(exc, asyncio.TimeoutError | httpx.TimeoutException | httpx.ConnectError):
        return True
    if isinstance(exc, ModelHTTPError):
        return exc.status_code in _TRANSIENT_HTTP_STATUS
    return False

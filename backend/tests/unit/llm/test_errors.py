import asyncio

import httpx
import pytest
from pydantic_ai.exceptions import ModelHTTPError, UsageLimitExceeded

from app.llm.errors import (
    PermanentLLMError,
    TransientLLMError,
    is_transient_llm_error,
)


def test_explicit_transient_is_transient():
    assert is_transient_llm_error(TransientLLMError("x")) is True


def test_explicit_permanent_is_not_transient():
    assert is_transient_llm_error(PermanentLLMError("x")) is False


def test_usage_limit_exceeded_is_permanent():
    # Reask budget exhausted => bad schema/template, retry will not help.
    assert is_transient_llm_error(UsageLimitExceeded("limit")) is False


def test_timeout_is_transient():
    assert is_transient_llm_error(asyncio.TimeoutError()) is True
    assert is_transient_llm_error(httpx.TimeoutException("t")) is True
    assert is_transient_llm_error(httpx.ConnectError("c")) is True


@pytest.mark.parametrize(
    "status,expected",
    [(429, True), (502, True), (503, True), (504, True), (500, True), (401, False), (400, False)],
)
def test_model_http_error_classified_by_status(status, expected):
    err = ModelHTTPError(status_code=status, model_name="m", body=None)
    assert is_transient_llm_error(err) is expected


def test_unknown_exception_defaults_permanent():
    # Fail fast on unknown types so a real bug does not burn the retry budget.
    assert is_transient_llm_error(ValueError("boom")) is False

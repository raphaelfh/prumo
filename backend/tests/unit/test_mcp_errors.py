"""The §7 MCP error contract: codes, retryability, extras, exception mapping."""

from __future__ import annotations

import json

import pytest
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.exc import DBAPIError

from app.api.mcp.errors import (
    NOT_FOUND_MESSAGE,
    McpErrorCode,
    McpToolError,
    error_result,
    to_tool_error,
)
from app.services.article_read_service import ArticleNotFoundError
from app.services.article_text_block_read_service import ArticleFileNotFoundError
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_draft_lock_service import DraftLockHeldError
from app.services.template_field_service import (
    DuplicateFieldNameError,
    EntityTypeNotFoundError,
    FieldNotFoundError,
)
from app.services.template_version_read_service import NoActiveTemplateVersionError


class _PgLike(Exception):
    def __init__(self, sqlstate: str) -> None:
        super().__init__("deadlock detected")
        self.sqlstate = sqlstate


def test_every_code_renders_with_its_retryability() -> None:
    assert len(McpErrorCode) == 15
    for code in McpErrorCode:
        r = error_result(McpToolError(code, "m"))
        assert r.is_error is True
        assert r.structured_content is not None
        assert r.structured_content["code"] == code.value
        assert r.structured_content["retryable"] is (
            code in {McpErrorCode.DUPLICATE_NAME, McpErrorCode.RETRY, McpErrorCode.RATE_LIMITED}
        )
        assert isinstance(r.structured_content["next_step"], str)
        assert r.structured_content["next_step"] != ""
        assert json.loads(r.content[0].text) == r.structured_content


def test_extras_ride_the_payload() -> None:
    r = error_result(McpToolError(McpErrorCode.DRAFT_LOCK_HELD, "m", holder_name="Ana"))
    assert r.structured_content is not None
    assert r.structured_content["holder_name"] == "Ana"


class _M(BaseModel):
    label: str = Field(max_length=3)


def _validation_error() -> ValidationError:
    try:
        _M(label="abcd")
    except ValidationError as exc:
        return exc
    raise AssertionError("expected ValidationError")


@pytest.mark.parametrize(
    ("exc", "expected_code"),
    [
        (ArticleNotFoundError("x"), McpErrorCode.NOT_FOUND),
        (ArticleFileNotFoundError("x"), McpErrorCode.NOT_FOUND),
        (ProjectTemplateNotFoundError("x"), McpErrorCode.NOT_FOUND),
        (EntityTypeNotFoundError("x"), McpErrorCode.NOT_FOUND),
        (FieldNotFoundError("x"), McpErrorCode.NOT_FOUND),
        (McpToolError(McpErrorCode.SCOPE_INSUFFICIENT, "m"), McpErrorCode.SCOPE_INSUFFICIENT),
        (_validation_error(), McpErrorCode.INTERNAL_ERROR),
        (DraftLockHeldError("m", details={"holder_name": "Ana"}), McpErrorCode.INTERNAL_ERROR),
        (NoActiveTemplateVersionError(), McpErrorCode.INTERNAL_ERROR),
        (DuplicateFieldNameError(), McpErrorCode.INTERNAL_ERROR),
        (DBAPIError("stmt", {}, _PgLike("40P01")), McpErrorCode.INTERNAL_ERROR),
        (RuntimeError(), McpErrorCode.INTERNAL_ERROR),
    ],
    ids=[
        "article-not-found",
        "article-file-not-found",
        "template-not-found",
        "entity-type-not-found",
        "field-not-found",
        "pass-through",
        "validation-error",
        "draft-lock-held",
        "no-active-template-version",
        "duplicate-field-name",
        "deadlock",
        "runtime-error",
    ],
)
def test_to_tool_error_mapping(exc: BaseException, expected_code: McpErrorCode) -> None:
    err = to_tool_error(exc)
    assert err.code == expected_code
    if expected_code == McpErrorCode.NOT_FOUND:
        assert err.message == NOT_FOUND_MESSAGE
    if isinstance(exc, McpToolError):
        assert err is exc
    if expected_code == McpErrorCode.INTERNAL_ERROR and not isinstance(exc, McpToolError):
        assert err.extras == {}

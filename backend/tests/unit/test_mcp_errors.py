"""The §7 MCP error contract: codes, retryability, extras, exception mapping."""

from __future__ import annotations

import json

import pytest
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy.exc import DBAPIError

from app.api.mcp.errors import (
    AUDITED_CODES,
    NOT_FOUND_MESSAGE,
    McpErrorCode,
    McpToolError,
    error_result,
    reject_nul,
    to_tool_error,
    validation_failure,
)
from app.core.error_handler import NotFoundError
from app.services.article_read_service import ArticleNotFoundError
from app.services.article_text_block_read_service import ArticleFileNotFoundError
from app.services.project_template_active_service import ProjectTemplateNotFoundError
from app.services.template_draft_lock_service import DraftLockHeldError
from app.services.template_field_service import (
    DuplicateFieldNameError,
    EntityTypeNotFoundError,
    FieldNotFoundError,
)
from app.services.template_versioning import (
    NoActiveTemplateVersionError,
)


class _PgLike(Exception):
    def __init__(self, sqlstate: str) -> None:
        super().__init__("deadlock detected")
        self.sqlstate = sqlstate


def test_every_code_renders_with_its_retryability() -> None:
    assert len(McpErrorCode) == 18
    assert {c.value for c in McpErrorCode} == {
        "NOT_FOUND",
        "MANAGER_REQUIRED",
        "REVIEWER_REQUIRED",
        "SCOPE_INSUFFICIENT",
        "INVALID_ARGUMENT",
        "DRAFT_LOCK_HELD",
        "NARROW_BASELINE",
        "NO_PUBLISHED_VERSION",
        "OP_NOT_ALLOWED_VIA_AGENT",
        "TOO_MANY_OPS",
        "FIELD_NOT_EDITABLE",
        "STALE_VALUE",
        "DUPLICATE_NAME",
        "IN_USE",
        "STRUCTURE_CONFLICT",
        "RETRY",
        "RATE_LIMITED",
        "INTERNAL_ERROR",
    }
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


@pytest.mark.parametrize("code", ["IN_USE", "STRUCTURE_CONFLICT"])
def test_structure_codes_are_audited_and_not_retryable(code: str) -> None:
    member = McpErrorCode(code)
    assert member in AUDITED_CODES
    r = error_result(McpToolError(member, "m"))
    assert r.structured_content is not None
    assert r.structured_content["retryable"] is False


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


def test_app_not_found_error_maps_to_not_found() -> None:
    """F9 (final review): `project_details_service` raises the app-wide
    `NotFoundError` for a project deleted mid-call -- NOT_FOUND, not INTERNAL."""
    err = to_tool_error(NotFoundError("Project", "x"))
    assert err.code == McpErrorCode.NOT_FOUND
    assert err.message == NOT_FOUND_MESSAGE


def test_field_never_echoes_a_nul_or_an_unbounded_key() -> None:
    """A NUL-bearing (or huge) argument KEY is named by `field` escaped and
    capped: the error must not carry the very character it refuses."""
    with pytest.raises(McpToolError) as caught:
        reject_nul({"fields": {"bad\x00key" + "k" * 5_000: "v"}})
    field = caught.value.extras["field"]
    assert "\x00" not in field
    assert field.startswith("fields.bad\\u0000key")
    assert len(field) <= 200


class _Inner(BaseModel):
    label: str

    @field_validator("label")
    @classmethod
    def _no_x(cls, value: str) -> str:
        if value == "x":
            raise ValueError("label must not be x")
        if value == "y":  # raised, not `assert`: pytest rewrites asserts in test modules
            raise AssertionError("label must not be y")
        return value


class _Outer(BaseModel):
    items: list[_Inner]


def _outer_error(label: str) -> ValidationError:
    try:
        _Outer.model_validate({"items": [{"label": "ok"}, {"label": label}]})
    except ValidationError as exc:
        return exc
    raise AssertionError("expected ValidationError")


@pytest.mark.parametrize(
    ("label", "message"),
    [("x", "label must not be x"), ("y", "label must not be y")],
    ids=["value-error", "assertion"],
)
def test_validation_failure_names_the_dotted_field_and_strips_pydantic_prefixes(
    label: str, message: str
) -> None:
    err = validation_failure(_outer_error(label), prefix="ops", op_index=1)
    assert err.code == McpErrorCode.INVALID_ARGUMENT
    assert err.message == message
    assert err.extras == {"field": "ops.items.1.label", "op_index": 1}
    rendered = error_result(err).content[0].text
    assert "pydantic" not in rendered
    assert "errors.pydantic.dev" not in rendered


def test_validation_failure_without_prefix_is_the_bare_loc() -> None:
    err = validation_failure(_validation_error())
    assert err.extras == {"field": "label"}
    assert err.message == "String should have at most 3 characters"

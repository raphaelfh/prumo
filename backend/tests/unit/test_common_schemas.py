"""Unit tests for app.schemas.common.

Pure Pydantic validation tests: no DB, no async, no fixtures.
Covers the generic ApiResponse/PaginatedResponse envelopes (a recurring
wire-shape drift incident class), ErrorDetail, the ApiErrorCode StrEnum,
and HealthResponse defaults.
"""

import pytest
from pydantic import BaseModel, ValidationError

from app.schemas.common import (
    ApiErrorCode,
    ApiResponse,
    ErrorDetail,
    HealthResponse,
    PaginatedResponse,
)


class _Inner(BaseModel):
    """Small concrete model for parametrizing the generics."""

    name: str
    count: int


class TestApiErrorCode:
    def test_is_str_enum_members_equal_their_values(self) -> None:
        # StrEnum members compare equal to their string value.
        assert ApiErrorCode.VALIDATION_ERROR == "VALIDATION_ERROR"
        assert ApiErrorCode.NOT_FOUND == "NOT_FOUND"
        assert ApiErrorCode.CONFLICT == "CONFLICT"
        assert ApiErrorCode.UNEXPECTED_ERROR == "UNEXPECTED_ERROR"

    def test_expected_members_present(self) -> None:
        names = {member.name for member in ApiErrorCode}
        assert {
            "VALIDATION_ERROR",
            "AUTHENTICATION_ERROR",
            "AUTHORIZATION_ERROR",
            "FORBIDDEN",
            "NOT_FOUND",
            "CONFLICT",
            "RATE_LIMIT_EXCEEDED",
            "SERVICE_UNAVAILABLE",
            "EXTERNAL_SERVICE_ERROR",
            "AI_EXTRACTION_ERROR",
            "PDF_PROCESSING_ERROR",
            "UNEXPECTED_ERROR",
            "HTTP_ERROR",
        } <= names

    def test_value_equals_name_for_every_member(self) -> None:
        for member in ApiErrorCode:
            assert member.value == member.name


class TestErrorDetail:
    def test_construction_with_code_and_message(self) -> None:
        detail = ErrorDetail(code="NOT_FOUND", message="missing")
        assert detail.code == "NOT_FOUND"
        assert detail.message == "missing"
        assert detail.details is None

    def test_construction_with_details(self) -> None:
        detail = ErrorDetail(
            code="VALIDATION_ERROR",
            message="bad",
            details={"field": "article_ids"},
        )
        assert detail.details == {"field": "article_ids"}

    def test_accepts_api_error_code_enum_as_code(self) -> None:
        detail = ErrorDetail(code=ApiErrorCode.CONFLICT, message="dup")
        assert detail.code == "CONFLICT"

    def test_code_required(self) -> None:
        with pytest.raises(ValidationError):
            ErrorDetail(message="no code")  # type: ignore[call-arg]

    def test_message_required(self) -> None:
        with pytest.raises(ValidationError):
            ErrorDetail(code="NOT_FOUND")  # type: ignore[call-arg]


class TestApiResponseSuccess:
    def test_success_envelope_shape(self) -> None:
        resp = ApiResponse[str].success("payload")
        assert resp.ok is True
        assert resp.data == "payload"
        assert resp.error is None
        assert resp.trace_id is None

    def test_success_with_trace_id(self) -> None:
        resp = ApiResponse[str].success("payload", trace_id="trace-1")
        assert resp.trace_id == "trace-1"

    def test_success_with_inner_model_dump_roundtrip(self) -> None:
        resp = ApiResponse[_Inner].success(_Inner(name="a", count=2))
        dumped = resp.model_dump()
        assert dumped == {
            "ok": True,
            "data": {"name": "a", "count": 2},
            "error": None,
            "trace_id": None,
        }

    def test_success_data_validated_against_concrete_type(self) -> None:
        # data typed as _Inner: a str payload is coerced/validated, so an
        # int-only field that cannot coerce raises.
        with pytest.raises(ValidationError):
            ApiResponse[_Inner].success(_Inner(name="a", count="not-an-int"))  # type: ignore[arg-type]


class TestApiResponseFailure:
    def test_failure_envelope_shape(self) -> None:
        resp = ApiResponse[str].failure("NOT_FOUND", "missing")
        assert resp.ok is False
        assert resp.data is None
        assert resp.error is not None
        assert resp.error.code == "NOT_FOUND"
        assert resp.error.message == "missing"
        assert resp.error.details is None

    def test_failure_with_details_and_trace_id(self) -> None:
        resp = ApiResponse[str].failure(
            "VALIDATION_ERROR",
            "bad",
            details={"field": "x"},
            trace_id="trace-9",
        )
        assert resp.error is not None
        assert resp.error.details == {"field": "x"}
        assert resp.trace_id == "trace-9"

    def test_failure_model_dump_roundtrip(self) -> None:
        resp = ApiResponse[_Inner].failure("CONFLICT", "dup", trace_id="t")
        assert resp.model_dump() == {
            "ok": False,
            "data": None,
            "error": {"code": "CONFLICT", "message": "dup", "details": None},
            "trace_id": "t",
        }


class TestApiResponseDirectConstruction:
    def test_defaults_when_only_ok_supplied(self) -> None:
        resp = ApiResponse[str](ok=True)
        assert resp.data is None
        assert resp.error is None
        assert resp.trace_id is None

    def test_ok_required(self) -> None:
        with pytest.raises(ValidationError):
            ApiResponse[str]()  # type: ignore[call-arg]


class TestPaginatedResponse:
    def _resp(self, total: int, page_size: int) -> PaginatedResponse[str]:
        return PaginatedResponse[str](
            items=[],
            total=total,
            page=1,
            page_size=page_size,
            has_more=False,
        )

    def test_total_pages_zero_total(self) -> None:
        assert self._resp(total=0, page_size=10).total_pages == 0

    def test_total_pages_exact_multiple(self) -> None:
        assert self._resp(total=20, page_size=10).total_pages == 2

    def test_total_pages_rounds_up_on_remainder(self) -> None:
        # ceil(21 / 10) == 3
        assert self._resp(total=21, page_size=10).total_pages == 3

    def test_total_pages_single_partial_page(self) -> None:
        assert self._resp(total=1, page_size=10).total_pages == 1

    def test_total_pages_formula_matches_ceil_div(self) -> None:
        for total, page_size, expected in [
            (0, 5, 0),
            (5, 5, 1),
            (6, 5, 2),
            (99, 10, 10),
            (100, 10, 10),
            (101, 10, 11),
        ]:
            assert self._resp(total, page_size).total_pages == expected

    def test_construction_with_inner_items(self) -> None:
        resp = PaginatedResponse[_Inner](
            items=[_Inner(name="a", count=1)],
            total=1,
            page=1,
            page_size=25,
            has_more=False,
        )
        assert resp.items[0].name == "a"
        assert resp.total_pages == 1

    def test_required_fields_enforced(self) -> None:
        with pytest.raises(ValidationError):
            PaginatedResponse[str](items=[], total=0, page=1)  # type: ignore[call-arg]


class TestHealthResponse:
    def test_defaults(self) -> None:
        health = HealthResponse()
        assert health.status == "healthy"
        assert health.version == "0.1.0"

    def test_overrides(self) -> None:
        health = HealthResponse(status="degraded", version="9.9.9")
        assert health.status == "degraded"
        assert health.version == "9.9.9"

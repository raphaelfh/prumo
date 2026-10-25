"""Errors the screening services raise for a state that refuses the request."""

from __future__ import annotations

from app.core.error_handler import AppError
from app.schemas.common import ApiErrorCode


class ScreeningStateError(AppError):
    """A 409: the screening state does not allow this request."""

    def __init__(self, code: ApiErrorCode, message: str) -> None:
        super().__init__(code=code.value, message=message, status_code=409)


class ScreeningSelfArbitrationError(AppError):
    """A 403: the arbitrator holds a seat on the record, so they may not rule on it."""

    def __init__(self) -> None:
        super().__init__(
            code=ApiErrorCode.SCREENING_SELF_ARBITRATION.value,
            message="You reviewed this record, so another arbitrator must rule on it.",
            status_code=403,
        )

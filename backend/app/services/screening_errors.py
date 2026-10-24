"""Errors the screening services raise for a state that refuses the request."""

from __future__ import annotations

from app.core.error_handler import AppError
from app.schemas.common import ApiErrorCode


class ScreeningStateError(AppError):
    """A 409: the screening state does not allow this request."""

    def __init__(self, code: ApiErrorCode, message: str) -> None:
        super().__init__(code=code.value, message=message, status_code=409)

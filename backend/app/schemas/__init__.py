# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""Schemas module - Pydantic models for request/response."""

from app.schemas.common import ApiResponse, ErrorDetail, PaginatedResponse

__all__ = ["ApiResponse", "ErrorDetail", "PaginatedResponse"]


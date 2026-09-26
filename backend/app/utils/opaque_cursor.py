"""Opaque keyset-pagination cursor: base64url of a compact JSON array.

No server-side cursor state: the values ARE the cursor. Callers never trust a
decoded cursor as already scoped to the caller -- every page query re-applies
its own `project_id` scope, so a tampered cursor only pages inside that scope
(spec §5.1).
"""

from __future__ import annotations

import base64
import json
import math
from collections.abc import Sequence
from uuid import UUID


class InvalidCursorError(ValueError):
    """A cursor string that does not decode to a well-formed value list."""


def encode_cursor(values: Sequence[str | int]) -> str:
    raw = json.dumps(list(values), separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def decode_cursor(cursor: str | None, *, arity: int) -> list[str | int] | None:
    if cursor is None:
        return None
    padded = cursor + "=" * (-len(cursor) % 4)
    try:
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        values = json.loads(raw)
    except ValueError as exc:
        raise InvalidCursorError("cursor is not a valid opaque cursor") from exc
    if not isinstance(values, list) or len(values) != arity:
        raise InvalidCursorError("cursor is not a valid opaque cursor")
    for value in values:
        if isinstance(value, bool) or not isinstance(value, str | int):
            raise InvalidCursorError("cursor is not a valid opaque cursor")
    return values


# Typed readers for ONE decoded cursor value: a malformed value inside a
# well-formed cursor is the caller's `InvalidCursorError` (-> INVALID_ARGUMENT),
# never a `ValueError` from a cast or a Postgres CAST error (-> INTERNAL_ERROR).


def cursor_uuid(value: str | int) -> UUID:
    try:
        return UUID(str(value))
    except ValueError as exc:
        raise InvalidCursorError("cursor is not a valid opaque cursor") from exc


def cursor_position(value: str | int) -> int:
    """A non-negative int: a negative position would wrap a Python index."""
    if not isinstance(value, int) or value < 0:
        raise InvalidCursorError("cursor is not a valid opaque cursor")
    return value


def cursor_rank(value: str | int) -> float:
    try:
        rank = float(value)
    except ValueError as exc:
        raise InvalidCursorError("cursor is not a valid opaque cursor") from exc
    if not math.isfinite(rank):
        raise InvalidCursorError("cursor is not a valid opaque cursor")
    return rank

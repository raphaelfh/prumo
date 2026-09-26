"""Opaque keyset-pagination cursor: base64url of a compact JSON array.

No server-side cursor state: the values ARE the cursor. Callers never trust a
decoded cursor as already scoped to the caller -- every page query re-applies
its own `project_id` scope, so a tampered cursor only pages inside that scope
(spec §5.1).
"""

from __future__ import annotations

import base64
import json
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


# Postgres bounds a decoded value must fit before it is bound to a query:
# `integer` columns (page, block index) and the `real` a search rank is
# compared as. `_REAL_MIN` is the smallest normal float4 -- a smaller nonzero
# rank underflows the CAST; ts_rank never yields one (its floor is 1e-20).
_INT4_MAX = 2**31 - 1
_REAL_MAX = 3.4028234663852886e38
_REAL_MIN = 1.1754943508222875e-38


def cursor_position(value: str | int) -> int:
    """A non-negative int4: a negative position would wrap a Python index,
    and one past 2^31-1 overflows the Postgres `integer` it is compared to."""
    if not isinstance(value, int) or not 0 <= value <= _INT4_MAX:
        raise InvalidCursorError("cursor is not a valid opaque cursor")
    return value


def cursor_rank(value: str | int) -> float:
    """A float inside Postgres `real` range (0 or a normal float4)."""
    try:
        rank = float(value)
    except (ValueError, OverflowError) as exc:  # OverflowError: an int past float range
        raise InvalidCursorError("cursor is not a valid opaque cursor") from exc
    if not (rank == 0 or _REAL_MIN <= abs(rank) <= _REAL_MAX):  # also rejects nan/inf
        raise InvalidCursorError("cursor is not a valid opaque cursor")
    return rank


def cursor_text(value: str | int) -> str:
    """A str Postgres `text` can hold: no NUL, and valid UTF-8 (a JSON
    `\\ud800` escape decodes to a lone surrogate the driver cannot encode)."""
    if not isinstance(value, str) or "\x00" in value:
        raise InvalidCursorError("cursor is not a valid opaque cursor")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise InvalidCursorError("cursor is not a valid opaque cursor") from exc
    return value

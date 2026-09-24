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

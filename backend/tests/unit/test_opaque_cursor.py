"""opaque_cursor: base64url-of-JSON keyset cursor, no server state (spec §5.1)."""

from __future__ import annotations

import base64
import json

import pytest

from app.utils.opaque_cursor import InvalidCursorError, decode_cursor, encode_cursor


def test_round_trips_str_and_int_values() -> None:
    values = ["Title é", "0f0e" + "0" * 28]
    assert decode_cursor(encode_cursor(values), arity=2) == values


def test_decode_none_is_none() -> None:
    assert decode_cursor(None, arity=2) is None


def test_garbage_raises() -> None:
    with pytest.raises(InvalidCursorError):
        decode_cursor("!!", arity=2)


def test_valid_base64_of_non_json_raises() -> None:
    cursor = base64.urlsafe_b64encode(b"not json").rstrip(b"=").decode("ascii")
    with pytest.raises(InvalidCursorError):
        decode_cursor(cursor, arity=2)


def test_wrong_arity_raises() -> None:
    cursor = encode_cursor(["only-one"])
    with pytest.raises(InvalidCursorError):
        decode_cursor(cursor, arity=2)


def test_non_list_json_raises() -> None:
    raw = json.dumps({"a": 1}).encode()
    cursor = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
    with pytest.raises(InvalidCursorError):
        decode_cursor(cursor, arity=1)

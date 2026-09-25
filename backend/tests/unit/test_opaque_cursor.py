"""opaque_cursor: base64url-of-JSON keyset cursor, no server state (spec §5.1)."""

from __future__ import annotations

import base64
import json

import pytest

from app.utils.opaque_cursor import (
    InvalidCursorError,
    cursor_position,
    cursor_rank,
    cursor_text,
    decode_cursor,
    encode_cursor,
)


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


# Typed value readers: a forged value that decodes fine but cannot reach SQL
# (int4 overflow, a `real` out of range, a NUL in text) is InvalidCursorError.


@pytest.mark.parametrize("value", [0, 1, 2**31 - 1])
def test_cursor_position_accepts_int4_range(value: int) -> None:
    assert cursor_position(value) == value


@pytest.mark.parametrize("value", [-1, 2**31, 10**20, "1", 1.5])
def test_cursor_position_rejects_out_of_range(value: object) -> None:
    with pytest.raises(InvalidCursorError):
        cursor_position(value)  # type: ignore[arg-type]


@pytest.mark.parametrize("value", ["0", "0.0607927", "1e-20", repr(3.4e38), 1])
def test_cursor_rank_accepts_real_range(value: str | int) -> None:
    assert cursor_rank(value) == float(value)


@pytest.mark.parametrize(
    "value", ["1e300", "-1e300", "1e-300", "1e-40", "nan", "inf", "x", 10**400]
)
def test_cursor_rank_rejects_outside_real_range(value: str | int) -> None:
    with pytest.raises(InvalidCursorError):
        cursor_rank(value)


@pytest.mark.parametrize("value", ["", "Title é", "漢字"])
def test_cursor_text_accepts_plain_str(value: str) -> None:
    assert cursor_text(value) == value


@pytest.mark.parametrize("value", ["a\x00b", "\ud800", 5])
def test_cursor_text_rejects_nul_surrogate_and_non_str(value: str | int) -> None:
    with pytest.raises(InvalidCursorError):
        cursor_text(value)

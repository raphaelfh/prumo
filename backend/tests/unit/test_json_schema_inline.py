"""inline_json_schema: no `$ref`/`$defs` survives, a discriminator keeps only its property."""

from __future__ import annotations

import json
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.utils.json_schema import inline_json_schema


class _A(BaseModel):
    kind: Literal["a"]
    x: int


class _B(BaseModel):
    kind: Literal["b"]
    y: str


def test_refs_are_inlined_and_discriminator_mapping_dropped() -> None:
    schema = inline_json_schema(list[Annotated[_A | _B, Field(discriminator="kind")]])
    text = json.dumps(schema)
    assert "$ref" not in text and "$defs" not in text
    items = schema["items"]
    assert items["discriminator"] == {"propertyName": "kind"}
    assert [b["properties"]["kind"]["const"] for b in items["oneOf"]] == ["a", "b"]

"""A self-contained JSON Schema for a type: every ``$ref`` inlined.

An MCP tool argument annotated ``WithJsonSchema(...)`` is copied verbatim
into the tool's ``inputSchema``, where a ``#/$defs/...`` reference would
dangle; inlining keeps the advertised shape readable by any client."""

from __future__ import annotations

from typing import Any

from pydantic import TypeAdapter


def inline_json_schema(tp: Any) -> dict[str, Any]:
    schema = TypeAdapter(tp).json_schema()
    defs: dict[str, Any] = schema.pop("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str):
                return resolve(defs[ref.removeprefix("#/$defs/")])
            out = {k: resolve(v) for k, v in node.items()}
            if isinstance(out.get("discriminator"), dict):
                # `mapping` values are `$defs` pointers too; the branches carry `op` themselves.
                out["discriminator"] = {"propertyName": out["discriminator"]["propertyName"]}
            return out
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    result: dict[str, Any] = resolve(schema)
    return result

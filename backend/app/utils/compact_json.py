"""The one JSON serializer every MCP result's text copy and size accounting
share (task 2c; moved to `app/utils` in the 8b fix round so a service may
import it too -- `app/api/mcp/` is api-layer, and `services -> api` is a
layering violation `check_layered_arch.py` catches).

``CallToolResult.content``'s ``TextContent.text`` must be the exact same JSON
as ``structuredContent`` (spec §5.0), compact (no newlines/indentation) --
never the SDK's own ``indent=2`` default (`get_article_pdf` alone swaps its
signed URL for a pointer in that copy; the URL stays in structuredContent and
its resource_link). The 32,000-char per-result cap is
measured on this same rendering (`templates.py::_json_len`, the
`test_response_size_cap_*` tests): a different serializer here would let a
page clear one measure while exceeding the other.

Non-ASCII is rendered raw (``ensure_ascii=False``): an accented or CJK
character costs one char of the cap, as it does in the agent's context,
instead of a six-char ``\\uXXXX`` escape. JSON escaping still applies to
quotes, backslashes and control characters, so a value's rendered length can
exceed its raw length: budget on ``len(compact_json(...))``, never on a raw
string length or on ``pydantic.BaseModel.model_dump_json()`` (no separators,
so it under-counts the rendering measured here).
"""

from __future__ import annotations

import json
from typing import Any

RESULT_CAP = 32_000
"""Spec §5.0: every structured tool result, measured as `compact_json`."""


def compact_json(data: Any) -> str:
    """``json.dumps`` default separators (``", "`` / ``": "``), one line,
    non-ASCII raw."""
    return json.dumps(data, ensure_ascii=False)

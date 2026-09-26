"""The one JSON serializer every MCP result's text copy and size accounting
share (task 2c; moved to `app/utils` in the 8b fix round so a service may
import it too -- `app/api/mcp/` is api-layer, and `services -> api` is a
layering violation `check_layered_arch.py` catches).

``CallToolResult.content``'s ``TextContent.text`` must be the exact same JSON
as ``structuredContent`` (spec §5.0), compact (no newlines/indentation) --
never the SDK's own ``indent=2`` default. The 32,000-char per-result cap is
measured on this same rendering (`templates.py::_json_len`, the
`test_response_size_cap_*` tests): a different serializer here would let a
page clear one measure while exceeding the other.

Never substitute ``pydantic.BaseModel.model_dump_json()`` for this in a
budget calculation: it renders non-ASCII as raw UTF-8 bytes and uses no
separators, so it under-counts a page that `compact_json` (default
``json.dumps`` separators, ``ensure_ascii=True``) will render up to ~6x
longer per non-ASCII character (Task 8b fix round, finding B1).
"""

from __future__ import annotations

import json
from typing import Any

RESULT_CAP = 32_000
"""Spec §5.0: every structured tool result, measured as `compact_json`."""


def compact_json(data: Any) -> str:
    """``json.dumps`` default separators (``", "`` / ``": "``), one line."""
    return json.dumps(data)

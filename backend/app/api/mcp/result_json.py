"""The one JSON serializer every MCP result's text copy and size accounting
share (task 2c).

`CallToolResult.content`'s ``TextContent.text`` must be the exact same JSON
as ``structuredContent`` (spec §5.0), compact (no newlines/indentation) --
never the SDK's own ``indent=2`` default. The 32,000-char per-result cap is
measured on this same rendering (`templates.py::_json_len`, the
`test_response_size_cap_*` tests): a different serializer here would let a
page clear one measure while exceeding the other.
"""

from __future__ import annotations

import json
from typing import Any


def compact_json(data: Any) -> str:
    """``json.dumps`` default separators (``", "`` / ``": "``), one line."""
    return json.dumps(data)

"""Importing this package registers every MCP tool (each module's @agent_tool
runs at import). A new tool module is added to this import line."""

from app.api.mcp.tools import projects  # noqa: F401

"""Append-only audit of MCP agent writes (spec §6.1, constitution §IX).

Insert only: nothing here updates or deletes a row. Callers own the
transaction: an applied write calls ``record_applied`` inside its own
transaction before its single commit; a refusal rolls back first, then
calls ``record_refused``, then commits, so the refusal row survives
while the refused write does not.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_action import AgentAction

_INPUT_CHECK_BYTES = 65_536
# jsonb's text form can renormalize numbers (1e3 -> 1000), so the stored text may
# be slightly longer than our measurement; the headroom keeps the table CHECK
# from ever turning an audit insert into a failure.
_INPUT_HEADROOM_BYTES = 4_096


def _bounded_input(tool_input: dict[str, Any]) -> dict[str, Any]:
    canonical = json.dumps(tool_input, ensure_ascii=False, sort_keys=True, separators=(", ", ": "))
    raw = canonical.encode("utf-8")
    # jsonb rejects U+0000 (the refusal that names it must still persist): such
    # an input is stored as its digest, like an oversized one.
    if len(raw) <= _INPUT_CHECK_BYTES - _INPUT_HEADROOM_BYTES and "\\u0000" not in canonical:
        return tool_input
    return {"truncated": True, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


async def _insert(db: AsyncSession, **values: Any) -> AgentAction:
    row = AgentAction(**values)
    db.add(row)
    await db.flush()
    await db.refresh(row, ["created_at"])
    return row


async def record_applied(
    db: AsyncSession,
    *,
    token_id: UUID,
    user_id: UUID,
    project_id: UUID,
    template_id: UUID | None,
    tool: str,
    tool_input: dict[str, Any],
    before: dict[str, Any],
    after: dict[str, Any],
) -> AgentAction:
    """Record one applied MCP write. Call inside the write's own transaction,
    before the caller's single commit."""
    return await _insert(
        db,
        token_id=token_id,
        user_id=user_id,
        project_id=project_id,
        template_id=template_id,
        tool=tool,
        input=_bounded_input(tool_input),
        before=before,
        after=after,
        outcome="applied",
        error_code=None,
    )


async def record_refused(
    db: AsyncSession,
    *,
    token_id: UUID,
    user_id: UUID,
    project_id: UUID,
    template_id: UUID | None,
    tool: str,
    tool_input: dict[str, Any],
    error_code: str,
) -> AgentAction:
    """Record one domain-rule refusal. The caller rolls back its write
    first, calls this, then commits."""
    return await _insert(
        db,
        token_id=token_id,
        user_id=user_id,
        project_id=project_id,
        template_id=template_id,
        tool=tool,
        input=_bounded_input(tool_input),
        before=None,
        after=None,
        outcome="refused",
        error_code=error_code,
    )

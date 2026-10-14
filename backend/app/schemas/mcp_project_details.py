"""``update_project_details`` output shape (spec §5.2)."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel


class UpdateProjectDetailsResult(BaseModel):
    """What ``update_project_details`` changed. ``before``/``after`` carry only the keys in ``fields``."""

    project_id: UUID
    before: dict[str, Any]
    after: dict[str, Any]
    note: str | None = None
    untrusted_content: Literal[True] = True
    untrusted_fields: list[str] = [
        "before{}",
        "after{}",
    ]

"""Schemas for the per-project parser-backend setting."""

from typing import Literal

from pydantic import BaseModel

# "auto" (default) = LlamaParse cloud when a key is configured, else Docling.
# "standard" is the legacy self-hosted opt-out; it normalises to "docling".
ParserType = Literal["auto", "standard", "llamaparse", "docling"]


class ParserSettingsPayload(BaseModel):
    type: ParserType


class ParserSettingsRead(BaseModel):
    type: ParserType

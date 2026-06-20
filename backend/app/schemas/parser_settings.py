"""Schemas for the per-project parser-backend setting."""

from typing import Literal

from pydantic import BaseModel

ParserType = Literal["standard", "llamaparse"]


class ParserSettingsPayload(BaseModel):
    type: ParserType


class ParserSettingsRead(BaseModel):
    type: ParserType

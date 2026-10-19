"""Bounded write shapes for the review protocol.

Eligibility criteria, study design and the PICOTS slots are JSONB columns. These
models bound what a writer may store; reads stay loose, because rows written
before the bounds existed can hold anything (see ``project_ai_context``).

Every field has a default, so a partial shape such as ``{"inclusion": []}``
validates. The ``notes`` fields are for the people configuring the review and
never reach prompts.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

_Criterion = Annotated[str, StringConstraints(min_length=1, max_length=500)]
_SlotCriterion = Annotated[str, StringConstraints(max_length=500)]
_DesignType = Annotated[str, StringConstraints(max_length=100)]

PicotsSlotKey = Literal[
    "population",
    "index_models",
    "comparator_models",
    "outcomes",
    "timing",
    "setting_and_intended_use",
]


class EligibilityCriteria(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inclusion: list[_Criterion] = Field(default_factory=list, max_length=50)
    exclusion: list[_Criterion] = Field(default_factory=list, max_length=50)
    notes: str = Field(default="", max_length=2000)


class StudyDesign(BaseModel):
    model_config = ConfigDict(extra="forbid")

    types: list[_DesignType] = Field(default_factory=list, max_length=30)
    notes: str = Field(default="", max_length=2000)


class PicotsSlotWrite(BaseModel):
    """One PICOTS slot as written. The read model (``PicotsSlot``) stays unbounded."""

    model_config = ConfigDict(extra="forbid")

    description: str = Field(default="", max_length=2000)
    inclusion: list[_SlotCriterion] = Field(default_factory=list, max_length=50)
    exclusion: list[_SlotCriterion] = Field(default_factory=list, max_length=50)


class PicotsSlotsWrite(BaseModel):
    """The six slots as written; an omitted slot is written empty."""

    model_config = ConfigDict(extra="forbid")

    population: PicotsSlotWrite = Field(default_factory=PicotsSlotWrite)
    index_models: PicotsSlotWrite = Field(default_factory=PicotsSlotWrite)
    comparator_models: PicotsSlotWrite = Field(default_factory=PicotsSlotWrite)
    outcomes: PicotsSlotWrite = Field(default_factory=PicotsSlotWrite)
    timing: PicotsSlotWrite = Field(default_factory=PicotsSlotWrite)
    setting_and_intended_use: PicotsSlotWrite = Field(default_factory=PicotsSlotWrite)

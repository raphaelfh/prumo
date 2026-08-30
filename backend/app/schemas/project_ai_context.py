"""Wire shapes for the project's AI review context (the PICOT editor).

The read model deliberately carries BOTH the stored slots and the labels the
prompt will use for them. The labels vary by ``review_type`` and use each
instrument's own wording — PROBAST+AI phrases its applicability items against
"index model(s)", not "intervention" — so the editor reads them from here
rather than keeping a second copy that can drift from the prompt.

``preview`` is the same string ``build_review_context`` hands the model, so a
manager cannot be shown text the AI did not get.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class PicotsSlot(BaseModel):
    """One PICOTS slot. Flat since migration 0063 — ``timing`` included."""

    description: str = ""
    inclusion: list[str] = Field(default_factory=list)
    exclusion: list[str] = Field(default_factory=list)


class PicotsSlots(BaseModel):
    """The six slots, in the instrument's P-I-C-O-T-S order."""

    population: PicotsSlot = Field(default_factory=PicotsSlot)
    index_models: PicotsSlot = Field(default_factory=PicotsSlot)
    comparator_models: PicotsSlot = Field(default_factory=PicotsSlot)
    outcomes: PicotsSlot = Field(default_factory=PicotsSlot)
    timing: PicotsSlot = Field(default_factory=PicotsSlot)
    setting_and_intended_use: PicotsSlot = Field(default_factory=PicotsSlot)


class ProjectAiContextRead(BaseModel):
    """What the editor renders: the slots, their labels, the switch, the preview."""

    picots: PicotsSlots
    #: slot key -> the exact label the prompt emits for this project's review type.
    labels: dict[str, str]
    review_type: str | None = None
    #: ``settings.ai_context.picots`` — absent means ON.
    picots_enabled: bool = True
    #: The rendered block a run started now would pin, or None when it says nothing.
    preview: str | None = None


class ProjectAiContextUpdate(BaseModel):
    """Both halves ride one write so they cannot disagree.

    Each field is optional: omitting ``picots`` changes only the switch and vice
    versa, which is what lets the toggle and the editor share one endpoint
    without either clobbering the other's value.
    """

    picots: PicotsSlots | None = None
    picots_enabled: bool | None = None

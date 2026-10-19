"""The one map from a prompt NAME to the kind of model pass it runs.

Snapshot ``passes_detail`` entries (and the usage ledger) classify a call by
its prompt name through this map and nowhere else. An unknown name is a
``KeyError``: a new prompt must be added here before it can be recorded.
"""

from typing import Literal

from app.llm import entailment, verify
from app.llm.prompts import entry_identification, quality_assessment, section_extraction

PassKind = Literal["extract", "identify", "verify", "entailment"]

PASS_KIND_BY_PROMPT: dict[str, PassKind] = {
    section_extraction.NAME: "extract",
    quality_assessment.NAME: "extract",
    entry_identification.NAME: "identify",
    verify.NAME: "verify",
    entailment.NAME: "entailment",
}

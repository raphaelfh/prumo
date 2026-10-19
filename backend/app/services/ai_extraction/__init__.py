"""AI extraction: a request payload in, proposals landed on a run out.

Interface:

- :class:`AiExtraction` — ``AiExtraction(db, user_id, storage, trace_id, ...)
  .run_from_request(request, engine)``, the one entry point (the Celery
  extraction task). Section, entry-group, ancestry, verify, field-filter and
  provenance steps are private to this package.
- :class:`ProposalLanding` — the one seam every AI candidate lands through:
  one ``open_run_for_write``, one stage gate, one coordinate bind, N proposal
  rows + evidence.

Seams to the outside: the model call is ``app.llm.extractor.StructuredCall``
(pydantic-ai in production, ``tests/fakes/recorded_llm.py`` in tests); prompts
live in ``app.llm.prompts``.
"""

from app.services.ai_extraction._results import (
    BatchAllSectionsFailed,
    BatchExtractionResult,
    SectionExtractionResult,
)
from app.services.ai_extraction.landing import (
    Generation,
    InvalidProposalError,
    ProposalCandidate,
    ProposalLanding,
    SingletonSlot,
)
from app.services.ai_extraction.service import AiExtraction

__all__ = [
    "AiExtraction",
    "BatchAllSectionsFailed",
    "BatchExtractionResult",
    "Generation",
    "InvalidProposalError",
    "ProposalCandidate",
    "ProposalLanding",
    "SectionExtractionResult",
    "SingletonSlot",
]

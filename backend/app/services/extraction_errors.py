"""Error-code taxonomy for async section extraction.

The Celery extraction task can fail in a few distinct ways the frontend wants
to surface differently (missing PDF, missing LLM key, everything else). This
module turns the *exception types* the pipeline raises into a stable
``ExtractionErrorCode`` and wraps them in ``ExtractionTaskError`` so the code
survives the Celery JSON result boundary — the status endpoint reads it back
without parsing the exception repr.
"""

from __future__ import annotations

from app.schemas.extraction import ExtractionErrorCode

# Default human message when a generic failure carries no usable text of its own.
_GENERIC_MESSAGE = "Section extraction failed."


class ExtractionTaskError(Exception):
    """Terminal extraction failure carrying a machine-readable code.

    Celery's result backend serializes exceptions as JSON (it stores
    ``exc.args``) and reconstructs them with ``cls(*args)``. Keeping the code
    as the first positional arg — and rebuilding ``error_code`` from it in
    ``__init__`` — lets the status endpoint recover the code after the
    worker→web round-trip, with no exception-repr parsing.
    """

    def __init__(self, error_code: ExtractionErrorCode | str, message: str = "") -> None:
        # Store the plain string value (not the enum) so the JSON-serialized
        # args stay primitive and the reconstruction is exact.
        self.error_code: str = (
            error_code.value if isinstance(error_code, ExtractionErrorCode) else str(error_code)
        )
        self.message: str = message
        super().__init__(self.error_code, message)

    def __str__(self) -> str:
        # The human-facing message, never the (code, message) tuple repr.
        return self.message or self.error_code


def classify_extraction_error(exc: BaseException) -> tuple[ExtractionErrorCode, str]:
    """Map a raised exception to ``(code, human_message)``.

    Type-based — never string-matches the exception repr. Anything without a
    known type maps to ``EXTRACTION_FAILED`` with its own message.
    """
    # Lazy import: ``app.llm.provider`` pulls in pydantic-ai model classes, and
    # this module is imported on the API process too (only for the enum/type).
    from app.llm.provider import MissingLLMKeyError

    if isinstance(exc, MissingLLMKeyError):
        # The provider message already tells the user how to fix it (BYOK key
        # or env var) — keep it verbatim.
        return ExtractionErrorCode.MISSING_API_KEY, str(exc).strip() or _GENERIC_MESSAGE

    if isinstance(exc, FileNotFoundError):
        # The raw message is "No PDF for article <uuid>"; surface the friendly,
        # actionable copy the pre-async endpoint used instead.
        return ExtractionErrorCode.PDF_NOT_FOUND, "PDF not found. Upload a PDF first."

    return ExtractionErrorCode.EXTRACTION_FAILED, str(exc).strip() or _GENERIC_MESSAGE

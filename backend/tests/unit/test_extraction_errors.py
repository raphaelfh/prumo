"""Unit tests for the extraction error-code taxonomy.

``classify_extraction_error`` maps the *types* the extraction pipeline can
raise to a stable ``ExtractionErrorCode`` (no exception-repr parsing), and
``ExtractionTaskError`` carries that code across the Celery JSON result
boundary so the status endpoint can surface specific frontend copy.
"""

from __future__ import annotations

from app.llm.provider import MissingLLMKeyError
from app.schemas.extraction import ExtractionErrorCode
from app.services.extraction_errors import (
    ExtractionTaskError,
    classify_extraction_error,
)


class TestClassifyExtractionError:
    def test_file_not_found_maps_to_pdf_not_found(self) -> None:
        code, message = classify_extraction_error(FileNotFoundError("No PDF for article 1234"))
        assert code is ExtractionErrorCode.PDF_NOT_FOUND
        # Friendly, actionable copy — not the raw "No PDF for article <uuid>".
        assert message == "PDF not found. Upload a PDF first."

    def test_missing_llm_key_maps_to_missing_api_key(self) -> None:
        code, message = classify_extraction_error(
            MissingLLMKeyError("No OpenAI API key available: pass a BYOK key.")
        )
        assert code is ExtractionErrorCode.MISSING_API_KEY
        # The provider message is already actionable — pass it through.
        assert message == "No OpenAI API key available: pass a BYOK key."

    def test_unknown_error_maps_to_generic(self) -> None:
        code, message = classify_extraction_error(RuntimeError("llm exploded"))
        assert code is ExtractionErrorCode.EXTRACTION_FAILED
        assert message == "llm exploded"

    def test_blank_message_falls_back_to_default(self) -> None:
        code, message = classify_extraction_error(ValueError("   "))
        assert code is ExtractionErrorCode.EXTRACTION_FAILED
        assert message == "Section extraction failed."


class TestExtractionTaskError:
    def test_carries_code_and_message(self) -> None:
        err = ExtractionTaskError(ExtractionErrorCode.PDF_NOT_FOUND, "PDF not found.")
        # error_code is a plain string (enum value) so JSON args stay clean.
        assert err.error_code == "PDF_NOT_FOUND"
        assert err.message == "PDF not found."
        # str() is the human message, never the (code, message) tuple repr.
        assert str(err) == "PDF not found."

    def test_accepts_plain_string_code(self) -> None:
        err = ExtractionTaskError("MISSING_API_KEY", "no key")
        assert err.error_code == "MISSING_API_KEY"
        assert str(err) == "no key"

    def test_survives_celery_json_round_trip(self) -> None:
        """The Celery result backend serializes exceptions as JSON (exc.args)
        and reconstructs them via ``cls(*args)``. The code must survive that
        round-trip so the status endpoint can read it after worker→web."""
        from celery.backends.base import Backend

        from app.worker.celery_app import celery_app

        backend = Backend(app=celery_app, serializer="json")
        original = ExtractionTaskError(
            ExtractionErrorCode.MISSING_API_KEY, "No OpenAI API key available."
        )

        rebuilt = backend.exception_to_python(backend.prepare_exception(original))

        assert isinstance(rebuilt, ExtractionTaskError)
        assert rebuilt.error_code == "MISSING_API_KEY"
        assert str(rebuilt) == "No OpenAI API key available."

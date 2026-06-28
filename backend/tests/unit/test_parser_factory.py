from types import SimpleNamespace

from app.core.factories import create_document_parser
from app.infrastructure.parsing.docling_parser import DoclingParser
from app.infrastructure.parsing.fallback_parser import FallbackDocumentParser
from app.infrastructure.parsing.llamaparse_parser import LlamaParseParser
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser


def test_default_backend_is_pymupdf():
    p = create_document_parser(SimpleNamespace(PARSER_BACKEND="pymupdf"))
    assert isinstance(p, PymupdfParser)


def test_llamaparse_without_key_falls_back_to_pymupdf():
    p = create_document_parser(
        SimpleNamespace(PARSER_BACKEND="llamaparse", LLAMA_CLOUD_API_KEY=None)
    )
    assert isinstance(p, PymupdfParser)


def test_llamaparse_with_key_wraps_fallback_to_pymupdf():
    # The cloud parser is wrapped so a timeout/error degrades to PyMuPDF
    # instead of leaving the file stuck at "pending".
    p = create_document_parser(
        SimpleNamespace(PARSER_BACKEND="llamaparse", LLAMA_PARSE_TIMEOUT_SECONDS=120.0),
        llama_cloud_key="k",
    )
    assert isinstance(p, FallbackDocumentParser)
    assert isinstance(p.primary, LlamaParseParser)
    assert isinstance(p.fallback, PymupdfParser)


def test_llamaparse_primary_receives_configured_timeout():
    p = create_document_parser(
        SimpleNamespace(PARSER_BACKEND="llamaparse", LLAMA_PARSE_TIMEOUT_SECONDS=42.0),
        llama_cloud_key="k",
    )
    assert isinstance(p, FallbackDocumentParser)
    assert p.primary.timeout == 42.0


def test_docling_is_opt_in_only():
    p = create_document_parser(SimpleNamespace(PARSER_BACKEND="docling"))
    assert isinstance(p, DoclingParser)


def test_unknown_backend_falls_back_to_pymupdf():
    p = create_document_parser(SimpleNamespace(PARSER_BACKEND="nope"))
    assert isinstance(p, PymupdfParser)

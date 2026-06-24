# backend/tests/unit/test_create_document_parser.py
from types import SimpleNamespace

from app.core.factories import create_document_parser
from app.infrastructure.parsing.llamaparse_parser import LlamaParseParser
from app.infrastructure.parsing.pymupdf_parser import PymupdfParser


def _settings(backend="pymupdf", llama_key=None):
    return SimpleNamespace(PARSER_BACKEND=backend, LLAMA_CLOUD_API_KEY=llama_key)


def test_default_backend_is_pymupdf():
    parser = create_document_parser(_settings())
    assert isinstance(parser, PymupdfParser)


def test_llamaparse_with_key():
    parser = create_document_parser(
        _settings(backend="llamaparse", llama_key="lc-key"),
        llama_cloud_key="lc-key",
    )
    assert isinstance(parser, LlamaParseParser)


def test_llamaparse_without_key_falls_back_to_pymupdf():
    parser = create_document_parser(
        _settings(backend="llamaparse", llama_key=None),
        llama_cloud_key=None,
    )
    assert isinstance(parser, PymupdfParser)


def test_unknown_backend_falls_back_to_pymupdf():
    parser = create_document_parser(_settings(backend="bogus"))
    assert isinstance(parser, PymupdfParser)

"""Fallback DocumentParser — degrade to a secondary parser on primary failure.

The cloud LlamaParse path can time out, error, or (worst case) block for a
long time before failing. When it does, we must not leave the ArticleFile
stuck at ``pending`` forever (the original "won't stop loading" bug). This
adapter wraps a *primary* parser (LlamaParse) and a *fallback* parser
(PyMuPDF): on any primary exception it logs and retries with the fallback,
so the document still gets parsed — just at the local parser's quality.

Both parsers implement the DocumentParser port, so this composes cleanly and
the DocumentParsingService stays unaware of the fallback.
"""

from __future__ import annotations

from app.core.logging import get_logger
from app.infrastructure.parsing.base import DocumentParser, ParsedBlock

_logger = get_logger(__name__)


class FallbackDocumentParser(DocumentParser):
    """Try ``primary``; on any failure, parse with ``fallback`` instead."""

    def __init__(self, *, primary: DocumentParser, fallback: DocumentParser) -> None:
        self.primary = primary
        self.fallback = fallback

    def parse(self, pdf_bytes: bytes) -> list[ParsedBlock]:
        try:
            return self.primary.parse(pdf_bytes)
        except Exception as exc:
            # Degrade, do NOT swallow: log the primary failure, then let the
            # fallback run. If the fallback ALSO raises, that error propagates
            # so the service marks the file parse_failed (never silently lost).
            _logger.warning(
                "document_parser_fallback",
                primary=type(self.primary).__name__,
                fallback=type(self.fallback).__name__,
                error=str(exc),
            )
            return self.fallback.parse(pdf_bytes)

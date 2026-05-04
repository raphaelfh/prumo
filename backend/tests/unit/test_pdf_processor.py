"""
PDF Processor Unit Tests.
"""

import pytest

from app.services.pdf_processor import PageContent, PDFMetadata, PDFProcessor, TextChunk


@pytest.fixture
def pdf_processor() -> PDFProcessor:
    """Fixture para instância do PDFProcessor."""
    return PDFProcessor()


@pytest.fixture
def valid_pdf_bytes() -> bytes:
    """
    Fixture com PDF válido para testes.

    Este é um PDF mínimo válido com uma página contendo "Test PDF".
    """
    return b"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 44 >> stream
BT /F1 12 Tf 100 700 Td (Test PDF Content) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000270 00000 n 
0000000363 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
444
%%EOF"""


class TestPDFProcessor:
    """Testes para PDFProcessor."""

    @pytest.mark.asyncio
    async def test_extract_text_returns_string(
        self,
        pdf_processor: PDFProcessor,
        valid_pdf_bytes: bytes,
    ) -> None:
        """Test que extract_text retorna string."""
        text = await pdf_processor.extract_text(valid_pdf_bytes)

        assert isinstance(text, str)

    @pytest.mark.asyncio
    async def test_extract_pages_returns_list(
        self,
        pdf_processor: PDFProcessor,
        valid_pdf_bytes: bytes,
    ) -> None:
        """Test que extract_pages retorna lista de PageContent."""
        pages = await pdf_processor.extract_pages(valid_pdf_bytes)

        assert isinstance(pages, list)
        assert len(pages) >= 1
        assert all(isinstance(p, PageContent) for p in pages)

    @pytest.mark.asyncio
    async def test_get_metadata_returns_pdfmetadata(
        self,
        pdf_processor: PDFProcessor,
        valid_pdf_bytes: bytes,
    ) -> None:
        """Test que get_metadata retorna PDFMetadata."""
        metadata = await pdf_processor.get_metadata(valid_pdf_bytes)

        assert isinstance(metadata, PDFMetadata)
        assert metadata.pages >= 1
        assert isinstance(metadata.md5_hash, str)
        assert len(metadata.md5_hash) == 32  # MD5 tem 32 caracteres hex

    @pytest.mark.asyncio
    async def test_extract_text_chunked(
        self,
        pdf_processor: PDFProcessor,
        valid_pdf_bytes: bytes,
    ) -> None:
        """Test que extract_text_chunked retorna lista de chunks."""
        chunks = await pdf_processor.extract_text_chunked(
            valid_pdf_bytes,
            max_chars_per_chunk=1000,
        )

        assert isinstance(chunks, list)
        assert all(isinstance(c, TextChunk) for c in chunks)

    @pytest.mark.asyncio
    async def test_extract_text_invalid_pdf_raises_error(
        self,
        pdf_processor: PDFProcessor,
    ) -> None:
        """Test que PDF inválido levanta ValueError."""
        invalid_pdf = b"not a pdf file"

        with pytest.raises(ValueError, match="Failed to extract"):
            await pdf_processor.extract_text(invalid_pdf)

    def test_clean_text(self, pdf_processor: PDFProcessor) -> None:
        """Test limpeza de texto."""
        dirty_text = "Hello\x00World\n\n\n\nTest"

        clean = pdf_processor._clean_text(dirty_text)

        assert "\x00" not in clean
        assert "\n\n\n\n" not in clean

"""
PDF Processor Service.

Processamento avancado de files PDF:
- Extracao de texto por pagina
- Chunking inteligente
- Deteccao de sections
- Cache de texto extraido
"""

import hashlib
import io
import re
from dataclasses import dataclass
from typing import Any

from pypdf import PdfReader

from app.core.logging import LoggerMixin


@dataclass
class PageContent:
    """Conteudo de uma pagina do PDF."""

    page_number: int
    text: str
    char_count: int


@dataclass
class TextChunk:
    """Chunk de texto do PDF."""

    text: str
    start_page: int
    end_page: int
    char_count: int
    chunk_index: int


@dataclass
class PDFMetadata:
    """Metadata do PDF."""

    title: str | None = None
    author: str | None = None
    subject: str | None = None
    creator: str | None = None
    producer: str | None = None
    pages: int = 0
    total_chars: int = 0
    md5_hash: str = ""


class PDFProcessor(LoggerMixin):
    """
    Service for processamento avancado de PDFs.

    Extrai texto, metadata and faz chunking inteligente.
    """

    # Padroes for deteccao de sections
    SECTION_PATTERNS = [
        r"^(?:abstract|summary)\s*$",
        r"^(?:\d+\.?\s*)?introduction",
        r"^(?:\d+\.?\s*)?background",
        r"^(?:\d+\.?\s*)?methods?",
        r"^(?:\d+\.?\s*)?materials?\s+(?:and|&)\s+methods?",
        r"^(?:\d+\.?\s*)?results?",
        r"^(?:\d+\.?\s*)?discussion",
        r"^(?:\d+\.?\s*)?conclusion",
        r"^(?:\d+\.?\s*)?references?",
        r"^(?:\d+\.?\s*)?bibliography",
        r"^(?:\d+\.?\s*)?appendix",
        r"^(?:\d+\.?\s*)?supplementary",
    ]

    def __init__(self):
        self._compiled_patterns = [
            re.compile(p, re.IGNORECASE | re.MULTILINE) for p in self.SECTION_PATTERNS
        ]

    async def extract_text(self, pdf_data: bytes) -> str:
        """
        Extrai texto de um PDF.

        Args:
            pdf_data: Bytes do file PDF.

        Returns:
            Texto extraido do PDF with marcadores de pagina.
        """
        pages = await self.extract_pages(pdf_data)

        text_parts = []
        for page in pages:
            if page.text.strip():
                text_parts.append(f"[Page {page.page_number}]\n{page.text}")

        return "\n\n".join(text_parts)

    async def extract_pages(self, pdf_data: bytes) -> list[PageContent]:
        """
        Extrai texto de cada pagina do PDF.

        Args:
            pdf_data: Bytes do file PDF.

        Returns:
            List de PageContent with texto por pagina.
        """
        try:
            pdf_file = io.BytesIO(pdf_data)
            reader = PdfReader(pdf_file)

            pages = []
            for page_num, page in enumerate(reader.pages, 1):
                text = page.extract_text() or ""
                # Limpar texto
                text = self._clean_text(text)
                pages.append(
                    PageContent(
                        page_number=page_num,
                        text=text,
                        char_count=len(text),
                    )
                )

            total_chars = sum(p.char_count for p in pages)
            self.logger.info(
                "pdf_pages_extracted",
                pages=len(pages),
                total_chars=total_chars,
            )

            return pages

        except Exception as e:
            self.logger.error(
                "pdf_extraction_error",
                error=str(e),
            )
            raise ValueError(f"Failed to extract text from PDF: {e}") from e

    async def extract_text_chunked(
        self,
        pdf_data: bytes,
        max_chars_per_chunk: int = 8000,
        overlap_chars: int = 200,
    ) -> list[TextChunk]:
        """
        Extrai texto do PDF em chunks with overlap.

        Args:
            pdf_data: Bytes do file PDF.
            max_chars_per_chunk: Maximo de caracteres por chunk.
            overlap_chars: Caracteres de overlap entre chunks.

        Returns:
            List de TextChunk.
        """
        pages = await self.extract_pages(pdf_data)

        chunks: list[TextChunk] = []
        current_text = ""
        current_start_page = 1
        chunk_index = 0

        for page in pages:
            # Se adicionar esta pagina exceder o limite, criar novo chunk
            if len(current_text) + len(page.text) > max_chars_per_chunk and current_text:
                chunks.append(
                    TextChunk(
                        text=current_text,
                        start_page=current_start_page,
                        end_page=page.page_number - 1,
                        char_count=len(current_text),
                        chunk_index=chunk_index,
                    )
                )
                chunk_index += 1

                # Manter overlap do final do chunk anterior
                overlap = current_text[-overlap_chars:] if len(current_text) > overlap_chars else ""
                current_text = overlap
                current_start_page = page.page_number

            current_text += f"\n\n[Page {page.page_number}]\n{page.text}"

        # Adicionar ultimo chunk
        if current_text.strip():
            chunks.append(
                TextChunk(
                    text=current_text,
                    start_page=current_start_page,
                    end_page=pages[-1].page_number if pages else 1,
                    char_count=len(current_text),
                    chunk_index=chunk_index,
                )
            )

        self.logger.info(
            "pdf_chunked",
            chunks=len(chunks),
            max_chars=max_chars_per_chunk,
        )

        return chunks

    async def get_metadata(self, pdf_data: bytes) -> PDFMetadata:
        """
        Extrai metadata de um PDF.

        Args:
            pdf_data: Bytes do file PDF.

        Returns:
            PDFMetadata with informacoes do documento.
        """
        try:
            pdf_file = io.BytesIO(pdf_data)
            reader = PdfReader(pdf_file)

            metadata = reader.metadata or {}
            md5_hash = hashlib.md5(pdf_data).hexdigest()

            # Calcular total de caracteres
            total_chars = 0
            for page in reader.pages:
                text = page.extract_text() or ""
                total_chars += len(text)

            return PDFMetadata(
                title=getattr(metadata, "title", None),
                author=getattr(metadata, "author", None),
                subject=getattr(metadata, "subject", None),
                creator=getattr(metadata, "creator", None),
                producer=getattr(metadata, "producer", None),
                pages=len(reader.pages),
                total_chars=total_chars,
                md5_hash=md5_hash,
            )

        except Exception as e:
            self.logger.error(
                "pdf_metadata_error",
                error=str(e),
            )
            return PDFMetadata(pages=0, md5_hash="")

    async def detect_sections(self, text: str) -> list[dict[str, Any]]:
        """
        Detecta sections in the texto do PDF.

        Args:
            text: Texto do PDF.

        Returns:
            List de sections detectadas with posicao.
        """
        sections = []
        lines = text.split("\n")

        for i, line in enumerate(lines):
            line_clean = line.strip()
            if not line_clean or len(line_clean) > 100:
                continue

            for pattern in self._compiled_patterns:
                if pattern.match(line_clean):
                    sections.append(
                        {
                            "name": line_clean,
                            "line_number": i + 1,
                            "char_position": text.find(line),
                        }
                    )
                    break

        self.logger.info(
            "sections_detected",
            count=len(sections),
        )

        return sections

    async def extract_section_text(
        self,
        text: str,
        section_name: str,
        next_section_name: str | None = None,
    ) -> str:
        """
        Extrai texto de uma section especifica.

        Args:
            text: Texto completo do PDF.
            section_name: Nome da section a extrair.
            next_section_name: Nome da proxima section (para delimitar).

        Returns:
            Texto da section.
        """
        # Encontrar inicio da section
        pattern = re.compile(
            rf"^.*{re.escape(section_name)}.*$",
            re.IGNORECASE | re.MULTILINE,
        )
        match = pattern.search(text)

        if not match:
            return ""

        start_pos = match.end()

        # Encontrar fim da section
        if next_section_name:
            end_pattern = re.compile(
                rf"^.*{re.escape(next_section_name)}.*$",
                re.IGNORECASE | re.MULTILINE,
            )
            end_match = end_pattern.search(text[start_pos:])
            if end_match:
                return text[start_pos : start_pos + end_match.start()].strip()

        return text[start_pos:].strip()

    def _clean_text(self, text: str) -> str:
        """
        Limpa texto extraido do PDF.

        - Remove multiplos espacos em branco
        - Remove caracteres de controle
        - Normaliza quebras de linha
        """
        # Remover caracteres de controle exceto newlines and tabs
        text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)

        # Normalizar espacos multiplos (mas preservar quebras de linha)
        text = re.sub(r"[^\S\n]+", " ", text)

        # Remover linhas vazias excessivas
        text = re.sub(r"\n{3,}", "\n\n", text)

        return text.strip()

    def estimate_tokens(self, text: str) -> int:
        """
        Estima numero de tokens for um texto.

        Usa aproximacao de ~4 caracteres por token for ingles.

        Args:
            text: Texto for estimar.

        Returns:
            Numero estimado de tokens.
        """
        return len(text) // 4

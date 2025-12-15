# Copyright (c) 2025 Raphael Federicci Haddad.
# Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
# Commercial licenses are available upon request.

"""
PDF Processor Service.

Processamento de arquivos PDF para extração de texto.
"""

import io
from typing import Any

from pypdf import PdfReader

from app.core.logging import LoggerMixin


class PDFProcessor(LoggerMixin):
    """
    Service para processamento de PDFs.
    
    Extrai texto de PDFs usando pypdf.
    """
    
    async def extract_text(self, pdf_data: bytes) -> str:
        """
        Extrai texto de um PDF.
        
        Args:
            pdf_data: Bytes do arquivo PDF.
            
        Returns:
            Texto extraído do PDF.
        """
        try:
            pdf_file = io.BytesIO(pdf_data)
            reader = PdfReader(pdf_file)
            
            text_parts = []
            for page_num, page in enumerate(reader.pages, 1):
                page_text = page.extract_text() or ""
                if page_text.strip():
                    text_parts.append(f"[Page {page_num}]\n{page_text}")
            
            full_text = "\n\n".join(text_parts)
            
            self.logger.info(
                "pdf_text_extracted",
                pages=len(reader.pages),
                chars=len(full_text),
            )
            
            return full_text
            
        except Exception as e:
            self.logger.error(
                "pdf_extraction_error",
                error=str(e),
            )
            raise ValueError(f"Failed to extract text from PDF: {e}") from e
    
    async def get_metadata(self, pdf_data: bytes) -> dict[str, Any]:
        """
        Extrai metadados de um PDF.
        
        Args:
            pdf_data: Bytes do arquivo PDF.
            
        Returns:
            Dict com metadados do PDF.
        """
        try:
            pdf_file = io.BytesIO(pdf_data)
            reader = PdfReader(pdf_file)
            
            metadata = reader.metadata or {}
            
            return {
                "title": getattr(metadata, "title", None),
                "author": getattr(metadata, "author", None),
                "subject": getattr(metadata, "subject", None),
                "creator": getattr(metadata, "creator", None),
                "producer": getattr(metadata, "producer", None),
                "pages": len(reader.pages),
            }
            
        except Exception as e:
            self.logger.error(
                "pdf_metadata_error",
                error=str(e),
            )
            return {"pages": 0, "error": str(e)}


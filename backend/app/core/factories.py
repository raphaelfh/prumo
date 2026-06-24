"""
Factory Functions.

Funcoes factory for criacao de dependencias de forma centralizada.
Elimina duplicacao and garante consistencia in the inicializacao de componentes.
"""

from supabase import Client

from app.core.logging import get_logger
from app.infrastructure.parsing.base import DocumentParser
from app.infrastructure.storage import StorageAdapter, SupabaseStorageAdapter

_logger = get_logger(__name__)


def create_storage_adapter(supabase: Client) -> StorageAdapter:
    """
    Create StorageAdapter a partir de cliente Supabase.

    Factory centralizada que elimina duplicacao in the criacao
    do adapter de storage em multiplos endpoints.

    Args:
        supabase: Cliente Supabase autenticado.

    Returns:
        StorageAdapter configurado for Supabase.

    Exemplo:
        storage = create_storage_adapter(supabase)
        service = ModelExtractionService(db=db, storage=storage, ...)
    """
    return SupabaseStorageAdapter(supabase)


def create_document_parser(
    settings,
    *,
    llama_cloud_key: str | None = None,
) -> DocumentParser:
    """Build a DocumentParser per PARSER_BACKEND.

    Mirrors create_storage_adapter: a single choke point that owns parser
    selection. Per-project activation can request llamaparse; falls back to
    docling when no key is available.

    Args:
        settings: app settings (PARSER_BACKEND, LLAMA_CLOUD_API_KEY).
        llama_cloud_key: resolved LlamaCloud key (BYOK > global), or None.

    Returns:
        A DocumentParser instance. Falls back to the free PyMuPDF parser
        when the cloud path is unavailable or the backend is unrecognised.
    """
    # Lazy imports: the heavy docling/llama_cloud deps must not load at module
    # import time. PymupdfParser is light (base fitz) so it can import eagerly,
    # but keep it lazy for symmetry.
    from app.infrastructure.parsing.docling_parser import DoclingParser
    from app.infrastructure.parsing.llamaparse_parser import LlamaParseParser
    from app.infrastructure.parsing.pymupdf_parser import PymupdfParser

    backend = (getattr(settings, "PARSER_BACKEND", "pymupdf") or "pymupdf").lower()

    if backend == "llamaparse":
        key = llama_cloud_key or getattr(settings, "LLAMA_CLOUD_API_KEY", None)
        if not key:
            _logger.warning("parser_gate_llamaparse_no_key_fallback_pymupdf")
            return PymupdfParser()
        return LlamaParseParser(api_key=key)

    if backend == "docling":
        return DoclingParser()

    if backend != "pymupdf":
        _logger.warning("parser_gate_unknown_backend_fallback_pymupdf", backend=backend)

    return PymupdfParser()
